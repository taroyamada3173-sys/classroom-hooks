import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient, cleanParams, normalizeEntity} from '../src/qloo.js';
import {runAgent, parseModelJson} from '../src/agent.js';
import worker from '../src/worker.js';

// Synthetic fixtures only (Qloo responses must not be stored in a public repo).
const fakeFetch = (log) => async (url, init) => {
  log.push({url, key: init.headers['X-Api-Key']});
  if (url.includes('/search')) return new Response(JSON.stringify({results: [{entity_id: 'E1', name: 'Synthetic Film', types: ['urn:entity:movie'], properties: {release_year: 1999}}]}));
  if (url.includes('/v2/insights')) return new Response(JSON.stringify({results: {entities: [{entity_id: 'E2', name: 'Synthetic Album Artist', type: 'urn:entity:artist', query: {affinity: 0.91}}]}}));
  return new Response('{}', {status: 404});
};

test('cleanParams drops unknown keys and joins arrays', () => {
  assert.deepEqual(cleanParams({'signal.interests.entities': ['a', 'b'], evil: 'x', take: 5, empty: ''}), {'signal.interests.entities': 'a,b', take: '5'});
});

test('client sends key in header only and normalizes entities', async () => {
  const log = [];
  const q = new QlooClient({apiKey: 'k-test', fetchImpl: fakeFetch(log)});
  const found = await q.search('film', ['movie']);
  assert.equal(found[0].id, 'E1'); assert.equal(found[0].year, 1999);
  assert.ok(log[0].url.includes('types=urn%3Aentity%3Amovie'));
  assert.ok(!log[0].url.includes('k-test')); assert.equal(log[0].key, 'k-test');
  const recs = await q.insights('artist', {'signal.interests.entities': ['E1']});
  assert.equal(recs[0].affinity, 0.91);
});

test('client error does not leak key', async () => {
  const q = new QlooClient({apiKey: 'k-secret', fetchImpl: async () => new Response('no', {status: 401})});
  await assert.rejects(q.search('x'), err => !err.message.includes('k-secret') && err.message.includes('401'));
});

test('parseModelJson tolerates prose around JSON', () => {
  assert.deepEqual(parseModelJson('Sure! {"tool":"find_tags","args":{"query":"jazz"}} done'), {tool: 'find_tags', args: {query: 'jazz'}});
  assert.equal(parseModelJson('nothing'), null);
});

test('agent loop calls tools then finishes', async () => {
  const replies = [
    '{"thought":"resolve","tool":"search_entities","args":{"query":"Synthetic Film","types":["movie"]}}',
    '{"thought":"expand","tool":"get_insights","args":{"type":"artist","entity_ids":["E1"]}}',
    '{"thought":"done","final":{"picks":["E2"]}}',
  ];
  const ai = {run: async () => ({response: replies.shift()})};
  const q = new QlooClient({apiKey: 'k', fetchImpl: fakeFetch([])});
  const out = await runAgent({ai, qloo: q, system: 's', task: 't'});
  assert.equal(out.mode, 'agent'); assert.deepEqual(out.final, {picks: ['E2']});
  assert.equal(out.trace.filter(t => t.tool).length, 2); assert.equal(q.calls.length, 2);
});

test('agent falls back when model is unavailable', async () => {
  const ai = {run: async () => { throw new Error('quota'); }};
  const q = new QlooClient({apiKey: 'k', fetchImpl: fakeFetch([])});
  const out = await runAgent({ai, qloo: q, system: 's', task: 't', fallback: async () => ({ok: true})});
  assert.equal(out.mode, 'fallback'); assert.deepEqual(out.final, {ok: true});
});

test('MCP endpoint lists and calls tools', async () => {
  const env = {QLOO_API_KEY: 'k', AI: {run: async () => { throw new Error('quota'); }}, ASSETS: {fetch: () => new Response('asset')}};
  const realFetch = globalThis.fetch; globalThis.fetch = fakeFetch([]);
  try {
    const call = body => worker.fetch(new Request('https://x/mcp', {method: 'POST', body: JSON.stringify(body)}), env).then(r => r.json());
    const list = await call({jsonrpc: '2.0', id: 1, method: 'tools/list'});
    assert.ok(list.result.tools.some(t => t.name === 'build_classroom_hooks'));
    const res = await call({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'build_classroom_hooks', arguments: {grade: '6-8', topic: 'ratios', interests: ['film']}}});
    assert.equal(res.result.isError, false); assert.match(res.result.content[0].text, /Synthetic Album Artist/);
  } finally { globalThis.fetch = realFetch; }
});
