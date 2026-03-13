const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));

// ─── VERIFY KEYS ──────────────────────────────────────────────────────────────
app.post('/verify-keys', async (req, res) => {
  const { claudeKey, ebayToken } = req.body;
  const results = { claude: false, ebay: false, errors: [] };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
    });
    results.claude = r.status !== 401 && r.status !== 403;
    if (!results.claude) results.errors.push('Claude key invalid');
  } catch (e) { results.errors.push('Claude: ' + e.message); }
  try {
    const r = await fetch('https://api.ebay.com/buy/browse/v1/item_summary/search?q=book&limit=1', {
      headers: { 'Authorization': 'Bearer ' + ebayToken, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
    });
    results.ebay = r.status !== 401 && r.status !== 403;
    if (!results.ebay) results.errors.push('eBay token invalid');
  } catch (e) { results.errors.push('eBay: ' + e.message); }
  res.json(results);
});

// ─── BATCH BOUNDARY CHECK (THE FAST ENGINE) ───────────────────────────────────
// Receives ALL candidate boundaries at once.
// For each boundary, runs the right locks in parallel.
// Returns all decisions in one response.
//
// boundaries: Array of { index, lock1, prevImage, currImage }
//   lock1: bool (timestamp gap already evaluated client-side)
//   prevImage: last photo of current group (for Lock 3 cover compare)
//   currImage: the candidate photo (for Lock 2 separator check + Lock 3)
//
// Decision logic per boundary:
//   lock1 && !needsAPI        → split:true, reason:'ts-only'  (gap so large, skip API entirely — see threshold below)
//   lock1 && lock2            → split:true, reason:'triple', skip Lock3
//   lock1 && !lock2           → run Lock3 → split if different cover
//   !lock1 && lock2           → run Lock3 → split if different cover
//   !lock1 && !lock2          → split:false (Lock3 never runs)
//
// "needsAPI" — if gap >= SKIP_API_GAP (e.g. 60s), we trust Lock1 alone, skip all API calls.

const GAP_MS = 7000;         // minimum gap to trigger Lock 1
const SKIP_API_GAP = 60000;  // 60s gap → so obvious we skip Lock 2+3 entirely

async function claudeYesNo(claudeKey, content) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 5, messages: [{ role: 'user', content }] })
  });
  const d = await r.json();
  return (d.content?.[0]?.text || 'NO').trim().toUpperCase().startsWith('YES');
}

function imgBlock(b64) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64.replace(/^data:image\/\w+;base64,/, '') } };
}

app.post('/check-boundaries', async (req, res) => {
  const { boundaries, claudeKey } = req.body;
  if (!boundaries || !boundaries.length) return res.json({ results: [] });

  // Process ALL boundaries in parallel
  const results = await Promise.all(boundaries.map(async (b) => {
    const { index, lock1, gapMs, prevImage, currImage } = b;

    // Huge gap — trust it blindly, zero API cost
    if (lock1 && gapMs >= SKIP_API_GAP) {
      return { index, split: true, reason: 'ts-obvious', isSeparator: false };
    }

    // No signals at all — skip API entirely
    if (!lock1 && !claudeKey) {
      return { index, split: false, reason: 'none', isSeparator: false };
    }

    // Run Lock 2 (separator check) — always when we have a key
    let lock2 = false, isSeparator = false;
    if (claudeKey) {
      try {
        lock2 = await claudeYesNo(claudeKey, [
          imgBlock(currImage),
          { type: 'text', text: 'Is this photo a blank piece of paper, notecard, sticky note, or handwritten divider — NOT a book cover or book page? Reply only YES or NO.' }
        ]);
        isSeparator = lock2;
      } catch(e) { lock2 = false; }
    }

    // Lock 1 + Lock 2 both true → confirmed, skip Lock 3
    if (lock1 && lock2) {
      return { index, split: true, reason: 'ts+notecard', isSeparator };
    }

    // Exactly one signal → run Lock 3 (cover comparison)
    if ((lock1 || lock2) && claudeKey) {
      try {
        const isNewCover = await claudeYesNo(claudeKey, [
          imgBlock(prevImage),
          imgBlock(currImage),
          { type: 'text', text: 'Image 1 is from one book. Image 2 is the very next photo in a camera roll. Are these TWO DIFFERENT books — different title, different cover? Reply only YES or NO.' }
        ]);
        if (isNewCover) {
          const reason = lock1 ? 'ts+cover' : 'notecard+cover';
          return { index, split: true, reason, isSeparator };
        } else {
          return { index, split: false, reason: 'lock3-overruled', isSeparator: false };
        }
      } catch(e) {
        return { index, split: false, reason: 'lock3-error', isSeparator: false };
      }
    }

    // No signals, no key, or key missing
    return { index, split: false, reason: 'none', isSeparator: false };
  }));

  res.json({ results });
});

