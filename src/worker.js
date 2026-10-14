import {QlooClient, edgeCache} from './qloo.js';
import {runAgent} from './agent.js';
import {CONCEPT} from './concept.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const unavailable = 'The live service is unavailable. No lesson was generated.';
const inputSchema = {type: 'object', required: ['grade', 'topic'], additionalProperties: false, properties: {
  grade: {type: 'string', enum: ['k-2', '3-5', '6-8', '9-12']}, topic: {type: 'string', maxLength: 160},
  subject: {type: 'string', maxLength: 60}, interests: {type: 'array', maxItems: 5, items: {type: 'string', maxLength: 80}},
}};

async function build(input, env) {
  const task = CONCEPT.validate(input);
  if (task.error) return {body: {error: task.error}, status: 400};
  if (!env.QLOO_API_KEY) return {body: {error: unavailable}, status: 503};
  const qloo = CONCEPT.prepareQloo(new QlooClient({apiKey: env.QLOO_API_KEY, cache: edgeCache(globalThis.caches)}), task.value);
  const result = await runAgent({ai: env.AI, qloo, system: CONCEPT.system, task: task.value, fallback: CONCEPT.fallback, validateFinal: CONCEPT.validateFinal});
  return {body: {...result, qlooCalls: qloo.calls, ...(result.final ? {} : {error: unavailable})}, status: result.final ? 200 : 503};
}

// Stateless JSON-response MCP subset. External-client interoperability is not yet verified.
async function handleMcp(msg, env) {
  if (!msg || msg.jsonrpc !== '2.0') return json({jsonrpc: '2.0', id: null, error: {code: -32600, message: 'Invalid request'}}, 400);
  const reply = r => json({jsonrpc: '2.0', id: msg.id ?? null, ...r});
  if (msg.method === 'notifications/initialized') return new Response(null, {status: 202});
  if (msg.method === 'initialize') return reply({result: {protocolVersion: '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: CONCEPT.name, version: '0.2.0'}}});
  if (msg.method === 'tools/list') return reply({result: {tools: [{name: 'build_classroom_hooks', description: 'Draft classroom activities with entity IDs checked against Qloo. Teacher review is required. Uses the same policy and evidence validation as the web app.', inputSchema}]}});
  if (msg.method === 'tools/call') {
    if (msg.params?.name !== 'build_classroom_hooks') return reply({error: {code: -32602, message: 'Unknown tool'}});
    try {
      const out = await build(msg.params?.arguments, env);
      return reply({result: {isError: out.status !== 200, content: [{type: 'text', text: JSON.stringify(out.body)}]}});
    } catch { return reply({result: {isError: true, content: [{type: 'text', text: unavailable}]}}); }
  }
  return reply({error: {code: -32601, message: 'Method not found'}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (['/api/run', '/mcp'].includes(url.pathname)) {
      if (request.method !== 'POST') return json({error: 'Use POST'}, 405);
      const reader = request.body?.getReader();
      if (!reader) return json({error: 'JSON body required'}, 400);
      const chunks = []; let size = 0;
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.length;
        if (size > 8192) { await reader.cancel(); return json({error: 'Request too large'}, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      let input; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({error: 'Invalid JSON'}, 400); }
      try {
        if (url.pathname === '/mcp') return await handleMcp(input, env);
        const out = await build(input, env); return json(out.body, out.status);
      } catch { return json({error: unavailable}, 503); }
    }
    if (url.pathname === '/api/health') return json({configured: Boolean(env.QLOO_API_KEY), aiConfigured: Boolean(env.AI), note: 'Configuration presence only; not a connectivity test.'});
    return env.ASSETS.fetch(request);
  },
};
