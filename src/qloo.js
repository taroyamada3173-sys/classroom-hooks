// Qloo Insights API client. The key stays server-side; errors never echo it.
export const QLOO_BASE = 'https://hackathon.api.qloo.com';

export const ENTITY_TYPES = {
  artist: 'urn:entity:artist', book: 'urn:entity:book', brand: 'urn:entity:brand',
  destination: 'urn:entity:destination', movie: 'urn:entity:movie', person: 'urn:entity:person',
  place: 'urn:entity:place', podcast: 'urn:entity:podcast', tv_show: 'urn:entity:tv_show',
  videogame: 'urn:entity:video_game',
};

const ALLOWED_PARAM = /^(filter|signal|bias|operator|feature|output|diversify)\.[a-z_.]+$|^(take|page|offset|sort_by|query|types)$/;

export function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (!ALLOWED_PARAM.test(k)) continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

export class QlooClient {
  constructor({apiKey, fetchImpl = fetch, cache = null, base = QLOO_BASE}) {
    if (!apiKey) throw new Error('Qloo API key is not configured');
    this.apiKey = apiKey; this.fetch = fetchImpl; this.cache = cache; this.base = base;
    this.calls = [];
  }

  async get(path, params) {
    const qs = new URLSearchParams(cleanParams(params)).toString();
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    const started = Date.now();
    let cached = this.cache ? await this.cache.get(url) : null;
    let body;
    if (cached) body = cached;
    else {
      let res;
      try {
        res = await this.fetch(url, {headers: {'X-Api-Key': this.apiKey, accept: 'application/json'}, signal: AbortSignal.timeout(10000), redirect: 'error'});
      } catch {
        throw new Error('Qloo connection unavailable');
      }
      if (!res.ok) {
        this.calls.push({path, params: cleanParams(params), status: res.status, ms: Date.now() - started});
        throw new Error(`Qloo ${path} failed with HTTP ${res.status}`);
      }
      try { body = await res.json(); } catch { throw new Error('Qloo response unavailable'); }
      if (this.cache) await this.cache.put(url, body);
    }
    this.calls.push({path, params: cleanParams(params), status: cached ? 'cache' : 200, ms: Date.now() - started});
    return body;
  }

  async search(query, types = [], take = 5) {
    const params = {query, take};
    if (types.length) params.types = types.map(t => ENTITY_TYPES[t] || t);
    const body = await this.get('/search', params);
    return (body.results || []).map(normalizeEntity);
  }

  async insights(type, params = {}) {
    if (!Object.hasOwn(ENTITY_TYPES, type)) throw new Error('Unsupported entity type');
    const body = await this.get('/v2/insights', {...params, 'filter.type': ENTITY_TYPES[type]});
    const list = body?.results?.entities || body?.results?.tags || [];
    return list.map(normalizeEntity);
  }

  async tags(query, take = 10) {
    const body = await this.get('/v2/tags', {'filter.query': query, take});
    return (body?.results?.tags || []).map(t => ({id: t.id || t.tag_id, name: t.name, type: t.type || t.subtype}));
  }
}

export function normalizeEntity(e = {}) {
  const props = e.properties || {};
  return {
    id: e.entity_id || e.id,
    name: e.name,
    type: e.type || e.subtype || (Array.isArray(e.types) ? e.types[0] : undefined),
    affinity: e.query?.affinity ?? e.affinity ?? null,
    popularity: e.popularity ?? null,
    year: props.release_year ?? props.publication_year ?? null,
    image: props.image?.url || null,
    description: typeof props.short_description === 'string' ? props.short_description : (typeof props.description === 'string' ? props.description.slice(0, 280) : null),
    tags: (e.tags || []).slice(0, 8).map(t => t.name).filter(Boolean),
  };
}

// Workers Cache API wrapper (private server-side cache, allowed by the hackathon guide).
export function edgeCache(cachesObj, ttlSeconds = 86400) {
  if (!cachesObj?.default) return null;
  const c = cachesObj.default;
  return {
    async get(url) { const r = await c.match(new Request(`${url}#qloo`)); return r ? r.json() : null; },
    async put(url, body) {
      await c.put(new Request(`${url}#qloo`), new Response(JSON.stringify(body), {headers: {'content-type': 'application/json', 'cache-control': `max-age=${ttlSeconds}`}}));
    },
  };
}