// ─── ANALYZE BOOK ─────────────────────────────────────────────────────────────
app.post('/analyze-book', async (req, res) => {
  const { images, claudeKey } = req.body;
  if (!images || !images.length) return res.status(400).json({ error: 'No images' });
  const imageBlocks = images.slice(0, 5).map(b64 => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: b64.replace(/^data:image\/\w+;base64,/, '') }
  }));
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022', max_tokens: 1024,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: 'You are a used book expert listing books on eBay. Respond ONLY with a JSON object, no markdown:\n{"title":"exact title","author":"full name","format":"Paperback|Hardcover|Mass Market Paperback","language":"English","isbn":"isbn or null","condition_notes":"brief honest note","price":6.99,"description":"2-3 sentence eBay listing description"}' }] }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Claude error' });
    const book = JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim());
    res.json(book);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST TO EBAY ─────────────────────────────────────────────────────────────
function xesc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

app.post('/post-to-ebay', async (req, res) => {
  const { book, images, ebayToken } = req.body;
  const pics = (images||[]).slice(0,12).map(u => `<PictureURL>${u}</PictureURL>`).join('');
  const xml = `<?xml version="1.0" encoding="utf-8"?><AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${ebayToken}</eBayAuthToken></RequesterCredentials><Item><Title>${xesc(book.title+' by '+book.author)}</Title><Description><![CDATA[${book.description}\n\nCondition: ${book.condition_notes}. Ships USPS Media Mail.]]></Description><PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory><StartPrice>${book.price}</StartPrice><ConditionID>3000</ConditionID><Country>US</Country><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><PostalCode>14701</PostalCode><Quantity>1</Quantity><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>USPSMediaMail</ShippingService><ShippingServiceCost>3.99</ShippingServiceCost></ShippingServiceOptions></ShippingDetails><ItemSpecifics><NameValueList><n>Author</n><Value>${xesc(book.author||'')}</Value></NameValueList><NameValueList><n>Format</n><Value>${xesc(book.format||'Paperback')}</Value></NameValueList><NameValueList><n>Language</n><Value>${xesc(book.language||'English')}</Value></NameValueList>${book.isbn?`<NameValueList><n>ISBN</n><Value>${xesc(book.isbn)}</Value></NameValueList>`:''}</ItemSpecifics><PictureDetails>${pics}</PictureDetails><ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy></Item></AddItemRequest>`;
  try {
    const r = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: { 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'AddItem', 'X-EBAY-API-SITEID': '0', 'Content-Type': 'text/xml' },
      body: xml
    });
    const text = await r.text();
    if (text.includes('<Ack>Failure</Ack>')) {
      const m = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
      return res.status(400).json({ error: m ? m[1] : 'eBay listing failed' });
    }
    const m = text.match(/<ItemID>(\d+)<\/ItemID>/);
    res.json({ success: true, itemId: m?.[1], ebayUrl: m ? `https://www.ebay.com/itm/${m[1]}` : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => { res.type('html').send(HTML); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FlipAI Bookslayer running on port ${PORT}`));

// ═════════════════════════════════════════════════════════════════════════════
//  UI
// ═════════════════════════════════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlipAI – Bookslayer</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a10;color:#e8e8f0;min-height:100vh}
.hdr{background:linear-gradient(135deg,#12122a,#0e1628);padding:18px 24px;border-bottom:1px solid #1e1e40}
.hdr h1{font-size:1.5rem;font-weight:900;color:#a78bfa}
.hdr p{font-size:.8rem;color:#5050a0;margin-top:3px}
.wrap{max-width:980px;margin:0 auto;padding:22px 14px}
.card{background:#13132a;border:1px solid #1e1e40;border-radius:14px;padding:20px;margin-bottom:18px}
.card-title{font-size:.78rem;font-weight:800;color:#a78bfa;text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px}

/* KEYS */
.keys-row{display:flex;gap:8px;flex-wrap:wrap}
.keys-row input{flex:1;min-width:170px;background:#08080f;border:1px solid #2a2a4a;border-radius:8px;padding:10px 13px;color:#e8e8f0;font-size:.87rem}
.keys-row input:focus{outline:none;border-color:#a78bfa}
.keys-row input::placeholder{color:#3a3a6a}
.btn-verify{background:#a78bfa;color:#08080f;border:none;border-radius:8px;padding:10px 18px;font-weight:800;font-size:.87rem;cursor:pointer;white-space:nowrap}
.btn-verify:hover{background:#c4b5fd}
.btn-verify:disabled{background:#2a1a5a;color:#5050a0;cursor:not-allowed}
.v-status{font-size:.8rem;padding:7px 12px;border-radius:7px;margin-top:8px;display:none}
.v-status.ok{background:#0a2010;border:1px solid #22c55e;color:#86efac;display:block}
.v-status.err{background:#200a0a;border:1px solid #ef4444;color:#fca5a5;display:block}
.v-status.chk{background:#131320;border:1px solid #a78bfa;color:#c4b5fd;display:block}

/* TRIPLE LOCK EXPLAINER */
.locks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.lock{background:#0a0a18;border:1px solid #1e1e3a;border-radius:10px;padding:14px;text-align:center}
.lk-icon{font-size:1.5rem;margin-bottom:6px}
.lk-name{font-size:.82rem;font-weight:800;color:#e8e8f0;margin-bottom:4px}
.lk-desc{font-size:.72rem;color:#5060a0;line-height:1.5}
.lk-tag{font-size:.65rem;padding:2px 8px;border-radius:20px;display:inline-block;margin-top:6px}
.tag-auto{background:#1a0a3a;border:1px solid #7c3aed;color:#a78bfa}
.tag-sep{background:#1a1500;border:1px solid #ca8a04;color:#fbbf24}
.tag-ai{background:#0a1a30;border:1px solid #2563eb;color:#60a5fa}
.logic-bar{background:#0a0a18;border:1px solid #1e1e3a;border-radius:10px;padding:13px 16px;margin-top:12px;font-size:.78rem;color:#6060a0;line-height:2}
.logic-bar strong{color:#c4b5fd}
.cg{color:#22c55e}.cb{color:#60a5fa}.cd{color:#2a2a4a}
.speed-badge{display:inline-flex;align-items:center;gap:6px;background:#0a1a10;border:1px solid #22c55e44;border-radius:8px;padding:7px 14px;font-size:.78rem;color:#22c55e;margin-top:12px}

/* DROP */
.drop{background:#13132a;border:2px dashed #2a2a4a;border-radius:14px;padding:38px 20px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;margin-bottom:18px}
.drop:hover,.drop.over{border-color:#a78bfa;background:#16163a}
.d-icon{font-size:2.8rem;margin-bottom:10px}
.drop h2{font-size:1rem;font-weight:800;margin-bottom:6px}
.drop p{color:#5060a0;font-size:.82rem;line-height:1.6}

/* STATS */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}
.stat{background:#13132a;border:1px solid #1e1e40;border-radius:10px;padding:13px;text-align:center}
.stat .n{font-size:1.5rem;font-weight:900;color:#a78bfa}
.stat .l{font-size:.67rem;color:#404070;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}

/* PROGRESS — compact, single bar */
.prog-wrap{background:#13132a;border:1px solid #1e1e40;border-radius:10px;padding:14px 16px;margin-bottom:18px;display:none}
.prog-wrap.on{display:block}
.prog-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.prog-label{font-size:.83rem;color:#9090c0}
.prog-pct{font-size:.78rem;color:#5060a0;font-variant-numeric:tabular-nums}
.prog-bar-bg{background:#080810;border-radius:20px;height:6px;overflow:hidden;margin-bottom:8px}
.prog-bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:20px;transition:width .3s ease}
.prog-sub{font-size:.72rem;color:#404060}

/* PHASE INDICATOR */
.phase{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.ph{font-size:.7rem;padding:3px 10px;border-radius:20px;border:1px solid transparent;transition:all .2s}
.ph.idle{background:#0a0a18;border-color:#1a1a30;color:#2a2a50}
.ph.active{background:#1a0840;border-color:#7c3aed;color:#a78bfa;animation:pulse .9s infinite}
.ph.done{background:#0a2010;border-color:#22c55e44;color:#22c55e}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* GRID */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.bk{background:#13132a;border:1px solid #1e1e40;border-radius:12px;overflow:hidden}
.bk-thumb{width:100%;height:155px;object-fit:cover;background:#080810;display:block}
.bk-nothumb{width:100%;height:155px;background:#080810;display:flex;align-items:center;justify-content:center;font-size:2.2rem}
.bk-info{padding:11px}
.bdg{font-size:.65rem;font-weight:800;padding:2px 8px;border-radius:20px;display:inline-block;margin-bottom:5px}
.bdg-pending{background:#1e1e40;color:#6060a0}
.bdg-analyzing{background:#1a0840;color:#a78bfa}
.bdg-done{background:#082010;color:#22c55e}
.bdg-posted{background:#081830;color:#60a5fa}
.bdg-error{background:#1a0808;color:#ef4444}
.bk-title{font-size:.87rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bk-author{font-size:.75rem;color:#5060a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bk-price{font-size:.98rem;font-weight:900;color:#22c55e;margin-top:5px}
.bk-meta{font-size:.72rem;color:#3a3a6a;margin-top:2px}
.bk-err{font-size:.72rem;color:#ef4444;margin-top:4px}
.bk-acts{display:flex;gap:6px;padding:0 11px 11px}
.bsm{border:none;border-radius:6px;padding:5px 11px;font-size:.75rem;font-weight:800;cursor:pointer}
.bsm-p{background:#a78bfa;color:#08080f}.bsm-p:hover{background:#c4b5fd}
.bsm-g{background:#22c55e;color:#08080f}.bsm-g:hover{background:#4ade80}
.bsm-gh{background:transparent;border:1px solid #2a2a4a;color:#6060a0}.bsm-gh:hover{border-color:#ef4444;color:#ef4444}
.bsm-y{background:#fbbf24;color:#0a0800}.bsm-y:hover{background:#fde68a}

/* SPLIT DIVIDERS */
.split-div{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:4px 0}
.split-div::before,.split-div::after{content:'';flex:1;height:1px}
.split-div.ts::before,.split-div.ts::after{background:linear-gradient(90deg,transparent,#7c3aed44,transparent)}
.split-div.sep::before,.split-div.sep::after{background:linear-gradient(90deg,transparent,#ca8a0444,transparent)}
.split-div.cover::before,.split-div.cover::after{background:linear-gradient(90deg,transparent,#2563eb44,transparent)}
.split-div.triple::before,.split-div.triple::after{background:linear-gradient(90deg,transparent,#22c55e44,transparent)}
.split-pill{font-size:.68rem;padding:3px 11px;border-radius:20px;white-space:nowrap}
.sp-ts{background:#120820;border:1px solid #7c3aed44;color:#7c3aed}
.sp-sep{background:#1a1200;border:1px solid #ca8a0444;color:#ca8a04}
.sp-cover{background:#080e20;border:1px solid #2563eb44;color:#2563eb}
.sp-triple{background:#081a10;border:1px solid #22c55e44;color:#22c55e}

/* ACTIONS */
.actions{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.btn{border:none;border-radius:8px;padding:11px 20px;font-weight:800;font-size:.87rem;cursor:pointer;transition:all .2s}
.btn-p{background:#a78bfa;color:#08080f}.btn-p:hover{background:#c4b5fd}
.btn-p:disabled{background:#1e0e4a;color:#4040a0;cursor:not-allowed}
.btn-g{background:#22c55e;color:#08080f}.btn-g:hover{background:#4ade80}
.btn-g:disabled{background:#082010;color:#1a4a2a;cursor:not-allowed}
.btn-ghost{background:transparent;border:1px solid #2a2a4a;color:#6060a0}
.btn-ghost:hover{border-color:#ef4444;color:#ef4444}

/* MODAL */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:100;padding:14px}
.modal-bg.on{display:flex}
.modal{background:#13132a;border:1px solid #2a2a4a;border-radius:16px;width:100%;max-width:460px;overflow:hidden}
.modal-img{width:100%;height:190px;object-fit:cover;background:#080810}
.modal-body{padding:18px}
.m-title{font-size:1.08rem;font-weight:800;margin-bottom:2px}
.m-author{font-size:.85rem;color:#5060a0;margin-bottom:13px}
.m-row{display:flex;justify-content:space-between;font-size:.83rem;padding:6px 0;border-bottom:1px solid #1a1a3a}
.m-row:last-of-type{border:0}
.m-lbl{color:#404070}.m-val{font-weight:700}
.m-price{font-size:1.4rem;font-weight:900;color:#22c55e;margin:13px 0 15px}
.m-btns{display:flex;gap:10px}
.m-btns button{flex:1;padding:12px;border-radius:8px;font-weight:800;font-size:.88rem;cursor:pointer;border:none}
.btn-confirm{background:#22c55e;color:#08080f}.btn-confirm:hover{background:#4ade80}
.btn-cancel-m{background:#1e1e40;color:#8080c0}.btn-cancel-m:hover{background:#2a2a50}
.empty{text-align:center;padding:56px 20px;color:#2a2a4a;grid-column:1/-1}
.empty .ei{font-size:3rem;margin-bottom:12px}
</style>
</head>
<body>
<div class="hdr">
  <h1>📚 FlipAI Bookslayer</h1>
  <p>Triple Lock™ · Parallel batch grouping — all photos processed in one shot</p>
</div>
<div class="wrap">

<!-- KEYS -->
<div class="card">
  <div class="card-title">Step 1 — API Keys</div>
  <div class="keys-row">
    <input type="password" id="claudeKey" placeholder="Claude API Key (sk-ant-...)">
    <input type="password" id="ebayToken" placeholder="eBay User Token (v^1.1#i^1...)">
    <button class="btn-verify" id="vBtn" onclick="verifyKeys()">Verify Keys</button>
  </div>
  <div class="v-status" id="vStatus"></div>
</div>

<!-- TRIPLE LOCK -->
<div class="card">
  <div class="card-title">Triple Lock™ — How It Groups</div>
  <div class="locks">
    <div class="lock">
      <div class="lk-icon">⏱️</div>
      <div class="lk-name">Lock 1 — 7s Gap</div>
      <div class="lk-desc">Evaluated instantly on ALL photos at once. Zero API calls. Free.</div>
      <div class="lk-tag tag-auto">Instant · local only</div>
    </div>
    <div class="lock">
      <div class="lk-icon">📄</div>
      <div class="lk-name">Lock 2 — Notecard</div>
      <div class="lk-desc">Only runs on candidate boundaries. All checked in parallel — not one by one.</div>
      <div class="lk-tag tag-sep">Parallel · Haiku</div>
    </div>
    <div class="lock">
      <div class="lk-icon">📖</div>
      <div class="lk-name">Lock 3 — New Cover</div>
      <div class="lk-desc">Tiebreaker only. Runs in parallel with other Lock 3 checks across all boundaries.</div>
      <div class="lk-tag tag-ai">Parallel · tiebreaker</div>
    </div>
  </div>
  <div class="logic-bar">
    <strong>Lock 1 ✓ + Lock 2 ✓</strong> → <span class="cg">✅ Split — Lock 3 skipped</span><br>
    <strong>Lock 1 ✓ + Lock 2 ✗</strong> → <span class="cb">🔍 Lock 3 tiebreaker</span> &nbsp;|&nbsp;
    <strong>Lock 1 ✗ + Lock 2 ✓</strong> → <span class="cb">🔍 Lock 3 tiebreaker</span><br>
    <strong>Lock 1 ✗ + Lock 2 ✗</strong> → <span class="cd">⛔ Same book — no API calls wasted</span>
  </div>
  <div class="speed-badge">⚡ All boundary checks fire simultaneously — 50 photos groups as fast as 5</div>
</div>

<!-- DROP -->
<div class="drop" id="dropZone"
  onclick="document.getElementById('fileIn').click()"
  ondragover="event.preventDefault();this.classList.add('over')"
  ondragleave="this.classList.remove('over')"
  ondrop="handleDrop(event)">
  <div class="d-icon">📷</div>
  <h2>Dump Your Entire Camera Roll</h2>
  <p>Select ALL book photos at once. Triple Lock groups them in one parallel batch.<br>
  <strong style="color:#a78bfa">Tip:</strong> Pause 7s between books and/or snap a blank notecard as a divider.</p>
  <input type="file" id="fileIn" multiple accept="image/*" style="display:none" onchange="handleFiles(this.files)">
</div>

<!-- STATS -->
<div class="stats">
  <div class="stat"><div class="n" id="sPhotos">0</div><div class="l">Photos</div></div>
  <div class="stat"><div class="n" id="sBooks">0</div><div class="l">Books</div></div>
  <div class="stat"><div class="n" id="sAnalyzed">0</div><div class="l">Analyzed</div></div>
  <div class="stat"><div class="n" id="sValue">$0</div><div class="l">Est. Value</div></div>
  <div class="stat"><div class="n" id="sPosted">0</div><div class="l">Posted</div></div>
</div>

<!-- ACTIONS -->
<div class="actions">
  <button class="btn btn-p" id="analyzeBtn" onclick="analyzeAll()" disabled>Analyze All</button>
  <button class="btn btn-g" id="postBtn" onclick="postAll()" disabled>Post All to eBay</button>
  <button class="btn btn-ghost" onclick="clearAll()">Clear All</button>
</div>

<!-- PROGRESS -->
<div class="prog-wrap" id="progWrap">
  <div class="prog-top">
    <div class="prog-label" id="progLabel">Processing...</div>
    <div class="prog-pct" id="progPct">0%</div>
  </div>
  <div class="prog-bar-bg"><div class="prog-bar-fill" id="progFill" style="width:0%"></div></div>
  <div class="phase" id="phaseRow">
    <div class="ph idle" id="ph1">⚡ Lock 1 — timestamp scan</div>
    <div class="ph idle" id="ph2">📡 Sending to server</div>
    <div class="ph idle" id="ph3">🔀 Parallel AI checks</div>
    <div class="ph idle" id="ph4">✅ Grouping complete</div>
  </div>
  <div class="prog-sub" id="progSub"></div>
</div>

<!-- GRID -->
<div class="grid" id="grid">
  <div class="empty"><div class="ei">📚</div><div>Drop photos above — books appear here</div></div>
</div>
</div>

<!-- MODAL -->
<div class="modal-bg" id="modal">
  <div class="modal">
    <img class="modal-img" id="mImg" src="" alt="">
    <div class="modal-body">
      <div class="m-title" id="mTitle">—</div>
      <div class="m-author" id="mAuthor">—</div>
      <div class="m-row"><span class="m-lbl">Format</span><span class="m-val" id="mFormat">—</span></div>
      <div class="m-row"><span class="m-lbl">Condition</span><span class="m-val" id="mCond">—</span></div>
      <div class="m-row"><span class="m-lbl">Shipping</span><span class="m-val">$3.99 USPS Media Mail</span></div>
      <div class="m-row"><span class="m-lbl">Photos</span><span class="m-val" id="mPhotos">—</span></div>
      <div class="m-price" id="mPrice">—</div>
      <div class="m-btns">
        <button class="btn-confirm" onclick="confirmPost()">✓ Yes, Post to eBay</button>
        <button class="btn-cancel-m" onclick="closeModal()">✗ Cancel</button>
      </div>
    </div>
  </div>
</div>

<script>
// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let books = [];
let pendingPostId = null;
const GAP_MS = 7000;
const SKIP_API_GAP = 60000;

// ══════════════════════════════════════════════════════
//  VERIFY
// ══════════════════════════════════════════════════════
async function verifyKeys() {
  const ck = $('claudeKey').value.trim(), et = $('ebayToken').value.trim();
  const btn = $('vBtn'), st = $('vStatus');
  if (!ck || !et) { showStatus(st,'err','Enter both keys first.'); return; }
  btn.disabled=true; btn.textContent='Checking...';
  showStatus(st,'chk','Contacting APIs...');
  try {
    const r = await post('/verify-keys', { claudeKey: ck, ebayToken: et });
    showStatus(st, r.claude&&r.ebay?'ok':'err',
      (r.claude?'✅':'❌')+' Claude   '+(r.ebay?'✅':'❌')+' eBay'+(r.errors?.length?'  —  '+r.errors.join(' | '):''));
  } catch(e) { showStatus(st,'err','Network error: '+e.message); }
  btn.disabled=false; btn.textContent='Verify Keys';
}

// ══════════════════════════════════════════════════════
//  FILE HANDLING
// ══════════════════════════════════════════════════════
function handleDrop(e) { e.preventDefault(); $('dropZone').classList.remove('over'); handleFiles(e.dataTransfer.files); }

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  // Phase 1 — read files in parallel
  setPhase(1, 'Scanning timestamps...', 0);
  const photos = await Promise.all(files.map(f => new Promise(res => {
    const r = new FileReader();
    r.onload = e => res({ file: f, dataUrl: e.target.result, ts: f.lastModified || 0 });
    r.readAsDataURL(f);
  })));
  photos.sort((a, b) => a.ts - b.ts);

  setPhase(1, 'Lock 1: evaluating ' + photos.length + ' timestamps...', 10, true);
  await tripleGroupFast(photos);

  setPhase(4, 'Grouping complete — ' + books.length + ' books found!', 100, true);
  setTimeout(() => $('progWrap').classList.remove('on'), 2000);
  renderAll();
  updateStats();
}

// ══════════════════════════════════════════════════════
//  TRIPLE LOCK — PARALLEL BATCH ENGINE
// ══════════════════════════════════════════════════════
async function tripleGroupFast(photos) {
  books = [];
  if (!photos.length) return;
  const ck = $('claudeKey').value.trim();

  // ── STEP 1: Lock 1 runs instantly on all photos, zero API ──────────────────
  // Find every boundary between consecutive photos
  const boundaries = [];
  for (let i = 1; i < photos.length; i++) {
    const gapMs = Math.abs(photos[i].ts - photos[i-1].ts);
    const lock1 = gapMs >= GAP_MS;
    // A boundary needs API attention only if lock1 fired OR we have a key to check for separators
    // We always submit lock1=false boundaries for separator check (notecard could appear anytime)
    boundaries.push({
      index: i,
      lock1,
      gapMs,
      prevImage: photos[i-1].dataUrl,  // last of current group
      currImage: photos[i].dataUrl     // candidate next photo
    });
  }

  setPhase(1, 'Lock 1 complete — ' + boundaries.filter(b=>b.lock1).length + ' time gaps found', 25, true);

  // ── STEP 2: Send ALL boundaries to server in ONE request ───────────────────
  // Server evaluates them all in parallel, returns all decisions at once
  setPhase(2, 'Sending ' + boundaries.length + ' boundaries to server...', 35);

  let decisions = {};
  if (ck) {
    try {
      setPhase(3, 'Running parallel AI checks on all boundaries...', 50);
      const result = await post('/check-boundaries', { boundaries, claudeKey: ck });
      // Map index → decision
      result.results.forEach(r => { decisions[r.index] = r; });
      setPhase(3, 'AI checks complete', 85, true);
    } catch(e) {
      // Fallback: use timestamp-only grouping
      setPhase(3, 'AI unavailable — using timestamp grouping only', 85, true);
    }
  } else {
    setPhase(3, 'No Claude key — using timestamp grouping only', 85, true);
  }

  // ── STEP 3: Apply decisions to build groups ────────────────────────────────
  let group = [photos[0]];

  for (let i = 1; i < photos.length; i++) {
    const dec = decisions[i];
    const gapMs = Math.abs(photos[i].ts - photos[i-1].ts);

    let doSplit = false;
    let splitReason = 'first';

    if (dec) {
      doSplit = dec.split;
      splitReason = dec.reason;
    } else {
      // No AI decision (no key) — fall back to Lock 1 only
      doSplit = gapMs >= GAP_MS;
      splitReason = 'ts-only';
    }

    if (doSplit) {
      if (dec?.isSeparator) {
        // Separator photo is discarded — don't add to any group
        books.push({ id: books.length, photos: [...group], status: 'pending', data: null, splitReason, error: null });
        group = [];
      } else {
        books.push({ id: books.length, photos: [...group], status: 'pending', data: null, splitReason, error: null });
        group = [photos[i]];
      }
    } else {
      if (!dec?.isSeparator) group.push(photos[i]);
    }
  }

  if (group.length > 0) {
    books.push({ id: books.length, photos: [...group], status: 'pending', data: null, splitReason: 'first', error: null });
  }
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════
const DIVIDERS = {
  'ts+notecard':    { cls:'triple', pill:'sp-triple', label:'⏱️📄 7s gap + notecard' },
  'ts+cover':       { cls:'cover',  pill:'sp-cover',  label:'⏱️📖 7s gap + cover confirmed' },
  'notecard+cover': { cls:'cover',  pill:'sp-cover',  label:'📄📖 Notecard + cover confirmed' },
  'ts-obvious':     { cls:'ts',     pill:'sp-ts',     label:'⏱️ Large time gap' },
  'ts-only':        { cls:'ts',     pill:'sp-ts',     label:'⏱️ 7s gap' },
};

function renderAll() {
  const grid = $('grid');
  grid.innerHTML = '';
  if (!books.length) {
    grid.innerHTML = '<div class="empty"><div class="ei">📚</div><div>Drop photos above — books appear here</div></div>';
    $('analyzeBtn').disabled = true; $('postBtn').disabled = true;
    return;
  }
  books.forEach((book, i) => {
    if (i > 0) {
      const info = DIVIDERS[book.splitReason];
      if (info) {
        const d = document.createElement('div');
        d.className = 'split-div ' + info.cls;
        d.innerHTML = '<span class="split-pill '+info.pill+'">'+info.label+'</span>';
        grid.appendChild(d);
      }
    }
    grid.appendChild(makeCard(book));
  });
  $('analyzeBtn').disabled = false;
  $('postBtn').disabled = !books.some(b => b.status === 'done');
}

function makeCard(book) {
  const el = document.createElement('div');
  el.className = 'bk'; el.id = 'bk-' + book.id;
  const thumb = book.photos[0]?.dataUrl;
  const BDGS = { pending:'bdg-pending', analyzing:'bdg-analyzing', done:'bdg-done', posted:'bdg-posted', error:'bdg-error' };
  const BLAB = { pending:'Pending', analyzing:'⏳ Analyzing…', done:'✓ Ready', posted:'🚀 Posted', error:'✗ Error' };
  el.innerHTML =
    (thumb ? '<img class="bk-thumb" src="'+thumb+'">' : '<div class="bk-nothumb">📖</div>') +
    '<div class="bk-info">' +
      '<span class="bdg '+(BDGS[book.status]||'bdg-pending')+'">'+(BLAB[book.status]||'Pending')+'</span>' +
      '<div class="bk-title">'+(book.data?.title||'Not yet analyzed')+'</div>' +
      '<div class="bk-author">'+(book.data?.author||'')+'</div>' +
      (book.data?.price ? '<div class="bk-price">$'+book.data.price+'</div>' : '') +
      '<div class="bk-meta">📷 '+book.photos.length+' photo'+(book.photos.length!==1?'s':'')+'</div>' +
      (book.error ? '<div class="bk-err">'+book.error+'</div>' : '') +
    '</div><div class="bk-acts">' +
      (book.status==='pending'||book.status==='error' ? '<button class="bsm bsm-p" onclick="analyzeOne('+book.id+')">Analyze</button>' : '') +
      (book.status==='done' ? '<button class="bsm bsm-g" onclick="openModal('+book.id+')">Post</button>' : '') +
      (book.status==='posted' ? '<a href="'+book.ebayUrl+'" target="_blank"><button class="bsm bsm-y">View eBay</button></a>' : '') +
      '<button class="bsm bsm-gh" onclick="removeBook('+book.id+')">✕</button>' +
    '</div>';
  return el;
}

function updateStats() {
  const tp = books.reduce((s,b)=>s+b.photos.length,0);
  const an = books.filter(b=>b.status==='done'||b.status==='posted').length;
  const po = books.filter(b=>b.status==='posted').length;
  const va = books.filter(b=>b.data?.price).reduce((s,b)=>s+(b.data.price||0),0);
  $('sPhotos').textContent=tp; $('sBooks').textContent=books.length;
  $('sAnalyzed').textContent=an; $('sValue').textContent='$'+va.toFixed(0); $('sPosted').textContent=po;
}

// ══════════════════════════════════════════════════════
//  ANALYZE
// ══════════════════════════════════════════════════════
async function analyzeOne(bookId) {
  const book = books.find(b=>b.id===bookId);
  if (!book) return;
  const ck = $('claudeKey').value.trim();
  if (!ck) { alert('Enter Claude API key first.'); return; }
  book.status='analyzing'; book.error=null; renderAll();
  try {
    const d = await post('/analyze-book', { images: book.photos.map(p=>p.dataUrl), claudeKey: ck });
    book.data=d; book.status='done';
  } catch(e) { book.status='error'; book.error=e.message; }
  renderAll(); updateStats();
}

async function analyzeAll() {
  const ck = $('claudeKey').value.trim();
  if (!ck) { alert('Enter Claude API key first.'); return; }
  const pending = books.filter(b=>b.status==='pending'||b.status==='error');
  if (!pending.length) return;
  $('progWrap').classList.add('on');
  for (let i=0; i<pending.length; i++) {
    setProg('Analyzing book '+(i+1)+' of '+pending.length+'...', Math.round((i/pending.length)*100));
    await analyzeOne(pending[i].id);
  }
  setProg('✅ Done — '+pending.length+' books analyzed!', 100);
  setTimeout(()=>$('progWrap').classList.remove('on'),2000);
  updateStats();
}

// ══════════════════════════════════════════════════════
//  POST
// ══════════════════════════════════════════════════════
function openModal(bookId) {
  const book = books.find(b=>b.id===bookId);
  if (!book?.data) return;
  pendingPostId = bookId;
  $('mImg').src=book.photos[0]?.dataUrl||'';
  $('mTitle').textContent=book.data.title||'—';
  $('mAuthor').textContent='by '+(book.data.author||'—');
  $('mFormat').textContent=book.data.format||'—';
  $('mCond').textContent=book.data.condition_notes||'—';
  $('mPhotos').textContent=book.photos.length+' photos';
  $('mPrice').textContent=book.data.price?'$'+book.data.price:'—';
  $('modal').classList.add('on');
}
function closeModal() { $('modal').classList.remove('on'); pendingPostId=null; }

async function confirmPost() {
  const bookId=pendingPostId; closeModal();
  if (bookId===null) return;
  const book=books.find(b=>b.id===bookId);
  const et=$('ebayToken').value.trim();
  if (!book||!et) { alert('Enter eBay token first.'); return; }
  book.status='analyzing'; renderAll();
  try {
    const d = await post('/post-to-ebay', { book: book.data, images: book.photos.map(p=>p.dataUrl), ebayToken: et });
    book.status='posted'; book.ebayUrl=d.ebayUrl;
  } catch(e) { book.status='error'; book.error=e.message; }
  renderAll(); updateStats();
}

async function postAll() {
  const ready = books.filter(b=>b.status==='done');
  for (const book of ready) {
    openModal(book.id);
    await new Promise(resolve => {
      const oC=window.confirmPost, oX=window.closeModal;
      window.confirmPost=async()=>{oX();window.confirmPost=oC;window.closeModal=oX;await _postDirect(book.id);resolve();};
      window.closeModal=()=>{$('modal').classList.remove('on');pendingPostId=null;window.confirmPost=oC;window.closeModal=oX;resolve();};
    });
    await new Promise(r=>setTimeout(r,400));
  }
}

async function _postDirect(bookId) {
  const book=books.find(b=>b.id===bookId), et=$('ebayToken').value.trim();
  if (!book||!et) return;
  book.status='analyzing'; renderAll();
  try {
    const d=await post('/post-to-ebay',{book:book.data,images:book.photos.map(p=>p.dataUrl),ebayToken:et});
    book.status='posted'; book.ebayUrl=d.ebayUrl;
  } catch(e){book.status='error';book.error=e.message;}
  renderAll(); updateStats();
}

function removeBook(id_){books=books.filter(b=>b.id!==id_);renderAll();updateStats();}
function clearAll(){if(books.length&&!confirm('Clear everything?'))return;books=[];$('fileIn').value='';renderAll();updateStats();}

// ══════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════
function $(x){return document.getElementById(x);}
function showStatus(el,cls,txt){el.className='v-status '+cls;el.textContent=txt;}
function setProg(label,pct){$('progLabel').textContent=label;$('progFill').style.width=pct+'%';$('progPct').textContent=pct+'%';}

function setPhase(activeNum, label, pct, markDone=false) {
  $('progWrap').classList.add('on');
  setProg(label, pct);
  [1,2,3,4].forEach(n => {
    const el = $('ph'+n);
    if (n < activeNum || (n === activeNum && markDone)) el.className='ph done';
    else if (n === activeNum) el.className='ph active';
    else el.className='ph idle';
  });
}

async function post(url, body) {
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
</script>
</body>
</html>`;
