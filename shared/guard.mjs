// Shared server-side guard for the decisionmodels.io demos.
// - the API key stays on the server (env S1_API_KEY)
// - app-wide sliding 60 s budget below the gateway's per-account limit
// - per-IP token buckets
// - a daily request cap and a bounded number of upstream requests in flight

const API = process.env.S1_API_URL || 'https://api.decisionmodels.io/v1/systemone';
const KEY = process.env.S1_API_KEY || '';

export function makeWindowBudget(perMinute) {
  const stamps = [];
  const prune = (now) => { while (stamps.length && now - stamps[0] > 60000) stamps.shift(); };
  return {
    left(now = Date.now()) { prune(now); return perMinute - stamps.length; },
    take(n = 1, now = Date.now()) {
      prune(now);
      if (stamps.length + n > perMinute) return false;
      for (let i = 0; i < n; i++) stamps.push(now);
      return true;
    },
    used(now = Date.now()) { prune(now); return stamps.length; },
  };
}

export function makeIpBuckets({ perMin, burst }) {
  const buckets = new Map();
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [ip, b] of buckets) if (b.ts < cutoff) buckets.delete(ip);
  }, 60000).unref();
  return (ip, n = 1) => {
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b) { b = { tokens: burst, ts: now }; buckets.set(ip, b); }
    b.tokens = Math.min(burst, b.tokens + ((now - b.ts) / 60000) * perMin);
    b.ts = now;
    if (b.tokens < n) return false;
    b.tokens -= n;
    return true;
  };
}

export function makeDailyCap(cap) {
  let day = new Date().toISOString().slice(0, 10), count = 0;
  return {
    take(n = 1) {
      const d = new Date().toISOString().slice(0, 10);
      if (d !== day) { day = d; count = 0; }
      if (count + n > cap) return false;
      count += n; return true;
    },
    count: () => count,
  };
}

let inflight = 0;
const waiters = [];
const MAX_INFLIGHT = Number(process.env.S1_MAX_INFLIGHT || 16);
async function slot() {
  if (inflight < MAX_INFLIGHT) { inflight++; return; }
  await new Promise((r) => waiters.push(r));
  inflight++;
}
function release() { inflight--; const w = waiters.shift(); if (w) w(); }

// One typed decision. Returns {ok, status, answers, model_version, server_ms, rtt_ms, error}.
export async function decide(model, state, questions, { timeoutMs = 15000 } = {}) {
  if (!KEY) return { ok: false, status: 0, error: 'demo is not configured' };
  await slot();
  const t0 = performance.now();
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const rtt_ms = performance.now() - t0;
    const server_ms = Number(r.headers.get('s1-latency-ms')) || null;
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, rtt_ms, error: body?.error?.code || `http ${r.status}` };
    return { ok: true, status: 200, answers: body.answers, model_version: body.model_version || body.model, server_ms, rtt_ms };
  } catch (e) {
    return { ok: false, status: 0, rtt_ms: performance.now() - t0, error: e?.name === 'TimeoutError' ? 'timeout' : 'network error' };
  } finally {
    release();
  }
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0] : req.socket.remoteAddress || '').trim();
}

export async function readJson(req, limit = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
