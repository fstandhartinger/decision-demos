// Specialists demo: recorded router results (s1-llm-auto-router vs Jev 1.14.0), live router calls,
// and the offline champion measurements (demand forecasting, risk assessment) when data/specialists.json exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../shared/server-base.mjs';
import { decide, makeWindowBudget, makeIpBuckets, makeDailyCap, clientIp, readJson, sendJson } from '../shared/guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const routerFile = path.join(here, 'data/router.json');
const specFile = path.join(here, 'data/specialists.json');
const routerJson = fs.readFileSync(routerFile);
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(here, 'data/router-questions.json'), 'utf8'));
const MODEL = process.env.ROUTER_MODEL || 's1-llm-auto-router';

const budget = makeWindowBudget(Number(process.env.APP_BUDGET_PER_MIN || 60));
const daily = makeDailyCap(Number(process.env.APP_DAILY_CAP || 5000));
const perIp = makeIpBuckets({ perMin: 20, burst: 8 });

const BUSY = 'The shared live budget for this demo is used up for the moment. Please try again in a minute. The recorded results on this page are not affected.';
const SLOW = 'You are asking quickly. Please wait a few seconds and try again.';

function shapeAnswer(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.noul !== undefined) return { type: 'noul', p: Number(a.noul) };
  const probs = {};
  for (const [k, v] of Object.entries(a.probabilities || {})) probs[k] = Number(v);
  return { type: a.type, choice: a.choice === undefined ? null : String(a.choice), confidence: a.confidence, score: typeof a.score === 'number' ? a.score : null, probs };
}

async function route(req, res) {
  const body = await readJson(req).catch(() => null);
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid request' });
  const request = typeof body.request === 'string' ? body.request.trim() : '';
  const context = body.context === undefined || body.context === null ? '' : body.context;
  if (typeof context !== 'string') return sendJson(res, 400, { error: 'invalid request' });
  if (request.length < 1 || request.length > 4000) return sendJson(res, 400, { error: 'The prompt must be 1 to 4000 characters.' });
  if (context.length > 1000) return sendJson(res, 400, { error: 'The context can be at most 1000 characters.' });
  if (!perIp(clientIp(req))) return sendJson(res, 429, { error: SLOW });
  if (!budget.take(1) || !daily.take(1)) return sendJson(res, 429, { error: BUSY });
  const r = await decide(MODEL, { request, context: context.trim() || '(new conversation)' }, QUESTIONS);
  if (!r.ok) return sendJson(res, r.error === 'demo is not configured' ? 503 : 502, { error: r.error === 'demo is not configured' ? 'The live demo is not configured.' : 'The model did not answer. Please try again.' });
  const answers = {};
  for (const k of Object.keys(QUESTIONS)) {
    const s = shapeAnswer(r.answers?.[k]);
    if (!s) return sendJson(res, 502, { error: 'unexpected response' });
    answers[k] = s;
  }
  sendJson(res, 200, { answers, model_version: r.model_version, rtt_ms: Math.round(r.rtt_ms), server_ms: r.server_ms });
}

function specialists(req, res) {
  let buf;
  try { buf = fs.readFileSync(specFile); } catch { return sendJson(res, 404, { error: 'measurement in progress' }); }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
  res.end(buf);
}

startServer({
  port: Number(process.env.PORT || 8080),
  publicDir: path.join(here, 'public'),
  sharedDir: path.join(here, '../shared'),
  routes: {
    'GET /api/router': (req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }); res.end(routerJson); },
    'GET /api/questions': (req, res) => sendJson(res, 200, QUESTIONS),
    'GET /api/specialists': specialists,
    'POST /api/route': route,
  },
});
