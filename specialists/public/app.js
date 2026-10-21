// Specialists demo client: router metrics, live routing, held-out browser, offline champion tracks.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pc = (x) => f1(x * 100);
const pcInt = (x) => Math.round((Number(x) || 0) * 100);
const fmtDate = (d) => { const t = new Date(String(d) + 'T12:00:00Z'); return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
function tabs(id, cb) {
  const root = $(id);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    root.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    cb(b.dataset.k);
  });
}
const bar = (v, cls, label) => `<div class="track" role="img" aria-label="${esc(label)} ${pcInt(v)} percent"><div class="fill ${cls}" style="width:${Math.max(0, Math.min(1, v || 0)) * 100}%"></div></div>`;

const CATS = ['coding', 'agentic', 'math', 'knowledge', 'long_context', 'tool_use', 'design', 'summarisation', 'general'];
const FLAGS = ['needs_tools', 'needs_vision', 'needs_long_context', 'follow_up'];
let R = null, Q = null;

// ---------- A. metrics
function renderMetrics() {
  const { jev, s1 } = R.metrics;
  $('m-cat-s1').innerHTML = `${pc(s1.category)}<small>%</small>`; $('m-cat-jev').innerHTML = `${pc(jev.category)}<small>%</small>`;
  $('m-all-s1').innerHTML = `${pc(s1.all7_exact)}<small>%</small>`; $('m-all-jev').innerHTML = `${pc(jev.all7_exact)}<small>%</small>`;
  $('m-ms-s1').innerHTML = `${Math.round(s1.p50_ms)}<small>ms</small>`; $('m-ms-jev').innerHTML = `${Math.round(jev.p50_ms)}<small>ms</small>`;
  $('m-ms-note').textContent = `p95: ${Math.round(s1.p95_ms)} ms vs ${Math.round(jev.p95_ms)} ms. Measured from our server.`;
  const price = (s) => (String(s).match(/\$[\d.,]+/) || [s])[0];
  $('m-pr-s1').textContent = price(R.prices.s1); $('m-pr-jev').textContent = price(R.prices.jev);
  const d = fmtDate(R.date);
  $('m-date').textContent = `n = ${s1.n} held-out requests, measured ${d}.`;
  $('m-date2').textContent = d;
  $('m-set').textContent = R.set;
  $('m-note').textContent = R.request_note;
  const rows = [
    ['Category', 'category', 'accuracy'], ['Difficulty', 'difficulty', 'exact level'], ['Stakes', 'stakes', 'exact level'],
    ['Needs tools', 'needs_tools', 'accuracy'], ['Needs vision', 'needs_vision', 'accuracy'], ['Needs long context', 'needs_long_context', 'accuracy'],
    ['Is a follow-up', 'follow_up', 'accuracy'], ['Four flags together', 'flags_mean', 'mean accuracy'],
  ];
  const cell = (v, cls, win, name) => `<td class="${win ? 'win' : ''}"><div class="cellbar">${bar(v, cls, name)}<span class="mono">${pc(v)}</span></div></td>`;
  let h = '<thead><tr><th>Question</th><th class="hd s1c">s1-llm-auto-router</th><th class="hd jevc">Jev 1.14.0</th></tr></thead><tbody>';
  for (const [lab, k, what] of rows) {
    const a = s1[k], b = jev[k];
    h += `<tr><th scope="row">${lab}<small>${what}</small></th>${cell(a, 's1f', a > b + 1e-9, 's1-llm-auto-router ' + lab)}${cell(b, 'jevf', b > a + 1e-9, 'Jev ' + lab)}</tr>`;
  }
  const ea = s1.category_ece, eb = jev.category_ece;
  h += `<tr><th scope="row">Category calibration error<small>ECE, lower is better</small></th><td class="${ea < eb ? 'win' : ''}"><div class="cellbar">${bar(Math.min(1, ea * 5), 's1f', 's1 ECE')}<span class="mono">${f1(ea * 100)}</span></div></td><td class="${eb < ea ? 'win' : ''}"><div class="cellbar">${bar(Math.min(1, eb * 5), 'jevf', 'Jev ECE')}<span class="mono">${f1(eb * 100)}</span></div></td></tr></tbody>`;
  $('qtable').innerHTML = h;
}

