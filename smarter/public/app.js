// Smarter demo client: recorded comparison, category gaps, chain illustration, item explorer, live calls.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
let summary = null, items = [];

// ---- 2. Where the gap is
function renderGap(kind) {
  const cells = [...summary.release[kind]].map((c) => ({ ...c, gap: c.pro - c.jev })).sort((a, b) => b.gap - a.gap);
  const bar = (v, cls, name) => `<div class="prow"><div class="track" role="img" aria-label="${name} ${f1(v)}"><div class="fill ${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></div></div><span class="v">${f1(v)}</span></div>`;
  $('gap-list').innerHTML = cells.map((c) => {
    const small = c.low_n || c.n < 30;
    const lead = c.gap >= 0 ? 'pos' : 'neg';
    return `<li><div class="nm">${esc(c.label)}<small>n = ${c.n}${small ? ' <span class="mark">small sample</span>' : ''}</small></div>
      <div class="pair">${bar(c.pro, 's1f', 's1-pro')}${bar(c.jev, 'jevf', 'Jev 1.14.0')}</div>
      <div class="gap ${lead}" title="${c.gap >= 0 ? 's1-pro leads' : 'Jev leads'}">${c.gap >= 0 ? '+' : '−'}${f1(Math.abs(c.gap))}<span class="muted"> ${c.gap >= 0 ? 's1' : 'Jev'}</span></div></li>`;
  }).join('');
}
function tabs(id, cb) {
  const root = $(id);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    root.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    cb(b.dataset.k);
  });
}

// ---- 3. Chain
function renderChain() {
  const k = Number($('k').value);
  const pro = Math.pow(0.899, k) * 100, jev = Math.pow(0.869, k) * 100;
  $('k-val').textContent = k;
  $('c-pro').style.width = pro + '%'; $('c-jev').style.width = jev + '%';
  $('c-pro-v').textContent = f1(pro) + ' %'; $('c-jev-v').textContent = f1(jev) + ' %';
}

