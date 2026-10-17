// Smarter demo: recorded s1-pro vs Jev 1.14.0 on the public JevBench set, plus live s1-pro calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../shared/server-base.mjs';
import { decide, makeWindowBudget, makeIpBuckets, makeDailyCap, clientIp, readJson, sendJson } from '../shared/guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const summary = JSON.parse(fs.readFileSync(path.join(here, 'data/summary.json'), 'utf8'));
const allItems = JSON.parse(fs.readFileSync(path.join(here, 'data/items.json'), 'utf8'));
const byId = new Map(allItems.map((i) => [i.id, i]));
const MODEL = process.env.SMARTER_MODEL || 's1-pro';

// Items sent to the browser: the 297 compared ones; the s1-fast probabilities are left out to keep it small.
const clientItems = allItems.filter((i) => i.common).map((i) => {
  const { fast, ...answers } = i.answers;
  return { ...i, answers: { ...answers, fast: fast && { ok: fast.ok, top: fast.top, hit: fast.hit } } };
});
const itemsJson = JSON.stringify({ items: clientItems });

const budget = makeWindowBudget(Number(process.env.APP_BUDGET_PER_MIN || 60));
const daily = makeDailyCap(Number(process.env.APP_DAILY_CAP || 3000));
const askPerIp = makeIpBuckets({ perMin: 12, burst: 6 });
const customPerIp = makeIpBuckets({ perMin: 12, burst: 6 });

const BUSY = 'The shared live budget for this demo is used up for the moment. Please try again in a minute. The recorded results on this page are not affected.';
const SLOW = 'You are asking quickly. Please wait a few seconds and try again.';

function gate(ip, bucket, res) {
  if (!bucket(ip)) { sendJson(res, 429, { error: SLOW }); return false; }
  if (!budget.take(1) || !daily.take(1)) { sendJson(res, 429, { error: BUSY }); return false; }
  return true;
}

function shape(qid, r) {
  const a = r.answers?.[qid];
  if (!a) return null;
  const probs = {};
  for (const [k, v] of Object.entries(a.probabilities || {})) probs[k === 'true' ? 'yes' : k === 'false' ? 'no' : k] = v;
  const top = a.choice === true || a.choice === 'true' ? 'yes' : a.choice === false || a.choice === 'false' ? 'no' : String(a.choice);
  return { top, confidence: a.confidence, probs, latency_ms: Math.round(r.rtt_ms), server_ms: r.server_ms, model_version: r.model_version };
}

async function ask(req, res) {
  const body = await readJson(req).catch(() => null);
  const item = typeof body?.id === 'string' ? byId.get(body.id) : null;
  if (!item || !item.common) return sendJson(res, 404, { error: 'unknown item' });
  if (!gate(clientIp(req), askPerIp, res)) return;
  const r = await decide(MODEL, item.state, { q: item.question });
  if (!r.ok) return sendJson(res, r.status === 0 && r.error === 'demo is not configured' ? 503 : 502, { error: r.error });
  const out = shape('q', r);
  if (!out) return sendJson(res, 502, { error: 'unexpected response' });
  sendJson(res, 200, out);
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

async function custom(req, res) {
  const body = await readJson(req).catch(() => null);
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid request' });
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
  if (state.length < 1 || state.length > 4000) return sendJson(res, 400, { error: 'The situation must be 1 to 4000 characters.' });
  if (instructions.length < 3 || instructions.length > 500) return sendJson(res, 400, { error: 'The question must be 3 to 500 characters.' });
  let q;
  if (body.type === 'yesno') {
    q = { type: 'noul', instructions };
  } else if (body.type === 'choice') {
    if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 6) return sendJson(res, 400, { error: 'Give 2 to 6 options.' });
    const criteria = {};
    for (const o of body.options) {
      const label = typeof o?.label === 'string' ? o.label.trim() : '';
      const id = slug(o?.id || label);
      if (!label || label.length > 200 || !/^[a-z0-9_]{1,40}$/.test(id)) return sendJson(res, 400, { error: 'Each option needs a short text (up to 200 characters).' });
      if (criteria[id] !== undefined) return sendJson(res, 400, { error: 'Options must be different from each other.' });
      criteria[id] = label;
    }
    if (Object.keys(criteria).length < 2) return sendJson(res, 400, { error: 'Give 2 to 6 options.' });
    q = { type: 'choice', instructions, criteria };
  } else return sendJson(res, 400, { error: 'type must be choice or yesno' });
  if (!gate(clientIp(req), customPerIp, res)) return;
  const r = await decide(MODEL, state, { q });
  if (!r.ok) return sendJson(res, r.error === 'demo is not configured' ? 503 : 502, { error: r.error });
  const out = shape('q', r);
  if (!out) return sendJson(res, 502, { error: 'unexpected response' });
  out.options = q.type === 'choice' ? q.criteria : { yes: 'Yes', no: 'No' };
  sendJson(res, 200, out);
}

startServer({
  port: Number(process.env.PORT || 8080),
  publicDir: path.join(here, 'public'),
  sharedDir: path.join(here, '../shared'),
  routes: {
    'GET /api/summary': (req, res) => sendJson(res, 200, summary),
    'GET /api/items': (req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }); res.end(itemsJson); },
    'POST /api/ask': ask,
    'POST /api/custom': custom,
  },
});