// ---------- A. live
const EXAMPLES = [
  ['Our checkout service times out under load. Here is the stack trace from the last incident. Can you find the deadlock, fix it in the repo and run the tests?', '4 messages. Tools: read_file, edit_file, run_terminal_cmd. Previous request: add retries to the payment client'],
  ['Thanks! Can you also do the same for the German version?', '2 messages, 1 from the user. Previous request: translate the onboarding email into French and keep the tone friendly'],
  ['Show me a pricing page layout with three tiers, the middle one highlighted, mobile first.', ''],
  ['Is 2^61 - 1 prime? Prove it or give a factor.', ''],
];
let exI = 0;
function levelName(k, i) {
  const c = Q?.[k]?.criteria?.[i];
  return c ? String(c).split(':')[0] : `Level ${i}`;
}
function levels(k, a) {
  const n = Q[k].criteria.length;
  const probs = Array.from({ length: n }, (_, i) => a.probs?.[String(i)] ?? 0);
  const top = probs.indexOf(Math.max(...probs));
  const exp = a.score != null ? a.score : probs.reduce((s, p, i) => s + p * i, 0);
  return `<div class="lv">${probs.map((p, i) => `<div class="lvrow${i === top ? ' top' : ''}"><span class="lvn">${i} · ${esc(levelName(k, i))}</span>${bar(p, 's1f', levelName(k, i))}<span class="mono v">${pcInt(p)}%</span></div>`).join('')}</div>
    <div class="small muted">expected level ${f1(exp)} of ${n - 1}</div>`;
}
function renderLive(d) {
  const A = d.answers;
  const cat = A.category;
  const catRows = Object.entries(cat.probs).sort((a, b) => b[1] - a[1]);
  const flags = FLAGS.map((k) => { const p = A[k].p; return `<div class="flag ${p >= 0.5 ? 'yes' : 'no'}"><span class="flag-n">${k.replace(/_/g, ' ')}</span><b>${p >= 0.5 ? 'yes' : 'no'}</b>${bar(p, 's1f', k)}<span class="mono v">${pcInt(p)}%</span></div>`; }).join('');
  $('r-out').innerHTML = `<div class="live-box">
    <div class="live-head"><span class="tag live">live s1-llm-auto-router</span>
      <span class="mono small muted">${d.rtt_ms} ms round trip${d.server_ms != null ? ` · ${f1(d.server_ms)} ms in the model` : ''}${d.model_version ? ' · ' + esc(d.model_version) : ''}</span></div>
    <div class="res-grid">
      <div><h4>Category: <span class="s1c">${esc(String(cat.choice).replace(/_/g, ' '))}</span></h4>
        <div class="cats">${catRows.map(([k, p], i) => `<div class="catrow${i === 0 ? ' top' : ''}"><span>${esc(k.replace(/_/g, ' '))}</span>${bar(p, 's1f', k)}<span class="mono v">${pcInt(p)}%</span></div>`).join('')}</div></div>
      <div><h4>Difficulty</h4>${levels('difficulty', A.difficulty)}<h4 class="gap-t">Stakes</h4>${levels('stakes', A.stakes)}</div>
      <div><h4>Routing flags</h4><div class="flags">${flags}</div></div>
    </div></div>`;
}
async function submitRoute(e) {
  e.preventDefault();
  const out = $('r-out'); $('r-go').disabled = true; out.innerHTML = '<p class="res">asking s1-llm-auto-router…</p>';
  try {
    const r = await fetch('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: $('r-req').value, context: $('r-ctx').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { out.innerHTML = `<p class="res bad">${esc(d.error || 'request failed')}</p>`; return; }
    renderLive(d);
  } catch { out.innerHTML = '<p class="res bad">Network error. Please try again.</p>'; }
  finally { $('r-go').disabled = false; }
}

// ---------- A. browser
let exTab = 'dis', shown = 0;
const PAGE = 12;
const lvl = (x, n) => Math.round(x * n);
function fieldRows(it) {
  const g = it.gold, s = it.models.s1, j = it.models.jev;
  const rows = [
    ['category', g.category, s.category, j.category, (v) => String(v).replace(/_/g, ' ')],
    ['difficulty (0–4)', g.difficulty, lvl(s.difficulty, 4), lvl(j.difficulty, 4), String],
    ['stakes (0–3)', g.stakes, lvl(s.stakes, 3), lvl(j.stakes, 3), String],
  ];
  for (const k of FLAGS) rows.push([k.replace(/_/g, ' '), !!g[k], s[k] >= 0.5, j[k] >= 0.5, (v) => (v ? 'yes' : 'no')]);
  return rows.map(([n, gv, sv, jv, f]) => `<tr><th scope="row">${esc(n)}</th><td>${esc(f(gv))}</td><td class="${sv === gv ? 'ok' : 'bad'}">${sv === gv ? '✓' : '✗'} ${esc(f(sv))}</td><td class="${jv === gv ? 'ok' : 'bad'}">${jv === gv ? '✓' : '✗'} ${esc(f(jv))}</td></tr>`).join('');
}
function card(it) {
  const long = it.request.length > 420;
  const sc = it.models.s1.category === it.gold.category, jc = it.models.jev.category === it.gold.category;
  const el = document.createElement('article');
  el.className = 'item';
  el.innerHTML = `<div class="pills"><span class="pill">${esc(it.lang)}</span><span class="pill">${esc(it.stack)}</span>
      <span class="pill ${sc ? 's1' : ''}">router category ${sc ? '✓' : '✗'}</span><span class="pill ${jc ? 'jev' : ''}">Jev category ${jc ? '✓' : '✗'}</span></div>
    <div class="state${long ? ' clip' : ''}" data-full="${esc(it.request)}">${esc(long ? it.request.slice(0, 420) + '…' : it.request)}</div>
    ${long ? '<button class="link" data-act="expand" aria-expanded="false">Show full request</button>' : ''}
    ${it.context ? `<div class="ctx small muted">context: ${esc(it.context)}</div>` : ''}
    <table class="cmp"><thead><tr><th></th><th>Gold</th><th class="s1c">Router</th><th class="jevc">Jev</th></tr></thead><tbody>${fieldRows(it)}</tbody></table>
    <div class="item-foot"><span class="mono muted small">${esc(it.id)}</span></div>`;
  return el;
}
function visibleItems() { return exTab === 'dis' ? R.items.filter((i) => i.models.s1.category !== i.models.jev.category) : R.items; }
function renderItems(reset = true) {
  const list = visibleItems(), host = $('ex-list');
  if (reset) { host.innerHTML = ''; shown = PAGE; }
  const from = host.children.length;
  list.slice(from, shown).forEach((it) => host.appendChild(card(it)));
  $('ex-count').textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
  $('more').hidden = list.length <= shown;
  if (!list.length) host.innerHTML = '<p class="muted">No items.</p>';
}

// ---------- B. offline specialists
let S = null, track = 0, sTab = 'all', sSet = '', sShown = 12;
const MODELS = [['champion', 'ch', 'chf'], ['pro', 's1', 's1f'], ['jev', 'jev', 'jevf']];
function bName(key, t) { return key === 'champion' ? t.champion.name : key === 'pro' ? 's1-pro' : 'Jev 1.14.0'; }
function pendingView() {
  $('spec-root').innerHTML = `<div class="card pending"><div class="eyebrow">Measurement in progress</div>
    <h3>Results will appear here today</h3>
    <p class="muted">We are measuring our current demand-forecasting and risk-assessment models against Jev 1.14.0 on held-out examples. As soon as the numbers are complete they show up on this page, with every item browsable. Nothing is shown until then.</p></div>`;
}
function metricBlock(t) {
  return t.sets.map((s) => {
    const m = t.metrics?.[s.key]; if (!m) return '';
    const maxLL = Math.max(...MODELS.map(([k]) => m[k]?.logloss || 0), 0.001);
    const rowsA = MODELS.map(([k, pill, f]) => m[k] ? `<div class="mrow"><span class="pill ${pill}">${esc(bName(k, t))}</span>${bar(m[k].acc, f, bName(k, t) + ' accuracy')}<span class="mono v">${pc(m[k].acc)}%</span></div>` : '').join('');
    const rowsL = MODELS.map(([k, pill, f]) => m[k] ? `<div class="mrow"><span class="pill ${pill}">${esc(bName(k, t))}</span>${bar(m[k].logloss / maxLL, f, bName(k, t) + ' log loss')}<span class="mono v">${(+m[k].logloss).toFixed(2)}</span></div>` : '').join('');
    return `<div class="card mset"><div class="eyebrow">${esc(s.label)} · n = ${esc(s.n)}</div>
      <div class="two"><div><h4>Accuracy <span class="muted">higher is better</span></h4>${rowsA}</div><div><h4>Log loss <span class="muted">lower is better</span></h4>${rowsL}</div></div></div>`;
  }).join('');
}
function specCard(it, t) {
  const A = it.answers || {};
  const hit = (k) => A[k] ? (A[k].hit ?? A[k].top === it.expected) : false;
  const long = String(it.state || '').length > 0;
  const crit = it.question?.criteria;
  const desc = (lab) => { if (!crit) return ''; const v = Array.isArray(crit) ? crit[Number(lab)] : (crit[lab] ?? (lab === 'yes' ? crit.true : lab === 'no' ? crit.false : '')); return v ? String(v) : ''; };
  const opts = (it.labels || []).map((lab) => {
    const gold = lab === it.expected;
    const tags = MODELS.filter(([k]) => A[k]?.top === lab).map(([k, pill]) => `<span class="tag p-${pill}">${k === 'champion' ? 'champion' : k === 'pro' ? 's1-pro' : 'Jev'} pick</span>`);
    return `<div class="opt${gold ? ' gold' : ''}"><div class="lab"><b>${esc(lab)}</b>${gold ? '<span class="tag ok">✓ correct answer</span>' : ''}${tags.join(' ')}</div>
      ${desc(lab) ? `<div class="desc">${esc(desc(lab))}</div>` : ''}
      ${MODELS.map(([k, , f]) => A[k] ? `<div class="pbar thin"><span class="who">${k === 'champion' ? 'champ' : k === 'pro' ? 's1-pro' : 'Jev'}</span>${bar(A[k].probs?.[lab], f, bName(k, t))}<span class="mono v">${pcInt(A[k].probs?.[lab])}%</span></div>` : '').join('')}</div>`;
  }).join('');
  const el = document.createElement('article');
  el.className = 'item';
  el.innerHTML = `<div class="pills">${it.family ? `<span class="pill">${esc(it.family)}</span>` : ''}${it.lang ? `<span class="pill">${esc(it.lang)}</span>` : ''}${it.difficulty ? `<span class="pill">${esc(it.difficulty)}</span>` : ''}
      ${MODELS.map(([k, pill]) => A[k] ? `<span class="pill ${hit(k) ? pill : ''}">${k === 'champion' ? 'champion' : k === 'pro' ? 's1-pro' : 'Jev'} ${hit(k) ? '✓' : '✗'}</span>` : '').join('')}</div>
    <p class="q">${esc(it.question?.instructions)}</p>
    ${long ? `<details class="sdet"><summary>Situation</summary><div class="state">${esc(it.state)}</div></details>` : ''}
    <div class="opts-table">${opts}</div>
    ${it.rationale ? `<p class="why small"><b>Why:</b> ${esc(it.rationale)}</p>` : ''}
    <div class="item-foot"><span class="mono muted small">${esc(it.id)}</span></div>`;
  return el;
}
function specItems(t) {
  const hit = (it, k) => it.answers?.[k] ? (it.answers[k].hit ?? it.answers[k].top === it.expected) : false;
  return (t.items || []).filter((it) => (!sSet || it.set === sSet) && (sTab === 'all' || (sTab === 'cw' ? hit(it, 'champion') && !hit(it, 'jev') : hit(it, 'jev') && !hit(it, 'champion'))));
}
function renderSpecItems(reset = true) {
  const t = S.tracks[track], host = $('s-list'), list = specItems(t);
  if (reset) { host.innerHTML = ''; sShown = 12; }
  list.slice(host.children.length, sShown).forEach((it) => host.appendChild(specCard(it, t)));
  $('s-count').textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
  $('s-more').hidden = list.length <= sShown;
  if (!list.length) host.innerHTML = '<p class="muted">No items in this view.</p>';
}
function renderTrack() {
  const t = S.tracks[track], c = t.champion;
  const n = (t.items || []);
  const cnt = { cw: n.filter((it) => it.answers?.champion?.hit && !it.answers?.jev?.hit).length, jw: n.filter((it) => it.answers?.jev?.hit && !it.answers?.champion?.hit).length };
  $('spec-body').innerHTML = `<div class="card champ"><div class="eyebrow">Track champion when measured (${esc(fmtDate(S.date))}) · track ended 21 Oct 2026</div>
      <h3>${esc(c.name)}</h3>
      <p class="small"><a href="https://huggingface.co/${esc(c.repo)}">huggingface.co/${esc(c.repo)}</a>${c.revision ? ` · revision <span class="mono">${esc(c.revision)}</span>` : ''}</p>
      <p class="small muted">Base: ${esc(c.base)}${c.note ? '. ' + esc(c.note) : ''}</p>
      </div>
    <div class="metrics">${metricBlock(t)}</div>
    <div class="card block"><div class="eyebrow">Item browser</div><h3>Look at the items</h3>
      <div class="tabs" role="tablist" id="s-tabs">
        <button role="tab" aria-selected="true" data-k="all">All items</button>
        <button role="tab" aria-selected="false" data-k="cw">Champion right, Jev wrong (${cnt.cw})</button>
        <button role="tab" aria-selected="false" data-k="jw">Jev right, champion wrong (${cnt.jw})</button>
      </div>
      <div class="filters"><label>Set <select id="s-set"><option value="">All sets</option>${t.sets.map((s) => `<option value="${esc(s.key)}">${esc(s.key === 'fresh' ? 'Fresh items (unseen)' : s.key === 'dev' ? 'Public dev set' : s.label)}</option>`).join('')}</select></label><span id="s-count" class="muted small" aria-live="polite"></span></div>
      <div class="legend small"><span class="pill ch">champion</span><span class="pill s1">s1-pro</span><span class="pill jev">Jev 1.14.0</span><span class="muted">bars show each model's probability for the option</span></div>
      <div id="s-list" class="items"></div><div class="actions"><button id="s-more" class="btn ghost" hidden>Show more</button></div></div>`;
  sTab = 'all'; sSet = '';
  tabs('s-tabs', (k) => { sTab = k; renderSpecItems(); });
  $('s-set').onchange = (e) => { sSet = e.target.value; renderSpecItems(); };
  $('s-more').onclick = () => { sShown += 12; renderSpecItems(false); };
  $('s-list').addEventListener('click', toggler);
  renderSpecItems();
}
function specView() {
  $('spec-root').innerHTML = `<p class="muted lede">More use-case models, each trained for one job, against Jev 1.14.0 and our general s1-pro on the same held-out items. Each was the competition champion of its track on reax.co when we measured it offline on ${esc(fmtDate(S.date))}; both use-case tracks ended on 21 Oct 2026 at 13:00 UTC. The set labels below say which items were generated after training and which are public and may have been trained on; compare on the unseen ones first.</p>
    <div class="tabs" role="tablist" id="t-tabs">${S.tracks.map((t, i) => `<button role="tab" aria-selected="${i === 0}" data-k="${i}">${esc(t.label)}</button>`).join('')}</div>
    <div id="spec-body"></div>`;
  tabs('t-tabs', (k) => { track = Number(k); renderTrack(); });
  renderTrack();
}

function toggler(e) {
  const b = e.target.closest('[data-act="expand"]'); if (!b) return;
  const st = b.previousElementSibling, open = b.getAttribute('aria-expanded') === 'true';
  st.textContent = open ? st.dataset.full.slice(0, 420) + '…' : st.dataset.full;
  st.classList.toggle('clip', open);
  b.setAttribute('aria-expanded', String(!open)); b.textContent = open ? 'Show full request' : 'Show less';
}

async function init() {
  $('rf').addEventListener('submit', submitRoute);
  $('r-ex').onclick = () => { const e = EXAMPLES[exI++ % EXAMPLES.length]; $('r-req').value = e[0]; $('r-ctx').value = e[1]; };
  $('ex-list').addEventListener('click', toggler);
  tabs('ex-tabs', (k) => { exTab = k; renderItems(); });
  $('more').onclick = () => { shown += PAGE; renderItems(false); };
  const [rr, qq] = await Promise.all([fetch('/api/router').then((r) => r.json()), fetch('/api/questions').then((r) => r.ok ? r.json() : null).catch(() => null)]);
  R = rr; Q = qq;
  renderMetrics(); renderItems();
  try {
    const r = await fetch('/api/specialists');
    if (!r.ok) throw 0;
    S = await r.json();
    if (!S?.tracks?.length) throw 0;
    specView();
  } catch { pendingView(); }
}
init();
