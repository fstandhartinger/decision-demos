// Speed demo client: streams live s1-fast decisions and replays the recorded Jev burst alongside.
const $ = (id) => document.getElementById(id);
const LABEL = { allow: 'allowed', hide_spam: 'spam hidden', hide_abuse: 'abuse hidden', escalate: '→ human mod' };
let recorded = null;
let running = false;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(a, p) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }

function line(d, showMiss) {
  const li = document.createElement('li');
  const c = d.choice || 'error';
  li.className = c;
  const tag = c !== 'allow' && LABEL[c] ? `<span class="tag ${c}">${LABEL[c]}</span>` : '';
  const miss = showMiss && d.label && d.choice && d.label !== d.choice ? `<span class="tag miss">intended: ${esc(LABEL[d.label])}</span>` : '';
  li.innerHTML = `<span class="u">${esc(d.user || '')}</span><span class="t">${tag}${esc(d.text || '')} ${miss}</span><span class="ms">${d.ok ? Math.round(d.rtt_ms) + ' ms' : esc(d.error || 'error')}</span>`;
  return li;
}

function setStats(lat, n, ms) {
  $('s-p50').innerHTML = `${pct(lat, 50) ?? '–'}<small>ms</small>`;
  $('s-p95').innerHTML = `${pct(lat, 95) ?? '–'}<small>ms</small>`;
  $('s-rate').textContent = ms > 0 ? (n / (ms / 1000)).toFixed(0) : '–';
}

function startJevReplay(t0) {
  const b = recorded?.jev_burst;
  if (!b) return;
  const chat = $('jevchat');
  chat.innerHTML = '';
  let done = 0;
  const n = b.decisions.length;
  for (const d of b.decisions) {
    setTimeout(() => {
      done++;
      chat.prepend(line(d, false));
      $('jev-count').textContent = `${done} / ${n}`;
      $('jev-bar').style.width = `${(100 * done) / n}%`;
      if (done === n) $('jev-count').textContent = `${n} / ${n} · ${(b.wall_ms / 1000).toFixed(1)} s`;
    }, Math.max(0, d.offset_ms - (performance.now() - t0)));
  }
}

function run() {
  if (running) return;
  running = true;
  $('go').disabled = true;
  $('note').textContent = '';
  $('chat').innerHTML = '';
  $('s1-bar').style.width = '0';
  $('jev-bar').style.width = '0';
  $('jev-count').textContent = '0 / 60';
  const lat = [];
  let n = 0, total = 60, t0 = performance.now(), replay = false;
  const es = new EventSource('/api/firehose');
  es.addEventListener('start', (e) => { total = JSON.parse(e.data).n; t0 = performance.now(); startJevReplay(t0); });
  es.addEventListener('replay', (e) => {
    replay = true; const r = JSON.parse(e.data);
    $('note').textContent = `${r.reason} (live run from ${new Date(r.at).toLocaleTimeString()})`;
    t0 = performance.now(); startJevReplay(t0);
  });
  es.addEventListener('busy', (e) => { $('note').textContent = JSON.parse(e.data).reason; finish(); });
  es.addEventListener('decision', (e) => {
    const d = JSON.parse(e.data);
    n++;
    if (d.ok) lat.push(d.rtt_ms);
    $('chat').prepend(line(d, true));
    $('s1-count').textContent = `${n} / ${total}`;
    $('s1-bar').style.width = `${(100 * n) / total}%`;
    setStats(lat, n, performance.now() - t0);
  });
  es.addEventListener('done', (e) => {
    const s = JSON.parse(e.data);
    $('s-wall').innerHTML = `${s.wall_ms}<small>ms</small>`;
    $('s-rate').textContent = s.per_s.toFixed(0);
    $('s-p50').innerHTML = `${s.rtt_p50}<small>ms</small>`;
    $('s-p95').innerHTML = `${s.rtt_p95}<small>ms</small>`;
    $('s1-count').textContent = `${s.ok} / ${s.n} · ${(s.wall_ms / 1000).toFixed(1)} s${replay ? ' · replay' : ''}`;
    if (!replay) $('note').textContent = `Live run: ${s.agree} of ${s.ok} decisions match the intended label. Model version ${s.model_version || 's1-fast'}.`;
    finish();
  });
  es.onerror = () => { if (running) { $('note').textContent = 'Connection closed.'; finish(); } };
  function finish() { es.close(); running = false; setTimeout(() => { $('go').disabled = false; }, 1500); }
}

// Per-keystroke moderation: at most one request in flight, always the newest text.
let inflight = false, pending = null, keyCount = 0;
async function send(text) {
  if (inflight) { pending = text; return; }
  inflight = true;
  try {
    const r = await fetch('/api/moderate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const j = await r.json();
    if (r.ok) {
      keyCount++;
      const b = $('v-choice');
      b.className = `badge ${j.choice}`;
      b.textContent = `${j.choice}  ${(j.confidence * 100).toFixed(0)} %`;
      $('v-ms').textContent = `${j.rtt_ms} ms round trip${j.server_ms ? ` · ${Math.round(j.server_ms)} ms in the model` : ''}`;
      $('v-count').textContent = `${keyCount} decisions so far`;
    } else {
      $('v-ms').textContent = j.error || 'error';
    }
  } catch { $('v-ms').textContent = 'network error'; }
  inflight = false;
  if (pending !== null) { const p = pending; pending = null; send(p); }
}
$('typed').addEventListener('input', (e) => { const t = e.target.value; if (t.trim()) send(t); });
$('go').addEventListener('click', run);

function renderTable() {
  const t = recorded?.sequential;
  if (!t) { $('table').innerHTML = '<p class="muted">Measurements are being recorded.</p>'; return; }
  const rows = t.rows.map((r) => `<tr><td><span class="pill ${r.kind}">${esc(r.model)}</span></td><td>${r.p50}</td><td>${r.p95}</td><td>${r.agree_pct.toFixed(1)} %</td><td>${esc(r.price)}</td></tr>`).join('');
  $('table').innerHTML = `<table class="m"><thead><tr><th>Model</th><th>p50 ms</th><th>p95 ms</th><th>Matches intended label</th><th>List price / 1M input tokens</th></tr></thead><tbody>${rows}</tbody></table>`;
  const b = recorded.burst;
  if (b) {
    const r = (a) => `${(Math.min(...a) / 1000).toFixed(2)}–${(Math.max(...a) / 1000).toFixed(2)} s`;
    $('table').insertAdjacentHTML('beforeend', `<h3 class="burst-h">All 60 at once (12 in parallel)</h3><table class="m"><thead><tr><th>Model</th><th>Time until all 60 are decided</th></tr></thead><tbody><tr><td><span class="pill s1">s1-fast</span></td><td>${r(b.s1_walls_ms)}</td></tr><tr><td><span class="pill jev">Jev 1.14.0</span></td><td>${r(b.jev_walls_ms)}</td></tr></tbody></table><p class="muted small">${esc(b.note)}</p>`);
  }
  $('method').textContent = t.method;
  document.querySelectorAll('.rec-date').forEach((el) => { el.textContent = recorded.jev_burst?.date || t.date; });
}

fetch('/api/recorded').then((r) => r.json()).then((j) => { recorded = j; renderTable(); }).catch(() => {});
