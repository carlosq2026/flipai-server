const express = require(‘express’);
const fetch = require(‘node-fetch’);
const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ’*’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘*’);
if (req.method === ‘OPTIONS’) { res.status(200).end(); return; }
next();
});

app.use(express.json({ limit: ‘10mb’ }));

const HTML = String.raw`<!DOCTYPE html>

<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FlipAI — Smart eBay Lister</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --card: #1a1a26;
    --border: #2a2a3d;
    --accent: #00e5a0;
    --accent2: #ff6b35;
    --accent3: #7c6bff;
    --text: #f0f0ff;
    --muted: #6b6b8a;
    --warning: #ffb800;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: 'DM Mono', monospace; min-height: 100vh; overflow-x: hidden; }
  .container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }

header { padding: 24px 0; border-bottom: 1px solid var(–border); display: flex; align-items: center; justify-content: space-between; }
.logo { font-family: ‘Syne’, sans-serif; font-size: 1.5rem; font-weight: 800; display: flex; align-items: center; gap: 10px; }
.logo-dot { width: 10px; height: 10px; background: var(–accent); border-radius: 50%; box-shadow: 0 0 12px var(–accent); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }

.keys-section { background: var(–card); border: 1px solid var(–border); border-radius: 14px; padding: 20px; margin: 24px 0; }
.keys-section h3 { font-family: ‘Syne’, sans-serif; font-size: 0.9rem; font-weight: 700; margin-bottom: 14px; color: var(–accent); text-transform: uppercase; letter-spacing: 0.08em; }
.key-row { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.key-row label { font-size: 0.72rem; color: var(–muted); text-transform: uppercase; letter-spacing: 0.08em; min-width: 120px; }
.key-row input { flex: 1; min-width: 220px; background: var(–surface); border: 1px solid var(–border); border-radius: 8px; padding: 10px 14px; color: var(–text); font-family: ‘DM Mono’, monospace; font-size: 0.8rem; outline: none; transition: border-color 0.2s; }
.key-row input:focus { border-color: var(–accent); }
.key-row input::placeholder { color: var(–muted); }
.key-status { font-size: 0.75rem; margin-top: 4px; }
.key-status.ok { color: var(–accent); }
.key-status.err { color: var(–accent2); }

.btn { background: var(–accent); color: #0a0a0f; border: none; border-radius: 8px; padding: 10px 20px; font-family: ‘Syne’, sans-serif; font-weight: 700; font-size: 0.82rem; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; }
.btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.btn-outline { background: transparent; color: var(–accent); border: 1px solid var(–accent); }
.btn-purple { background: var(–accent3); color: white; }

.drop-zone { border: 2px dashed var(–border); border-radius: 16px; padding: 48px 32px; text-align: center; cursor: pointer; transition: all 0.3s; position: relative; background: var(–surface); margin-bottom: 24px; }
.drop-zone:hover, .drop-zone.drag-over { border-color: var(–accent); background: rgba(0,229,160,0.04); }
.drop-zone input[type=“file”] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.drop-zone h3 { font-family: ‘Syne’, sans-serif; font-size: 1.2rem; font-weight: 700; margin: 12px 0 8px; }
.drop-zone p { color: var(–muted); font-size: 0.8rem; }
.formats { margin-top: 12px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.tag { background: var(–card); border: 1px solid var(–border); border-radius: 6px; padding: 3px 10px; font-size: 0.68rem; color: var(–muted); text-transform: uppercase; }

.stats-bar { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 24px; }
.stat-card { background: var(–card); border: 1px solid var(–border); border-radius: 12px; padding: 16px; }
.stat-card .num { font-family: ‘Syne’, sans-serif; font-size: 1.6rem; font-weight: 800; color: var(–accent); }
.stat-card .lbl { font-size: 0.68rem; color: var(–muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }

.controls { display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
.progress-wrap { background: var(–surface); border-radius: 100px; height: 4px; margin-bottom: 8px; overflow: hidden; }
.progress-bar { height: 100%; background: linear-gradient(90deg, var(–accent), var(–accent3)); border-radius: 100px; transition: width 0.4s; }
.progress-lbl { font-size: 0.72rem; color: var(–muted); margin-bottom: 20px; }

.photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
.photo-card { background: var(–card); border: 1px solid var(–border); border-radius: 14px; overflow: hidden; transition: all 0.3s; animation: fadeUp 0.3s ease both; }
@keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
.photo-card.processing { border-color: var(–accent3); }
.photo-card.done { border-color: var(–accent); }
.photo-card.error { border-color: var(–accent2); }
.card-img { width: 100%; height: 190px; object-fit: cover; background: var(–surface); display: block; }
.card-body { padding: 14px; }
.card-status { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; }
.sdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sdot.idle { background: var(–muted); }
.sdot.processing { background: var(–accent3); animation: pulse 1s infinite; }
.sdot.done { background: var(–accent); }
.sdot.error { background: var(–accent2); }
.card-title { font-family: ‘Syne’, sans-serif; font-size: 0.9rem; font-weight: 700; margin-bottom: 8px; line-height: 1.3; }
.price-box { background: var(–surface); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.price-row { display: flex; justify-content: space-between; font-size: 0.73rem; padding: 3px 0; }
.price-row .pl { color: var(–muted); }
.price-row .pv { font-family: ‘Syne’, sans-serif; font-weight: 700; color: var(–accent); }
.price-row .pv.big { color: var(–warning); font-size: 0.95rem; }
.divider { height: 1px; background: var(–border); margin: 6px 0; }
.edit-label { font-size: 0.63rem; color: var(–muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; display: block; }
.edit-field { width: 100%; background: var(–surface); border: 1px solid var(–border); border-radius: 6px; padding: 7px 10px; color: var(–text); font-family: ‘DM Mono’, monospace; font-size: 0.76rem; outline: none; margin-bottom: 8px; transition: border-color 0.2s; }
.edit-field:focus { border-color: var(–accent); }
.card-actions { display: flex; gap: 8px; margin-top: 10px; }
.btn-sm { padding: 7px 12px; font-size: 0.72rem; border-radius: 6px; flex: 1; }
.skeleton { background: linear-gradient(90deg,var(–surface) 25%,var(–border) 50%,var(–surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; height: 13px; margin-bottom: 6px; }
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

.debug-panel { background: var(–surface); border: 1px solid var(–accent2); border-radius: 10px; padding: 14px; margin-bottom: 20px; font-size: 0.72rem; display: none; }
.debug-panel.visible { display: block; }
.debug-panel .dtitle { color: var(–accent2); font-weight: 700; margin-bottom: 6px; font-family: ‘Syne’, sans-serif; }
.debug-panel pre { white-space: pre-wrap; word-break: break-all; color: var(–accent); }

.toast-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; }
.toast { background: var(–card); border: 1px solid var(–border); border-radius: 10px; padding: 12px 16px; font-size: 0.8rem; max-width: 300px; animation: slideIn 0.3s ease; }
.toast.success { border-color: var(–accent); }
.toast.error { border-color: var(–accent2); }
@keyframes slideIn { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }

.section-head { font-family: ‘Syne’, sans-serif; font-size: 1rem; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
.section-head::after { content:’’; flex:1; height:1px; background:var(–border); }
.badge { background: var(–accent); color: #0a0a0f; border-radius: 100px; padding: 2px 10px; font-size: 0.68rem; font-weight: 700; }
footer { padding: 32px 0; text-align: center; color: var(–muted); font-size: 0.7rem; border-top: 1px solid var(–border); margin-top: 48px; }
@media(max-width:600px) { .stats-bar{grid-template-columns:repeat(2,1fr)} .photo-grid{grid-template-columns:1fr} }
</style>

</head>
<body>
<div class="container">
  <header>
    <div class="logo"><div class="logo-dot"></div>FlipAI</div>
    <div style="font-size:0.7rem;color:var(--muted)">📚 Bookslayer Edition</div>
  </header>

  <div class="keys-section">
    <h3>🔑 Step 1 — Enter & Verify Your Keys</h3>
    <div class="key-row">
      <label>Claude API Key</label>
      <input type="password" id="apiKey" placeholder="sk-ant-api03-..." autocomplete="off" />
    </div>
    <div class="key-row">
      <label>eBay App ID</label>
      <input type="text" id="ebayKey" placeholder="ARLOWES-Bookslay-PRD-..." autocomplete="off" />
    </div>
    <div class="key-row">
      <label>Server URL</label>
      <input type="text" id="serverUrl" placeholder="https://ebay-trading-server-production.up.railway.app" autocomplete="off" />
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
      <button class="btn" onclick="saveAndVerify()">✓ Save & Verify Keys</button>
      <span class="key-status" id="keyStatus"></span>
    </div>
  </div>

  <div class="debug-panel" id="debugPanel">
    <div class="dtitle">⚠️ Error Details</div>
    <pre id="debugText"></pre>
  </div>

  <div class="drop-zone" id="dropZone">
    <input type="file" id="fileInput" accept="image/*" multiple onchange="handleFiles(this.files)" />
    <div style="font-size:2.5rem">📦</div>
    <h3>Drop your photo folder here</h3>
    <p>Or tap to browse — select multiple files at once</p>
    <div class="formats">
      <span class="tag">JPG</span><span class="tag">PNG</span><span class="tag">WEBP</span><span class="tag">HEIC</span><span class="tag">Unlimited</span>
    </div>
  </div>

  <div class="stats-bar" id="statsBar" style="display:none">
    <div class="stat-card"><div class="num" id="s1">0</div><div class="lbl">Loaded</div></div>
    <div class="stat-card"><div class="num" id="s2">0</div><div class="lbl">Analyzed</div></div>
    <div class="stat-card"><div class="num" id="s3">$0</div><div class="lbl">Est. Value</div></div>
    <div class="stat-card"><div class="num" id="s4">0</div><div class="lbl">Ready</div></div>
  </div>

  <div class="controls" id="ctrlBar" style="display:none">
    <button class="btn" onclick="analyzeAll()">⚡ Analyze All</button>
    <button class="btn btn-outline" onclick="clearAll()">Clear All</button>
    <button class="btn btn-purple" onclick="postAllToEbay()">🚀 Post All to eBay</button>
  </div>

  <div id="progWrap" style="display:none">
    <div class="progress-wrap"><div class="progress-bar" id="progBar" style="width:0%"></div></div>
    <div class="progress-lbl" id="progLbl">Analyzing...</div>
  </div>

  <div class="section-head" id="gridHead" style="display:none">Your Items <span class="badge" id="gridCount">0</span></div>
  <div class="photo-grid" id="photoGrid"></div>
</div>

<div class="toast-wrap" id="toasts"></div>
<footer><div class="container">FlipAI Bookslayer Edition · Powered by Claude AI · Keys stored locally only</div></footer>

<script>
let items = [];
let busy = false;

// Drag & drop
const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });

window.addEventListener('load', () => {
  const ak = localStorage.getItem('fa_ck');
  const ek = localStorage.getItem('fa_ek');
  const sv = localStorage.getItem('fa_sv');
  if (ak) document.getElementById('apiKey').value = ak;
  if (ek) document.getElementById('ebayKey').value = ek;
  if (sv) document.getElementById('serverUrl').value = sv;
  else document.getElementById('serverUrl').value = 'https://ebay-trading-server-production.up.railway.app';
  if (ak) setKeyStatus('✓ Keys loaded from last session — click Verify to confirm', 'ok');
});

async function saveAndVerify() {
  const ak = document.getElementById('apiKey').value.trim();
  const ek = document.getElementById('ebayKey').value.trim();
  hideDebug();

  if (!ak) { setKeyStatus('⚠ Please enter your Claude API key', 'err'); return; }
  if (!ak.startsWith('sk-ant-')) { setKeyStatus('⚠ Key should start with sk-ant-  — check you copied it fully', 'err'); return; }

  setKeyStatus('⏳ Testing connection to Claude...', 'ok');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ak,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }]
      })
    });

    const data = await res.json();

    if (data.error) {
      const msg = data.error.message || 'Unknown error';
      setKeyStatus('⚠ API Error: ' + msg, 'err');
      showDebug('API returned error:\n' + JSON.stringify(data.error, null, 2));
      return;
    }

    localStorage.setItem('fa_ck', ak);
    if (ek) localStorage.setItem('fa_ek', ek);
    const sv = document.getElementById('serverUrl').value.trim();
    if (sv) localStorage.setItem('fa_sv', sv);

    // Test Railway server with no-cors ping
    let serverOk = false;
    if (sv) {
      try {
        await fetch(sv, { mode: 'no-cors' });
        serverOk = true; // if no error thrown, server is reachable
      } catch(e) { serverOk = false; }
    }

    const serverMsg = serverOk ? ' · 🚀 Server connected!' : (sv ? ' · ⚠ Server unreachable' : '');
    setKeyStatus('✅ Claude API working!' + serverMsg + ' Drop your photos below!', 'ok');
    toast('API verified! Ready to analyze books 📚', 'success');

  } catch(err) {
    setKeyStatus('⚠ Connection failed: ' + err.message, 'err');
    showDebug('Connection error:\n' + err.message + '\n\nPossible causes:\n- No internet connection\n- API key is incorrect\n- Try opening in Safari instead of Claude app');
  }
}

function setKeyStatus(msg, type) {
  const el = document.getElementById('keyStatus');
  el.textContent = msg;
  el.className = 'key-status ' + type;
}

function showDebug(text) {
  document.getElementById('debugPanel').classList.add('visible');
  document.getElementById('debugText').textContent = text;
}

function hideDebug() {
  document.getElementById('debugPanel').classList.remove('visible');
}

function handleFiles(files) {
  const imgs = Array.from(files).filter(f =>
    f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(f.name)
  );
  if (!imgs.length) { toast('No image files found', 'error'); return; }
  imgs.forEach(file => items.push({
    id: Date.now() + Math.random(),
    file, url: URL.createObjectURL(file),
    status: 'idle', title: '', description: '',
    price: '', minPrice: '', maxPrice: '', avgPrice: '', category: ''
  }));
  renderGrid(); updateStats();
  document.getElementById('statsBar').style.display = 'grid';
  document.getElementById('ctrlBar').style.display = 'flex';
  document.getElementById('gridHead').style.display = 'flex';
  toast(imgs.length + ' photo' + (imgs.length > 1 ? 's' : '') + ' loaded! ✓', 'success');
}

function renderGrid() {
  const grid = document.getElementById('photoGrid');
  grid.innerHTML = '';
  items.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'photo-card ' + item.status;
    card.id = 'card-' + item.id;
    card.style.animationDelay = Math.min(i * 0.04, 0.4) + 's';
    card.innerHTML = buildCard(item);
    grid.appendChild(card);
  });
  document.getElementById('gridCount').textContent = items.length;
}

function buildCard(item) {
  const labels = { idle:'Ready to analyze', processing:'Analyzing...', done:'Analysis complete ✓', error:'Failed — tap retry' };
  const colors = { idle:'var(--muted)', processing:'var(--accent3)', done:'var(--accent)', error:'var(--accent2)' };

  let priceHTML = '';
  if (item.status === 'done') {
    priceHTML = `<div class="price-box">
      <div class="price-row"><span class="pl">Avg sold price</span><span class="pv">$${item.avgPrice||'—'}</span></div>
      <div class="price-row"><span class="pl">Range</span><span class="pv">$${item.minPrice||'—'} – $${item.maxPrice||'—'}</span></div>
      <div class="divider"></div>
      <div class="price-row"><span class="pl">Suggested price</span><span class="pv big">$${item.price||'—'}</span></div>
    </div>`;
  } else if (item.status === 'processing') {
    priceHTML = `<div class="price-box"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:60%"></div></div>`;
  }

  let editHTML = '';
  if (item.status === 'done') {
    editHTML = `
      <span class="edit-label">Title</span>
      <input class="edit-field" value="${esc(item.title)}" onchange="upd(${item.id},'title',this.value)" />
      <span class="edit-label">Description</span>
      <textarea class="edit-field" rows="2" style="resize:vertical" onchange="upd(${item.id},'description',this.value)">${esc(item.description)}</textarea>

```
  <span class="edit-label">Your Price ($)</span>
  <input class="edit-field" type="number" value="${item.price}" onchange="upd(${item.id},'price',this.value)" />`;
```

}

