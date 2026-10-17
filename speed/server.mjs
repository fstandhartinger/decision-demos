// Speed demo: every chat message of a live stream moderated by s1-fast as it arrives.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../shared/server-base.mjs';
import { decide, makeWindowBudget, makeIpBuckets, makeDailyCap, clientIp, readJson, sendJson, pct } from '../shared/guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chat = JSON.parse(fs.readFileSync(path.join(here, 'data/chat.json'), 'utf8'));
const recPath = path.join(here, 'data/recorded.json');
const recorded = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')) : {};
const MODEL = process.env.SPEED_MODEL || 's1-fast';

// The gateway allows 300 decisions per minute for this account; the app stays below it.
const budget = makeWindowBudget(Number(process.env.APP_BUDGET_PER_MIN || 240));
const daily = makeDailyCap(Number(process.env.APP_DAILY_CAP || 40000));
const runsPerIp = makeIpBuckets({ perMin: 3, burst: 3 });
const keysPerIp = makeIpBuckets({ perMin: 300, burst: 60 });
const FIREHOSE_N = 60;
const FIREHOSE_CONCURRENCY = Number(process.env.FIREHOSE_CONCURRENCY || 12);

const QUESTION = JSON.parse(fs.readFileSync(path.join(here, 'data/question.json'), 'utf8'));
const stateFor = (user, text) => `Live chat message on Kira's Emberfall stream.\nUser: ${user}\nMessage: ${text}`;

let lastLive = null; // most recent completed live run, replayed when the shared budget is used up

function sample(n) {
  const a = [...chat.messages];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

async function firehose(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const ip = clientIp(req);
  const canLive = runsPerIp(ip) && budget.left() >= FIREHOSE_N && daily.take(FIREHOSE_N) && budget.take(FIREHOSE_N);
  if (!canLive) {
    const run = lastLive || recorded.s1_run;
    if (!run) { send('busy', { reason: 'The shared live budget for this minute is used up. Please try again in a minute.' }); return res.end(); }
    send('replay', { reason: 'The shared live budget for this minute is used up, so this is a replay of the most recent live run.', at: run.at });
    for (const d of run.decisions) { send('decision', d); await new Promise((r) => setTimeout(r, Math.max(2, d.offset_ms - (d.prev_offset_ms || 0)))); }
    send('done', run.summary);
    return res.end();
  }
  const msgs = sample(FIREHOSE_N);
  send('start', { n: msgs.length, model: MODEL, concurrency: FIREHOSE_CONCURRENCY });
  let closed = false;
  req.on('close', () => { closed = true; });
  const t0 = performance.now();
  const decisions = [];
  let next = 0;
  async function worker() {
    while (!closed && next < msgs.length) {
      const m = msgs[next++];
      const r = await decide(MODEL, stateFor(m.user, m.text), { mod: QUESTION });
      const d = {
        id: m.id, user: m.user, text: m.text, lang: m.lang, label: m.label,
        ok: r.ok, choice: r.ok ? r.answers.mod.choice : null, confidence: r.ok ? r.answers.mod.confidence : null,
        rtt_ms: Math.round(r.rtt_ms), server_ms: r.server_ms, error: r.ok ? undefined : r.error,
        offset_ms: Math.round(performance.now() - t0), model_version: r.model_version,
      };
      decisions.push(d);
      if (!closed) send('decision', d);
    }
  }
  await Promise.all(Array.from({ length: FIREHOSE_CONCURRENCY }, worker));
  const wall = performance.now() - t0;
  const ok = decisions.filter((d) => d.ok);
  const summary = {
    n: decisions.length, ok: ok.length, wall_ms: Math.round(wall),
    per_s: +(ok.length / (wall / 1000)).toFixed(1),
    rtt_p50: pct(ok.map((d) => d.rtt_ms), 50), rtt_p95: pct(ok.map((d) => d.rtt_ms), 95),
    server_p50: pct(ok.map((d) => d.server_ms).filter(Boolean), 50),
    agree: ok.filter((d) => d.choice === d.label).length,
    model_version: ok[0]?.model_version, at: new Date().toISOString(),
  };
  if (ok.length >= FIREHOSE_N * 0.9) {
    const sorted = [...decisions].sort((a, b) => a.offset_ms - b.offset_ms);
    sorted.forEach((d, i) => { d.prev_offset_ms = i ? sorted[i - 1].offset_ms : 0; });
    lastLive = { at: summary.at, decisions: sorted, summary };
  }
  if (!closed) { send('done', summary); res.end(); }
}

async function moderate(req, res) {
  const ip = clientIp(req);
  const body = await readJson(req).catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.slice(0, 400) : '';
  if (!text.trim()) return sendJson(res, 400, { error: 'empty' });
  if (!keysPerIp(ip)) return sendJson(res, 429, { error: 'slow down a little' });
  if (!budget.take(1) || !daily.take(1)) return sendJson(res, 429, { error: 'shared live budget used up for this minute' });
  const r = await decide(MODEL, stateFor('you', text), { mod: QUESTION });
  if (!r.ok) return sendJson(res, 502, { error: r.error });
  const a = r.answers.mod;
  sendJson(res, 200, { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities, rtt_ms: Math.round(r.rtt_ms), server_ms: r.server_ms, model_version: r.model_version });
}

startServer({
  port: Number(process.env.PORT || 8080),
  publicDir: path.join(here, 'public'),
  sharedDir: path.join(here, '../shared'),
  routes: {
    'GET /api/firehose': firehose,
    'POST /api/moderate': moderate,
    'GET /api/recorded': (req, res) => sendJson(res, 200, recorded),
    'GET /api/budget': (req, res) => sendJson(res, 200, { left_this_minute: budget.left(), today: daily.count() }),
  },
});
