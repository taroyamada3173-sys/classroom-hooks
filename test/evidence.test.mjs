import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../src/agent.js';
import {CONCEPT, validateHooks, withClassroomPolicy} from '../src/concept.js';
import {QlooClient} from '../src/qloo.js';
import worker from '../src/worker.js';

const hook = (id = 'E1') => ({type: 'opener', title: 'A draft', text: 'Hypothetical scenario for teacher review.', anchors: [{id, name: 'Invented name', why: '100% appropriate for grade 3'}]});
const evidence = new Map([['E1', {id: 'E1', name: 'Synthetic Book', affinity: 0.42, source: 'insights'}]]);
const fakeQloo = {search: async () => [evidence.get('E1')], insights: async () => [], tags: async () => [{id: 'T1', name: 'Tag'}]};
const run = (replies, extra = {}) => runAgent({ai: {run: async () => ({response: JSON.stringify(replies.shift())})}, qloo: fakeQloo, system: CONCEPT.system, task: {}, maxSteps: replies.length, validateFinal: validateHooks, ...extra});

test('hallucinated anchors and empty answers are rejected', () => {
  assert.equal(validateHooks({hooks: [hook('unknown')]}, evidence), null);
  assert.equal(validateHooks({hooks: []}, evidence), null);
  assert.equal(validateHooks({hooks: [null]}, evidence), null);
});
test('evidence labels and names come from retrieved data, never model claims', () => {
  const out = validateHooks({hooks: [hook()]}, evidence);
  assert.equal(out.hooks[0].anchors[0].name, 'Synthetic Book');
  assert.equal(out.hooks[0].anchors[0].affinity, 0.42);
  assert.match(out.hooks[0].anchors[0].why, /0.42/);
  assert.doesNotMatch(JSON.stringify(out), /100%|Invented name/);
  assert.match(out.cautions[0], /not a specific grade/);
});
test('final-before-tools cannot pass; rejected answer can recover with actual lookup', async () => {
  const out = await run([{final: {hooks: [hook()]}}, {tool: 'search_entities', args: {query: 'book'}}, {final: {hooks: [hook()]}}]);
  assert.equal(out.mode, 'agent');
  assert.equal(out.trace[0].error, 'answer failed evidence validation');
  assert.equal(out.final.hooks[0].anchors[0].source, 'search');
  assert.match(out.final.hooks[0].anchors[0].why, /not a recommendation/);
});
test('tags are not entities; malformed and inherited tool names cannot pass', async () => {
  for (const tool of ['find_tags', 'constructor', '__proto__']) {
    const out = await run([{tool, args: {query: 'x'}}, {final: {hooks: [hook('T1')]}}]);
    assert.equal(out.mode, 'failed'); assert.equal(out.final, null);
  }
});
test('evidence does not carry over into another request', async () => {
  assert.equal((await run([{tool:'search_entities',args:{query:'x'}},{final:{hooks:[hook()]}}])).mode,'agent');
  assert.equal((await run([{final:{hooks:[hook()]}}])).mode,'failed');
});
test('model cannot override policy through params, grade does not mutate another wrapper', async () => {
  const calls = [];
  const q = new QlooClient({apiKey:'synthetic', fetchImpl:async url => { calls.push(new URL(url)); return new Response('{"results":{"entities":[]}}'); }});
  const younger = withClassroomPolicy(q, 'k-2'), older = withClassroomPolicy(q, '9-12');
  await younger.insights('movie', {'signal.demographics.age':'55_and_older','bias.trends':'off','filter.content_rating':['R'],'filter.type':'urn:entity:person'});
  await older.insights('movie'); await younger.insights('videogame');
  assert.equal(calls[0].searchParams.get('filter.type'),'urn:entity:movie');
  assert.equal(calls[0].searchParams.get('signal.demographics.age'),'24_and_younger');
  assert.equal(calls[0].searchParams.get('filter.content_rating'),'G');
  assert.equal(calls[1].searchParams.get('filter.content_rating'),'G,PG,PG-13');
  assert.equal(calls[2].searchParams.get('filter.type'),'urn:entity:video_game');
});
test('transport errors containing credentials are not returned to callers', async () => {
  const q = new QlooClient({apiKey:'SYNTHETIC_SECRET_SENTINEL',fetchImpl:async()=>{throw new Error('SYNTHETIC_SECRET_SENTINEL');}});
  await assert.rejects(q.search('x'), e => !e.message.includes('SYNTHETIC_SECRET_SENTINEL'));
});
const request = (body, route='/api/run') => new Request('https://example.test'+route,{method:'POST',body:JSON.stringify(body)});
test('missing credentials and empty upstream results fail honestly, without successful empty output', async () => {
  const input={grade:'6-8',topic:'ratios'};
  assert.equal((await worker.fetch(request(input),{})).status,503);
  const saved=globalThis.fetch; globalThis.fetch=async()=>new Response('{"results":{"entities":[]}}');
  try {
    const response=await worker.fetch(request(input),{QLOO_API_KEY:'synthetic'});
    const body=await response.json(); assert.equal(response.status,503); assert.equal(body.mode,'failed'); assert.equal(body.final,null);
  } finally {globalThis.fetch=saved;}
});
test('malformed and oversized requests are rejected before any external call', async () => {
  assert.equal((await worker.fetch(request({grade:'bogus',topic:'x'}),{})).status,400);
  assert.equal((await worker.fetch(new Request('https://x/api/run',{method:'POST',body:'{'}),{})).status,400);
  assert.equal((await worker.fetch(request({topic:'x'.repeat(9000)}),{})).status,413);
});
test('MCP exposes the same classroom workflow, does not leave a raw-tool bypass', async () => {
  const body=await (await worker.fetch(request({jsonrpc:'2.0',id:1,method:'tools/list'},'/mcp'),{})).json();
  assert.deepEqual(body.result.tools.map(t=>t.name),['build_classroom_hooks']);
  assert.deepEqual(body.result.tools[0].inputSchema.required,['grade','topic']);
  const raw=await (await worker.fetch(request({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_insights'}},'/mcp'),{})).json();
  assert.equal(raw.error.code,-32602);
});