let actions = ‘’;
if (item.status === ‘idle’) actions += `<button class="btn btn-sm" onclick="analyzeSingle('${item.id}')">⚡ Analyze</button>`;
if (item.status === ‘done’ && !item.ebayItemId) actions += `<button class="btn btn-sm btn-purple" onclick="postOne('${item.id}')">🚀 Post to eBay</button>`;
if (item.status === ‘done’ && item.ebayItemId) actions += `<a href="${item.ebayUrl}" target="_blank" class="btn btn-sm" style="background:var(--accent);color:#0a0a0f;text-decoration:none;text-align:center">✅ View on eBay</a>`;
if (item.status === ‘error’) actions += `<button class="btn btn-sm" onclick="analyzeSingle('${item.id}')">↺ Retry</button>`;
actions += `<button class="btn btn-sm btn-outline" onclick="removeItem('${item.id}')" style="flex:0;padding:7px 12px">✕</button>`;

const titleHTML = item.status === ‘processing’
? ‘<div class="skeleton" style="margin-bottom:8px"></div>’
: item.status === ‘done’
? `<div class="card-title">${esc(item.title)}</div>`
: `<div class="card-title" style="color:var(--muted);font-size:0.73rem;font-family:DM Mono">${item.file.name}</div>`;

return `<img class="card-img" src="${item.url}" alt="" loading="lazy" /> <div class="card-body"> <div class="card-status"> <div class="sdot ${item.status}"></div> <span style="color:${colors[item.status]}">${labels[item.status]}</span> ${item.category ?`<span class="tag" style="margin-left:auto">${item.category}</span>` : ''} </div> ${titleHTML} ${priceHTML} ${editHTML} <div class="card-actions">${actions}</div> </div>`;
}