// ---- 4. Explorer
let tab = 'pro', shown = 0;
const PAGE = 15;
function visible() {
  const sum = summary;
  const set = tab === 'pro' ? new Set(sum.pro_right_jev_wrong) : tab === 'jev' ? new Set(sum.jev_right_pro_wrong) : null;
  const fam = $('f-family').value, lang = $('f-lang').value;
  return items.filter((i) => (!set || set.has(i.id)) && (!fam || i.family === fam) && (!lang || i.lang === lang));
}
function optDesc(it, lab) {
  const c = it.question.criteria;
  if (!c) return '';
  if (Array.isArray(c)) { const m = c[Number(lab)]; return m ? String(m) : ''; }
  const key = it.type === 'noul' ? (lab === 'yes' ? 'true' : 'false') : lab;
  return c[key] || '';
}
function probBar(p, cls, name) {
  const v = typeof p === 'number' ? p : 0;
  return `<div class="pbar"><div class="track" role="img" aria-label="${name} ${Math.round(v * 100)} percent"><div class="fill ${cls}" style="width:${v * 100}%"></div></div><span class="v">${Math.round(v * 100)}%</span></div>`;
}
function optionRows(it, pro, jev, withModels) {
  return it.labels.map((lab) => {
    const gold = withModels && lab === it.expected;
    const tags = [];
    if (gold) tags.push('<span class="tag ok">✓ correct answer</span>');
    if (withModels && pro?.top === lab) tags.push('<span class="tag p1">s1-pro pick</span>');
    if (withModels && jev?.top === lab) tags.push('<span class="tag p2">Jev pick</span>');
    const d = optDesc(it, lab);
    return `<div class="opt${gold ? ' gold' : ''}"><div class="lab"><b>${esc(lab)}</b>${tags.join(' ')}</div>${d ? `<div class="desc">${esc(d)}</div>` : ''}
      ${probBar(pro?.probs?.[lab], 's1f', 's1-pro')}${probBar(jev?.probs?.[lab], 'jevf', 'Jev 1.14.0')}</div>`;
  }).join('');
}
function card(it) {
  const p = it.answers.pro, j = it.answers.jev;
  const long = it.state.length > 400;
  const el = document.createElement('article');
  el.className = 'item';
  el.innerHTML = `<div class="pills"><span class="pill">${esc(it.family)}</span><span class="pill">${esc(it.lang)}</span><span class="pill">${esc(it.usecase)}</span><span class="pill">${esc(it.type === 'noul' ? 'yes/no' : it.type)}</span>
      <span class="pill ${p.hit ? 's1' : ''}">s1-pro ${p.hit ? '✓' : '✗'}</span><span class="pill ${j.hit ? 'jev' : ''}">Jev ${j.hit ? '✓' : '✗'}</span></div>
    <p class="q">${esc(it.question.instructions)}</p>
    <div class="state${long ? ' clip' : ''}">${esc(long ? it.state.slice(0, 400) + '…' : it.state)}</div>
    ${long ? '<button class="link" data-act="expand" aria-expanded="false">Show full text</button>' : ''}
    <div class="opts-table"><div class="legend small"><span class="pill s1">s1-pro</span><span class="pill jev">Jev 1.14.0</span><span class="muted">recorded 17 Oct 2026</span></div>${optionRows(it, p, j, true)}</div>
    <div class="item-foot"><button class="btn ghost" data-act="ask">Ask s1-pro live</button><span class="mono muted small">${esc(it.id)}</span></div>
    <div class="live" aria-live="polite"></div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'expand') {
      const st = el.querySelector('.state'), open = b.getAttribute('aria-expanded') === 'true';
      st.textContent = open ? it.state.slice(0, 400) + '…' : it.state;
      st.classList.toggle('clip', open);
      b.setAttribute('aria-expanded', open ? 'false' : 'true');
      b.textContent = open ? 'Show full text' : 'Show less';
    } else if (b.dataset.act === 'ask') askLive(it, el, b);
  });
  return el;
}
async function askLive(it, el, btn) {
  const out = el.querySelector('.live');
  btn.disabled = true; out.innerHTML = '<p class="res">asking s1-pro…</p>';
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { out.innerHTML = `<p class="res bad">${esc(d.error || 'request failed')}</p>`; return; }
    const ok = d.top === it.expected;
    out.innerHTML = `<div class="live-box"><span class="tag live">live s1-pro</span> picked <b class="mono">${esc(d.top)}</b> ${ok ? '(matches the correct answer)' : '(differs from the correct answer)'}
      <div class="opts-table">${it.labels.map((lab) => `<div class="opt"><div class="lab"><b>${esc(lab)}</b>${lab === d.top ? ' <span class="tag p1">live pick</span>' : ''}${lab === it.expected ? ' <span class="tag ok">✓ correct answer</span>' : ''}</div>${probBar(d.probs?.[lab], 's1f', 'live s1-pro')}</div>`).join('')}</div>
      <div class="meta">${esc(d.model_version || '')} · ${d.latency_ms} ms round trip${d.server_ms ? ` · ${Math.round(d.server_ms)} ms on the server` : ''}. Live answers can differ slightly from the recorded run.</div></div>`;
  } catch { out.innerHTML = '<p class="res bad">network error</p>'; } finally { btn.disabled = false; }
}
function renderItems(reset) {
  const list = visible();
  if (reset) { shown = Math.min(PAGE, list.length); $('ex-list').innerHTML = ''; }
  const host = $('ex-list');
  for (let i = host.children.length; i < shown; i++) host.appendChild(card(list[i]));
  $('ex-count').textContent = `${list.length} item${list.length === 1 ? '' : 's'}${list.length > shown ? `, showing ${shown}` : ''}`;
  $('more').hidden = list.length <= shown;
  if (!list.length) host.innerHTML = '<p class="muted">No items match these filters in this tab.</p>';
}

// ---- 5. Custom
function optRow(v = '') {
  const d = document.createElement('div');
  d.className = 'optrow';
  d.innerHTML = '<input type="text" maxlength="200" aria-label="Option text" placeholder="Option text"><button type="button" class="btn ghost small-btn" aria-label="Remove option">Remove</button>';
  d.querySelector('input').value = v;
  d.querySelector('button').onclick = () => { if ($('c-optlist').children.length > 2) { d.remove(); syncAdd(); } };
  return d;
}
function syncAdd() { $('c-add').disabled = $('c-optlist').children.length >= 6; }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
async function submitCustom(e) {
  e.preventDefault();
  const type = $('c-type').value;
  const body = { state: $('c-state').value, instructions: $('c-q').value, type };
  if (type === 'choice') {
    const seen = new Set(); body.options = [];
    for (const inp of $('c-optlist').querySelectorAll('input')) {
      const label = inp.value.trim(); if (!label) continue;
      let id = slug(label) || 'option'; let n = 2; const base = id.slice(0, 36);
      while (seen.has(id)) id = `${base}_${n++}`;
      seen.add(id); body.options.push({ id, label });
    }
  }
  const out = $('c-out'); $('c-go').disabled = true; out.innerHTML = '<p class="res">asking s1-pro…</p>';
  try {
    const r = await fetch('/api/custom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { out.innerHTML = `<p class="res bad">${esc(d.error || 'request failed')}</p>`; return; }
    const keys = Object.keys(d.options);
    out.innerHTML = `<div class="live-box"><span class="tag live">live s1-pro</span> answer: <b>${esc(d.options[d.top] || d.top)}</b>
      <div class="opts-table">${keys.map((k) => `<div class="opt"><div class="lab"><b>${esc(d.options[k])}</b>${k === d.top ? ' <span class="tag p1">pick</span>' : ''}</div>${probBar(d.probs?.[k], 's1f', 's1-pro')}</div>`).join('')}</div>
      <div class="meta">${esc(d.model_version || '')} · ${d.latency_ms} ms round trip${d.server_ms ? ` · ${Math.round(d.server_ms)} ms on the server` : ''}</div></div>`;
  } catch { out.innerHTML = '<p class="res bad">network error</p>'; } finally { $('c-go').disabled = false; }
}

async function init() {
  const [s, it] = await Promise.all([fetch('/api/summary').then((r) => r.json()), fetch('/api/items').then((r) => r.json())]);
  summary = s; items = it.items;
  renderGap('usecases'); tabs('gap-tabs', renderGap);
  $('k').addEventListener('input', renderChain); renderChain();
  const fams = [...new Set(items.map((i) => i.family))].sort(), langs = [...new Set(items.map((i) => i.lang))].sort();
  $('f-family').innerHTML = '<option value="">All</option>' + fams.map((f) => `<option>${esc(f)}</option>`).join('');
  $('f-lang').innerHTML = '<option value="">All</option>' + langs.map((f) => `<option>${esc(f)}</option>`).join('');
  tabs('ex-tabs', (k) => { tab = k; renderItems(true); });
  $('f-family').onchange = $('f-lang').onchange = () => renderItems(true);
  $('more').onclick = () => { shown += PAGE; renderItems(false); };
  document.querySelector('[data-jump]').addEventListener('click', () => {
    const b = document.querySelector('#ex-tabs [data-k="jev"]'); b.click();
  });
  renderItems(true);
}
$('c-optlist').append(optRow(), optRow(), optRow()); syncAdd();
$('c-add').onclick = () => { if ($('c-optlist').children.length < 6) { $('c-optlist').append(optRow()); syncAdd(); } };
$('c-type').onchange = () => { $('c-opts').hidden = $('c-type').value !== 'choice'; };
$('cf').addEventListener('submit', submitCustom);
init().catch(() => { $('ex-count').textContent = 'Could not load the data.'; });
