import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient} from '../src/qloo.js';
import {CONCEPT, withClassroomPolicy} from '../src/concept.js';
import worker from '../src/worker.js';

function recordingFetch(log) {
  return async (url) => {
    log.push(new URL(url));
    if (url.includes('/search')) return new Response(JSON.stringify({results: [{entity_id: 'S1', name: 'Synthetic Band', types: ['urn:entity:artist']}]}));
    return new Response(JSON.stringify({results: {entities: [{entity_id: 'R1', name: 'Synthetic Show', type: 'urn:entity:tv_show', query: {affinity: 0.8}}]}}));
  };
}

test('validate enforces grade and topic, trims interests', () => {
  assert.ok(CONCEPT.validate({grade: 'x', topic: 'ratios'}).error);
  assert.ok(CONCEPT.validate({grade: '6-8'}).error);
  const ok = CONCEPT.validate({grade: '6-8', topic: ' ratios ', interests: ['a', '', 'b', 'c', 'd', 'e', 'f']});
  assert.equal(ok.value.topic, 'ratios'); assert.equal(ok.value.interests.length, 5);
});

test('classroom policy adds age, trend and content rating', async () => {
  const log = [];
  const q = withClassroomPolicy(new QlooClient({apiKey: 'k', fetchImpl: recordingFetch(log)}), '3-5');
  await q.insights('movie', {'signal.interests.entities': ['S1']});
  await q.insights('artist', {});
  const [movie, artist] = log.map(u => u.searchParams);
  assert.equal(movie.get('signal.demographics.age'), '24_and_younger');
  assert.equal(movie.get('filter.content_rating'), 'G,PG');
  assert.equal(movie.get('bias.trends'), 'medium');
  assert.equal(artist.get('filter.content_rating'), null);
});

test('fallback returns Qloo-anchored hooks without a model', async () => {
  const q = withClassroomPolicy(new QlooClient({apiKey: 'k', fetchImpl: recordingFetch([])}), '6-8');
  const task = CONCEPT.validate({grade: '6-8', topic: 'ratios', interests: ['Synthetic Band']}).value;
  const out = await CONCEPT.fallback({qloo: q, task});
  assert.equal(out.hooks.length, 3);
  assert.ok(out.hooks.every(h => h.anchors[0].id === 'R1'));
});

test('/api/run uses the fallback when the model fails and reports Qloo calls', async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = recordingFetch([]);
  try {
    const env = {QLOO_API_KEY: 'k', AI: {run: async () => { throw new Error('quota'); }}, ASSETS: {fetch: () => new Response('')}};
    const res = await worker.fetch(new Request('https://x/api/run', {method: 'POST', body: JSON.stringify({grade: '9-12', topic: 'persuasive writing', interests: ['Synthetic Band']})}), env);
    const body = await res.json();
    assert.equal(res.status, 200); assert.equal(body.mode, 'fallback');
    assert.ok(body.qlooCalls.length >= 2); assert.ok(body.final.hooks.length > 0);
  } finally { globalThis.fetch = realFetch; }
});