function esc(s) { return (s||’’).replace(/&/g,’&’).replace(/</g,’<’).replace(/>/g,’>’).replace(/”/g,’"’); }
function upd(id, f, v) { const i = items.find(x => x.id == id); if(i) i[f] = v; }
function removeItem(id) { items = items.filter(i => i.id != id); renderGrid(); updateStats(); }
function clearAll() { items = []; renderGrid(); [‘statsBar’,‘ctrlBar’,‘gridHead’].forEach(id => document.getElementById(id).style.display=‘none’); }

async function analyzeSingle(id) {
const item = items.find(i => i.id == id);
if (!item) return;
await doAnalyze(item);
const card = document.getElementById(‘card-’ + item.id);
if (card) { card.className = ’photo-card ’ + item.status; card.innerHTML = buildCard(item); }
updateStats();
}

async function analyzeAll() {
if (busy) return;
const apiKey = document.getElementById(‘apiKey’).value.trim() || localStorage.getItem(‘fa_ck’);
if (!apiKey) { toast(‘⚠ Enter and verify your API key first!’, ‘error’); return; }

busy = true;
const queue = items.filter(i => i.status === ‘idle’ || i.status === ‘error’);
if (!queue.length) { toast(‘All items already analyzed!’, ‘success’); busy = false; return; }

document.getElementById(‘progWrap’).style.display = ‘block’;
let done = 0;

for (const item of queue) {
setProg(done, queue.length, ’Analyzing: ’ + item.file.name);
await doAnalyze(item);
done++;
setProg(done, queue.length, done < queue.length ? ‘Analyzing…’ : ‘✅ Complete!’);
const card = document.getElementById(‘card-’ + item.id);
if (card) { card.className = ’photo-card ’ + item.status; card.innerHTML = buildCard(item); }
updateStats();
}

busy = false;
const ok = items.filter(i => i.status === ‘done’).length;
toast(‘✅ ’ + ok + ’ items analyzed!’, ‘success’);
setTimeout(() => document.getElementById(‘progWrap’).style.display = ‘none’, 3000);
}

function setProg(done, total, lbl) {
document.getElementById(‘progBar’).style.width = (total > 0 ? Math.round(done/total*100) : 0) + ‘%’;
document.getElementById(‘progLbl’).textContent = lbl + ’ (’ + done + ‘/’ + total + ‘)’;
}

async function doAnalyze(item) {
const apiKey = document.getElementById(‘apiKey’).value.trim() || localStorage.getItem(‘fa_ck’);
if (!apiKey) { item.status = ‘error’; item.title = ‘No API key — enter key above’; return; }

item.status = ‘processing’;
const card = document.getElementById(‘card-’ + item.id);
if (card) { card.className = ‘photo-card processing’; card.innerHTML = buildCard(item); }

try {
const base64 = await toBase64(item.file);
const mime = item.file.type && item.file.type.startsWith(‘image/’) ? item.file.type : ‘image/jpeg’;

```
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: 'You are an eBay book seller expert. Analyze this book image. Respond with ONLY a JSON object, no markdown, no explanation, just raw JSON:\n{"title":"Book Title by Author Name - Edition if visible","description":"Brief 1-2 sentence description for eBay listing","category":"Books","condition":"Used","minPrice":5,"maxPrice":25,"avgPrice":12,"suggestedPrice":10}' }
      ]
    }]
  })
});

if (!res.ok) {
  const errText = await res.text();
  let errMsg = 'HTTP ' + res.status;
  try { errMsg = JSON.parse(errText).error?.message || errMsg; } catch(e) {}
  throw new Error(errMsg);
}

const data = await res.json();
if (data.error) throw new Error(data.error.message || 'API error');

const raw = (data.content || []).map(c => c.text || '').join('').trim();

// Extract JSON robustly
let jsonStr = raw;
jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
const s = jsonStr.indexOf('{');
const e = jsonStr.lastIndexOf('}');
if (s === -1 || e === -1) throw new Error('AI did not return valid JSON. Response: ' + raw.substring(0, 100));
jsonStr = jsonStr.slice(s, e + 1);

const p = JSON.parse(jsonStr);
item.title = p.title || 'Book Listing';
item.description = p.description || '';
item.category = p.category || 'Books';
item.condition = p.condition || 'Used';
item.minPrice = p.minPrice || 5;
item.maxPrice = p.maxPrice || 20;
item.avgPrice = p.avgPrice || 12;
item.price = p.suggestedPrice || p.avgPrice || 10;
item.status = 'done';
```

} catch(err) {
item.status = ‘error’;
item.title = ‘Failed — tap retry’;
showDebug(‘Error analyzing “’ + item.file.name + ‘”:\n’ + err.message + ‘\n\nTip: Make sure your API key is verified above first.’);
toast(’Error: ’ + err.message.substring(0, 60), ‘error’);
}
}

function toBase64(file) {
return new Promise((res, rej) => {
const r = new FileReader();
r.onload = () => res(r.result.split(’,’)[1]);
r.onerror = () => rej(new Error(‘Failed to read file’));
r.readAsDataURL(file);
});
}

function updateStats() {
const total = items.length;
const done = items.filter(i => i.status === ‘done’).length;
const val = items.filter(i => i.status === ‘done’).reduce((s,i) => s + (parseFloat(i.price)||0), 0);
document.getElementById(‘s1’).textContent = total;
document.getElementById(‘s2’).textContent = done;
document.getElementById(‘s3’).textContent = ‘$’ + Math.round(val).toLocaleString();
document.getElementById(‘s4’).textContent = done;
}

async function postOne(id) {
const item = items.find(i => i.id == id);
if (!item) return;

const serverUrl = (document.getElementById(‘serverUrl’).value.trim() || localStorage.getItem(‘fa_sv’) || ‘’).replace(//$/, ‘’);

if (!serverUrl) {
// Fallback: open eBay manually
const url = ‘https://www.ebay.com/sl/sell?title=’ + encodeURIComponent(item.title) + ‘&price=’ + item.price;
window.open(url, ‘_blank’);
toast(‘Opening eBay manually (no server URL set)’, ‘success’);
return;
}

toast(‘⏳ Posting to eBay…’, ‘success’);

try {
const res = await fetch(serverUrl + ‘/post-listing’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({
listing: {
title: item.title,
description: item.description,
price: item.price,
categoryId: 261186,
conditionId: 3000
}
})
});

```
const data = await res.json();

if (data.success) {
  item.ebayItemId = data.itemId;
  item.ebayUrl = data.url;
  toast('✅ Posted! eBay Item #' + data.itemId, 'success');
  // Update card to show eBay link
  const card = document.getElementById('card-' + item.id);
  if (card) { card.innerHTML = buildCard(item); }
} else {
  const errMsg = JSON.stringify(data.errors || data.message || 'Unknown error');
  toast('❌ eBay error: ' + errMsg.substring(0, 80), 'error');
  showDebug('eBay posting error:\n' + errMsg);
}
```

} catch(err) {
toast(’❌ Server error: ’ + err.message.substring(0, 60), ‘error’);
showDebug(‘Server connection error:\n’ + err.message);
}
}

async function postAllToEbay() {
const ready = items.filter(i => i.status === ‘done’);
if (!ready.length) { toast(‘Analyze items first!’, ‘error’); return; }
toast(‘🚀 Posting ’ + ready.length + ’ items to eBay…’, ‘success’);
for (let i = 0; i < ready.length; i++) {
await postOne(ready[i].id);
if (i < ready.length - 1) await new Promise(r => setTimeout(r, 1500));
}
}

function toast(msg, type=‘success’) {
const wrap = document.getElementById(‘toasts’);
const t = document.createElement(‘div’);
t.className = ’toast ’ + type;
t.textContent = msg;
wrap.appendChild(t);
setTimeout(() => t.remove(), 5000);
}
</script>

</body>
</html>
`;

app.get(’/’, (req, res) => {
res.setHeader(‘Content-Type’, ‘text/html’);
res.send(HTML);
});

app.post(’/post-listing’, async (req, res) => {
const { listing } = req.body;
if (!listing) return res.status(400).json({ success: false, message: ‘No listing data’ });
const token = process.env.EBAY_USER_TOKEN;
const appId = process.env.EBAY_APP_ID;
const postal = process.env.POSTAL_CODE || ‘90001’;
if (!token) return res.status(500).json({ success: false, message: ‘EBAY_USER_TOKEN not set on server’ });
const xml = `<?xml version="1.0" encoding="utf-8"?> <AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"> <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials> <Item> <Title>${esc(listing.title)}</Title> <Description><![CDATA[${listing.description || listing.title}]]></Description> <PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory> <StartPrice>${listing.price}</StartPrice> <Country>US</Country><Currency>USD</Currency> <DispatchTimeMax>3</DispatchTimeMax> <ListingDuration>GTC</ListingDuration> <ListingType>FixedPriceItem</ListingType> <PostalCode>${postal}</PostalCode> <Quantity>1</Quantity> <ShippingDetails> <ShippingType>Flat</ShippingType> <ShippingServiceOptions> <ShippingServicePriority>1</ShippingServicePriority> <ShippingService>USPSMedia</ShippingService> <ShippingServiceCost>3.99</ShippingServiceCost> </ShippingServiceOptions> </ShippingDetails> <ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy> <ConditionID>3000</ConditionID><Site>US</Site> </Item> </AddItemRequest>`;
try {
const r = await fetch(‘https://api.ebay.com/ws/api.dll’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘text/xml’, ‘X-EBAY-API-SITEID’: ‘0’, ‘X-EBAY-API-COMPATIBILITY-LEVEL’: ‘967’, ‘X-EBAY-API-CALL-NAME’: ‘AddItem’, ‘X-EBAY-API-APP-NAME’: appId || ‘’ },
body: xml
});
const text = await r.text();
if (text.includes(’<Ack>Success</Ack>’) || text.includes(’<Ack>Warning</Ack>’)) {
const match = text.match(/<ItemID>(\d+)</ItemID>/);
const itemId = match ? match[1] : ‘unknown’;
res.json({ success: true, itemId, url: ‘https://www.ebay.com/itm/’ + itemId });
} else {
const err = text.match(/<LongMessage>(.*?)</LongMessage>/);
res.status(400).json({ success: false, message: err ? err[1] : ‘eBay rejected listing’ });
}
} catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

function esc(s) { return (s||’’).replace(/&/g,’&’).replace(/</g,’<’).replace(/>/g,’>’); }
app.listen(PORT, () => console.log(’FlipAI running on port ’ + PORT));
