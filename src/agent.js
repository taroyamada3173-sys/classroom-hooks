// Small tool-using agent loop. The model replies with one JSON object per turn:
//   {"thought": "...", "tool": "<name>", "args": {...}}   or   {"thought": "...", "final": {...}}
// A JSON protocol is used instead of native tool calling so any Workers AI chat model works.
export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const TOOL_SPECS = {
  search_entities: {
    description: 'Resolve names to Qloo entities. args: {query: string, types?: string[]} (types: artist, book, brand, destination, movie, person, place, podcast, tv_show, videogame)',
    run: (q, a) => q.search(String(a.query || '').slice(0, 120), Array.isArray(a.types) ? a.types : [], 5),
  },
  get_insights: {
    description: 'Taste-based recommendations. args: {type: string, entity_ids?: string[], tag_ids?: string[], take?: number}. Uses signal.interests.entities / signal.interests.tags. Classroom age and rating settings are applied by the server.',
    run: (q, a) => {
      const params = {};
      if (Array.isArray(a.entity_ids)) params['signal.interests.entities'] = a.entity_ids.filter(x => typeof x === 'string').slice(0, 10);
      if (Array.isArray(a.tag_ids)) params['signal.interests.tags'] = a.tag_ids.filter(x => typeof x === 'string').slice(0, 10);
      params.take = Math.max(1, Math.min(Math.floor(Number(a.take)) || 8, 20));
      return q.insights(String(a.type || 'movie'), params);
    },
  },
  find_tags: {
    description: 'Find Qloo tag ids by keyword. args: {query: string}',
    run: (q, a) => q.tags(String(a.query || '').slice(0, 80), 8),
  },
};

export function parseModelJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  for (let end = s.lastIndexOf('}'); end > start; end = s.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

function compact(result) {
  const list = Array.isArray(result) ? result : [];
  return list.slice(0, 10).map(e => ({id: e.id, name: e.name, type: e.type, affinity: e.affinity, year: e.year, tags: (e.tags || []).slice(0, 4)}));
}

export async function runAgent({ai, qloo, system, task, model = DEFAULT_MODEL, maxSteps = 8, fallback, validateFinal}) {
  const trace = [];
  const evidence = new Map();
  const source = qloo;
  qloo = Object.create(source);
  for (const method of ['search', 'insights']) {
    qloo[method] = async (...args) => {
      const rows = await source[method](...args);
      for (const row of rows) if (row?.id && row?.name) evidence.set(row.id, {...row, source: method});
      return rows;
    };
  }
  const checked = final => validateFinal ? validateFinal(final, evidence) : final;
  const toolList = Object.entries(TOOL_SPECS).map(([n, t]) => `- ${n}: ${t.description}`).join('\n');
  const messages = [
    {role: 'system', content: `${system}\n\nTools:\n${toolList}\n\nReply with exactly one JSON object and nothing else.`},
    {role: 'user', content: typeof task === 'string' ? task : JSON.stringify(task)},
  ];
  for (let step = 0; step < maxSteps; step++) {
    let reply;
    try {
      const out = await ai.run(model, {messages, max_tokens: 900, temperature: 0.2});
      reply = parseModelJson(out?.response ?? out);
    } catch (err) {
      trace.push({step, error: 'model unavailable'});
      break;
    }
    if (!reply) { trace.push({step, error: 'unparseable model reply'}); messages.push({role: 'user', content: 'Invalid. Reply with one JSON object.'}); continue; }
    if (reply.final) {
      const final = checked(reply.final);
      if (final) { trace.push({step, final: true}); return {final, trace, mode: 'agent'}; }
      trace.push({step, error: 'answer failed evidence validation'});
      messages.push({role: 'user', content: 'Your answer was rejected. Use the required hook schema and only entity IDs returned by search_entities or get_insights in this run. Do not use tag IDs as anchors. Call tools if needed.'});
      continue;
    }
    const spec = Object.hasOwn(TOOL_SPECS, reply.tool) ? TOOL_SPECS[reply.tool] : null;
    if (!spec) { trace.push({step, error: 'unknown tool'}); messages.push({role: 'user', content: `Unknown tool. Use one of: ${Object.keys(TOOL_SPECS).join(', ')}`}); continue; }
    let result, error = null;
    try { result = compact(await spec.run(qloo, reply.args || {})); } catch { error = 'tool unavailable'; result = []; }
    trace.push({step, tool: reply.tool, count: result.length, error});
    messages.push({role: 'assistant', content: JSON.stringify({thought: reply.thought, tool: reply.tool, args: reply.args})});
    messages.push({role: 'user', content: `Result of ${reply.tool}: ${JSON.stringify(error ? {error} : result)}`});
  }
  if (fallback) {
    try {
      const final = checked(await fallback({qloo, task, trace}));
      if (final) return {final, trace, mode: 'fallback'};
    } catch { trace.push({error: 'fallback unavailable'}); }
  }
  return {final: null, trace, mode: 'failed'};
}
