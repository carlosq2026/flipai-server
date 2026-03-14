const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  next();
});

app.use(express.json({ limit: '100mb' }));

// ─── VERIFY CLAUDE KEY ────────────────────────────────────────────────────────
app.post('/verify', async function(req, res) {
  var apiKey = req.body.apiKey;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ANALYZE BOOK PHOTOS (single Sonnet call ~$0.03/book) ─────────────────────
app.post('/analyze', async function(req, res) {
  var apiKey = req.body.apiKey;
  var images = req.body.images;
  if (!apiKey || !images || !images.length) return res.status(400).json({ error: 'Missing apiKey or images' });
  try {
    var content = [];
    images.forEach(function(img) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data } });
    });
    content.push({ type: 'text', text: 'You are a professional book reseller. Analyze these book photos for eBay listing. Reply ONLY with raw JSON, no markdown, no explanation:\n{"title":"Full Title","author":"Author Name or Unknown","bookTitle":"Title Only","format":"Hardcover or Paperback or Trade Paperback","language":"English","description":"2-3 sentences describing the book and visible condition","genre":"Fiction or Nonfiction or Mystery etc","publisher":"Publisher Name or unknown","publicationYear":"YYYY or unknown","isbn":"ISBN if visible or unknown","topic":"main subject/topic","condition":"Brand New or Like New or Very Good or Good or Acceptable","firstEdition":"Yes if 1st edition stated on copyright page or cover, No otherwise","minPrice":5,"maxPrice":25,"avgPrice":12,"suggestedPrice":10}' });
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: content }] })
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── UPLOAD PHOTO TO EBAY ─────────────────────────────────────────────────────
async function uploadPhotoToEbay(base64Data, mimeType, appId, token) {
  var boundary = 'FLIPAI_' + Date.now();
  var imgBuffer = Buffer.from(base64Data, 'base64');
  var ext = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  var CRLF = '\r\n';
  var xmlPayload = '<?xml version="1.0" encoding="utf-8"?>' +
    '<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    '<RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials>' +
    '<PictureName>flipai_book</PictureName>' +
    '<PictureSet>Supersize</PictureSet>' +
    '</UploadSiteHostedPicturesRequest>';
  var xmlPart = Buffer.from(
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="XML Payload"' + CRLF +
    'Content-Type: text/xml;charset=utf-8' + CRLF + CRLF +
    xmlPayload + CRLF,
    'utf8'
  );
  var imgHeader = Buffer.from(
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="image"; filename="book.' + ext + '"' + CRLF +
    'Content-Type: ' + (mimeType || 'image/jpeg') + CRLF +
    'Content-Transfer-Encoding: binary' + CRLF + CRLF,
    'utf8'
  );
  var imgFooter = Buffer.from(CRLF + '--' + boundary + '--' + CRLF, 'utf8');
  var fullBody = Buffer.concat([xmlPart, imgHeader, imgBuffer, imgFooter]);
  var r = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'UploadSiteHostedPictures',
      'X-EBAY-API-APP-NAME': appId || '',
      'Content-Length': String(fullBody.length)
    },
    body: fullBody
  });
  var text = await r.text();
  var match = text.match(/<FullURL>(.*?)<\/FullURL>/);
  if (match) return match[1];
  console.log('Photo upload failed:', text.substring(0, 400));
  throw new Error('Photo upload failed: ' + text.substring(0, 150));
}

// ─── POST LISTING TO EBAY ─────────────────────────────────────────────────────
app.post('/post-listing', async function(req, res) {
  var listing = req.body.listing;
  var images = req.body.images || [];
  if (!listing) return res.status(400).json({ success: false, message: 'No listing data' });
  var token = process.env.EBAY_USER_TOKEN;
  var appId = process.env.EBAY_APP_ID;
  var postal = process.env.POSTAL_CODE || '14701';
  if (!token) return res.status(500).json({ success: false, message: 'EBAY_USER_TOKEN not set in Railway env vars' });

  try {
    // Upload all photos in parallel
    var uploadPromises = images.slice(0, 12).map(function(img) {
      return uploadPhotoToEbay(img.data, img.mimeType, appId, token).catch(function(e) {
        console.log('Photo upload skipped:', e.message);
        return null;
      });
    });
    var uploadResults = await Promise.all(uploadPromises);
    var uploadedUrls = uploadResults.filter(Boolean);

    var pictureXml = uploadedUrls.length > 0
      ? '<PictureDetails>' + uploadedUrls.map(function(u) { return '<PictureURL>' + u + '</PictureURL>'; }).join('') + '</PictureDetails>'
      : '';

    // Condition mapping — eBay Books category (261186) specific IDs
    var conditionMap = {
      'brand new':  '1000',
      'like new':   '2750',
      'very good':  '3000',
      'good':       '4000',
      'acceptable': '5000'
    };
    var condRaw = (listing.condition || 'Good').trim().toLowerCase();
    var conditionId = conditionMap[condRaw] || '4000';

    // Category mapping
    var categoryMap = {
      'fiction': '261186',
      'nonfiction': '11232',
      'non-fiction': '11232',
      'children': '11721',
      "children's": '11721',
      'comics': '259104',
      'graphic novel': '259104'
    };
    var categoryId = categoryMap[(listing.genre || '').toLowerCase()] || '261186';

    // Item specifics
    var specifics = '';
    specifics += '<NameValueList><Name>Author</Name><Value>' + esc(listing.author || 'Unknown') + '</Value></NameValueList>';
    if (listing.bookTitle) specifics += '<NameValueList><Name>Book Title</Name><Value>' + esc(listing.bookTitle) + '</Value></NameValueList>';
    if (listing.format) specifics += '<NameValueList><Name>Format</Name><Value>' + esc(listing.format) + '</Value></NameValueList>';
    specifics += '<NameValueList><Name>Language</Name><Value>English</Value></NameValueList>';
    if (listing.genre) specifics += '<NameValueList><Name>Genre</Name><Value>' + esc(listing.genre) + '</Value></NameValueList>';
    if (listing.publisher && listing.publisher !== 'unknown') specifics += '<NameValueList><Name>Publisher</Name><Value>' + esc(listing.publisher) + '</Value></NameValueList>';
    if (listing.publicationYear && listing.publicationYear !== 'unknown') specifics += '<NameValueList><Name>Publication Year</Name><Value>' + esc(listing.publicationYear) + '</Value></NameValueList>';
    if (listing.isbn && listing.isbn !== 'unknown') specifics += '<NameValueList><Name>ISBN</Name><Value>' + esc(listing.isbn) + '</Value></NameValueList>';
    if (listing.topic) specifics += '<NameValueList><Name>Topic</Name><Value>' + esc(listing.topic) + '</Value></NameValueList>';
    if (listing.firstEdition === 'Yes') specifics += '<NameValueList><n>Edition</n><Value>1st Edition</Value></NameValueList>';

    // Weight and package dimensions for calculated shipping
    var weightXml = '';
    var totalOz = Math.round((parseFloat(listing.weightLbs) || 1) * 16);
    var lbs = Math.floor(totalOz / 16);
    var oz = totalOz % 16;
    var pkgL = parseFloat(listing.pkgL) || 9;
    var pkgW = parseFloat(listing.pkgW) || 6;
    var pkgH = parseFloat(listing.pkgH) || 3;
    weightXml = '<ShippingPackageDetails>' +
      '<WeightMajor unit="lbs">' + lbs + '</WeightMajor>' +
      '<WeightMinor unit="oz">' + oz + '</WeightMinor>' +
      '<PackageLength unit="in">' + pkgL + '</PackageLength>' +
      '<PackageWidth unit="in">' + pkgW + '</PackageWidth>' +
      '<PackageDepth unit="in">' + pkgH + '</PackageDepth>' +
      '</ShippingPackageDetails>';

    var xml = '<?xml version="1.0" encoding="utf-8"?>' +
      '<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
      '<RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials>' +
      '<Item>' +
      '<Title>' + esc(listing.title) + '</Title>' +
      '<Description><![CDATA[' + (listing.description || 'See pictures for condition.') + ']]></Description>' +
      pictureXml +
      '<ItemSpecifics>' + specifics + '</ItemSpecifics>' +
      '<PrimaryCategory><CategoryID>' + categoryId + '</CategoryID></PrimaryCategory>' +
      '<StartPrice>' + (parseFloat(listing.price) || 9.99) + '</StartPrice>' +
      '<Country>US</Country>' +
      '<Currency>USD</Currency>' +
      '<DispatchTimeMax>3</DispatchTimeMax>' +
      '<ListingDuration>GTC</ListingDuration>' +
      '<ListingType>FixedPriceItem</ListingType>' +
      '<PostalCode>' + postal + '</PostalCode>' +
      '<Quantity>1</Quantity>' +
      '<ShippingDetails>' +
      '<ShippingType>Flat</ShippingType>' +
      '<ShippingServiceOptions>' +
      '<ShippingServicePriority>1</ShippingServicePriority>' +
      '<ShippingService>USPSMedia</ShippingService>' +
      '<ShippingServiceCost>3.99</ShippingServiceCost>' +
      '</ShippingServiceOptions>' +
      '</ShippingDetails>' +
      '<ReturnPolicy>' +
      '<ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>' +
      '<ReturnsWithinOption>Days_30</ReturnsWithinOption>' +
      '<ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>' +
      '</ReturnPolicy>' +
      '<ConditionID>' + conditionId + '</ConditionID>' +
      weightXml +
      '<Site>US</Site>' +
      '</Item>' +
      '</AddItemRequest>';

    var r = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'AddItem',
        'X-EBAY-API-APP-NAME': appId || ''
      },
      body: xml
    });
    var text = await r.text();
    if (text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>')) {
      var match = text.match(/<ItemID>(\d+)<\/ItemID>/);
      res.json({ success: true, itemId: match ? match[1] : 'unknown', url: 'https://www.ebay.com/itm/' + (match ? match[1] : '') });
    } else {
      var errMatches = text.match(/<LongMessage>(.*?)<\/LongMessage>/g) || [];
      var allErrors = errMatches.map(function(m){ return m.replace(/<\/?LongMessage>/g,''); }).join(' | ');
      console.log('eBay AddItem failed:', text.substring(0, 800));
      res.status(400).json({ success: false, message: allErrors || 'eBay error', raw: text.substring(0, 400) });
    }
  } catch(e) {
    console.log('post-listing error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── FRONTEND ─────────────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  res.setHeader('Content-Type', 'text/html');
  var h = '';
  h += '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI - Bookslayer</title>';
  h += '<style>';
  h += '*{box-sizing:border-box;margin:0;padding:0}';
  h += 'body{background:#0a0a0f;color:#f0f0ff;font-family:monospace;padding:24px;max-width:1300px;margin:0 auto}';
  h += 'h1{font-size:1.8rem;font-weight:800;color:#00e5a0;margin-bottom:4px}';
  h += '.subtitle{font-size:0.8rem;color:#6b6b8a;margin-bottom:24px}';
  h += '.section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;padding:20px;margin-bottom:20px}';
  h += '.section h2{font-size:0.75rem;color:#00e5a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}';
  h += 'label{display:block;font-size:0.7rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:4px}';
  h += 'input,select{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px;color:#f0f0ff;font-family:monospace;margin-bottom:12px;font-size:0.85rem}';
  h += '.btn{background:#00e5a0;color:#0a0a0f;border:none;border-radius:8px;padding:11px 22px;font-weight:bold;font-size:0.85rem;cursor:pointer;margin-right:8px;margin-bottom:8px;transition:filter .15s}';
  h += '.btn:hover{filter:brightness(1.15)}';
  h += '.btn-purple{background:#7c6bff;color:white}';
  h += '.btn-outline{background:transparent;color:#00e5a0;border:1px solid #00e5a0}';
  h += '.btn-orange{background:#5a5a7a;color:white}';
  h += '.btn-sm{padding:6px 12px;font-size:0.75rem}';
  h += '.status{font-size:0.8rem;margin-top:8px;color:#00e5a0;min-height:18px}';
  h += '.status.err{color:#a0a0c0}';
  h += '.drop{border:2px dashed #2a2a3d;border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;position:relative;background:#12121a;transition:all .2s;margin-bottom:20px}';
  h += '.drop:hover,.drop.over{border-color:#00e5a0;background:rgba(0,229,160,.03)}';
  h += '.drop input[type=file]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}';
  h += '.drop-icon{font-size:3rem;margin-bottom:12px}';
  h += '.drop h2{font-size:1.3rem;font-weight:800;color:#f0f0ff;margin-bottom:8px;font-family:monospace}';
  h += '.drop p{color:#6b6b8a;font-size:0.85rem;line-height:1.6}';
  h += '.drop .tip{background:#1a1a26;border:1px solid #2a2a3d;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:0.78rem;color:#00e5a0;text-align:left}';
  h += '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}';
  h += '.stat{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:14px;text-align:center}';
  h += '.stat-num{font-size:1.6rem;font-weight:800;color:#00e5a0;font-family:monospace}';
  h += '.stat-num.orange{color:#a0a0c0}.stat-num.purple{color:#7c6bff}.stat-num.yellow{color:#ffb800}';
  h += '.stat-lbl{font-size:0.65rem;color:#6b6b8a;text-transform:uppercase;margin-top:4px}';
  h += '.prog-section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:16px;margin-bottom:20px}';
  h += '.prog-track{background:#12121a;border-radius:100px;height:8px;margin:10px 0;overflow:hidden}';
  h += '.prog-fill{height:100%;background:linear-gradient(90deg,#00e5a0,#7c6bff);border-radius:100px;transition:width .4s}';
  h += '.prog-lbl{font-size:0.78rem;color:#6b6b8a}';
  h += '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}';
  h += '.card{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;overflow:hidden;transition:border-color .2s}';
  h += '.card.done{border-color:#00e5a0}.card.error{border-color:#5a5a7a}.card.processing{border-color:#7c6bff}.card.posting{border-color:#ffb800}.card.posted{border-color:#00e5a0;opacity:.7}';
  h += '.thumb-strip{display:flex;gap:3px;padding:6px;background:#0a0a0f;flex-wrap:wrap}';
  h += '.thumb{width:52px;height:52px;object-fit:cover;border-radius:5px;border:2px solid transparent;cursor:pointer;transition:border-color .15s}';
  h += '.thumb.main{border-color:#00e5a0}';
  h += '.main-img{width:100%;height:165px;object-fit:cover;display:block}';
  h += '.card-body{padding:12px}';
  h += '.card-meta{font-size:0.68rem;color:#6b6b8a;margin-bottom:8px}';
  h += '.price-box{background:#12121a;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:0.76rem}';
  h += '.price-big{color:#ffb800;font-size:0.95rem;font-weight:bold}';
  h += '.ef{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:5px;padding:7px 9px;color:#f0f0ff;font-family:monospace;font-size:0.75rem;margin-bottom:6px}';
  h += '.ef-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}';
  h += '.fl{font-size:0.63rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:2px}';
  h += '.row-lbl{font-size:0.7rem;color:#8a8aaa;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;margin-top:2px}';
  h += '.edit-link{background:none;border:none;color:#3b82f6;cursor:pointer;font-size:0.75rem;padding:0 4px;font-family:sans-serif}';
  // Condition rows — eBay style
  h += '.cond-display{background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px 12px;font-size:0.85rem;color:#f0f0ff;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center}';
  h += '.cond-arrow{color:#6b6b8a;font-size:1.1rem}';
  h += '.cond-list{margin-bottom:8px;border:1px solid #2a2a3d;border-radius:8px;overflow:hidden}';
  h += '.cond-row{padding:12px 14px;font-size:0.85rem;color:#f0f0ff;cursor:pointer;border-bottom:1px solid #2a2a3d;background:#12121a}';
  h += '.cond-row:last-child{border-bottom:none}';
  h += '.cond-row:hover{background:#1e1e30}';
  h += '.cond-sel{color:#00e5a0;font-weight:600}';
  // Description preview
  h += '.desc-preview{background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:8px 12px;font-size:0.78rem;color:#8a8aaa;margin-bottom:8px;font-style:italic;line-height:1.5}';
  // Package inputs — 4 in a row
  h += '.pkg-row{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:8px}';
  h += '.pkg-lbl{font-size:0.62rem;color:#8a8aaa;text-align:center;margin-bottom:2px}';
  h += '.pkg-in{text-align:center;padding:6px 4px!important;margin-bottom:0!important}';
  // 1st edition badge
  h += '.badge-1st{background:#2a1f00;border:1px solid #856404;border-radius:6px;padding:5px 10px;font-size:0.72rem;color:#d4a017;margin-bottom:8px;display:inline-block}';
  h += '.actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}';
  h += '.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:480px}';
  h += '.toast{background:#1a1a26;border:1px solid #00e5a0;border-radius:8px;padding:12px 16px;font-size:0.82rem;word-break:break-word}';
  h += '.toast.err{border-color:#5a5a7a}';
  h += '.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px}';
  h += '.modal{background:#1a1a26;border:1px solid #00e5a0;border-radius:16px;padding:24px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto}';
  h += '.modal h3{font-size:1.1rem;font-weight:800;color:#00e5a0;margin-bottom:4px}';
  h += '.modal .sub{font-size:0.75rem;color:#6b6b8a;margin-bottom:16px}';
  h += '.modal-img{width:100%;height:220px;object-fit:contain;background:#12121a;border-radius:10px;margin-bottom:14px}';
  h += '.modal-thumbs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}';
  h += '.modal-thumb{width:58px;height:58px;object-fit:cover;border-radius:6px;border:2px solid #2a2a3d;cursor:pointer}';
  h += '.modal-thumb.sel{border-color:#00e5a0}';
  h += '.modal-info{background:#12121a;border-radius:8px;padding:12px;margin-bottom:14px;font-size:0.8rem}';
  h += '.modal-info .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a3d}';
  h += '.modal-info .row:last-child{border:none}';
  h += '.modal-info .lbl{color:#6b6b8a}.modal-info .val{color:#f0f0ff;font-weight:bold;text-align:right;max-width:65%}';
  h += '.modal-actions{display:flex;gap:10px}';
  h += '</style></head><body>';

  h += '<h1>FlipAI \u2014 Bookslayer</h1>';
  h += '<div class="subtitle">Dump your entire camera roll \u2014 AI groups photos by timestamp gap \u2192 analyze \u2192 post to eBay</div>';

  h += '<div class="section"><h2>\ud83d\udd11 Step 1 \u2014 Enter Keys</h2>';
  h += '<label>Claude API Key</label><input type="password" id="apiKey" placeholder="sk-ant-api03-...">';
  h += '<label>eBay App ID</label><input type="text" id="ebayKey" placeholder="YOURNAME-App-PRD-...">';
  h += '<button class="btn" onclick="verify()">Verify Keys</button>';
  h += '<div class="status" id="keyStatus"></div></div>';

  h += '<div class="drop" id="drop">';
  h += '<input type="file" accept="image/*" multiple onchange="handleFiles(this.files)">';
  h += '<div class="drop-icon">\ud83d\udcf1</div>';
  h += '<h2>Dump Your Entire Camera Roll Here</h2>';
  h += '<p>Select ALL book photos at once \u2014 hundreds at a time<br>FlipAI auto-groups them into books by timestamp</p>';
  h += '<div class="tip">\ud83d\udcf8 <strong>How to shoot:</strong> Take 3\u20139 photos per book, then pause 30+ seconds before the next book. That gap = new book.</div>';
  h += '</div>';

  h += '<div id="statsWrap" style="display:none">';
  h += '<div class="stats">';
  h += '<div class="stat"><div class="stat-num" id="sPhotos">0</div><div class="stat-lbl">Photos</div></div>';
  h += '<div class="stat"><div class="stat-num orange" id="sBooks">0</div><div class="stat-lbl">Books</div></div>';
  h += '<div class="stat"><div class="stat-num purple" id="sAnalyzed">0</div><div class="stat-lbl">Analyzed</div></div>';
  h += '<div class="stat"><div class="stat-num yellow" id="sValue">$0</div><div class="stat-lbl">Est. Value</div></div>';
  h += '<div class="stat"><div class="stat-num" id="sPosted">0</div><div class="stat-lbl">Posted</div></div>';
  h += '</div>';
  h += '<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">';
  h += '<button class="btn" onclick="analyzeAll()">Analyze All</button>';
  h += '<button class="btn btn-purple" onclick="postAll()">Post All to eBay</button>';
  h += '<button class="btn btn-outline" onclick="clearAll()">Clear All</button>';
  h += '<span id="gapInfo" style="font-size:0.75rem;color:#6b6b8a;align-self:center"></span>';
  h += '</div>';
  h += '<div class="prog-section" id="progSection" style="display:none">';
  h += '<div class="prog-lbl" id="progLbl">Starting...</div>';
  h += '<div class="prog-track"><div class="prog-fill" id="progFill" style="width:0%"></div></div>';
  h += '</div>';
  h += '</div>';

  h += '<div class="grid" id="grid"></div>';
  h += '<div class="toast-wrap" id="toasts"></div>';

  // Confirm modal
  h += '<div class="modal-bg" id="confirmModal" style="display:none">';
  h += '<div class="modal">';
  h += '<h3>Confirm Before Posting</h3>';
  h += '<div class="sub" id="confirmSub">Check this is the right book before it goes live on eBay</div>';
  h += '<img class="modal-img" id="confirmMainImg" src="">';
  h += '<div class="modal-thumbs" id="confirmThumbs"></div>';
  h += '<div class="modal-info">';
  h += '<div class="row"><span class="lbl">Title</span><span class="val" id="confirmTitle"></span></div>';
  h += '<div class="row"><span class="lbl">Author</span><span class="val" id="confirmAuthor"></span></div>';
  h += '<div class="row"><span class="lbl">Format</span><span class="val" id="confirmFormat"></span></div>';
  h += '<div class="row"><span class="lbl">Condition</span><span class="val" id="confirmCondition"></span></div>';
  h += '<div class="row"><span class="lbl">Price</span><span class="val" id="confirmPrice"></span></div>';
  h += '<div class="row"><span class="lbl">Photos</span><span class="val" id="confirmPhotos"></span></div>';
  h += '</div>';
  h += '<div class="modal-actions">';
  h += '<button class="btn" style="flex:1" id="confirmYes">\u2713 Yes, Post to eBay</button>';
  h += '<button class="btn btn-orange" style="flex:1" id="confirmNo">\u2717 Cancel</button>';
  h += '</div></div></div>';

  h += '<script>\n';
  h += 'var items=[],busy=false;\n';
  h += 'var GAP_SECONDS=30;\n';

  // Drag and drop
  h += 'var drop=document.getElementById("drop");\n';
  h += 'drop.addEventListener("dragover",function(e){e.preventDefault();drop.classList.add("over")});\n';
  h += 'drop.addEventListener("dragleave",function(){drop.classList.remove("over")});\n';
  h += 'drop.addEventListener("drop",function(e){e.preventDefault();drop.classList.remove("over");handleFiles(e.dataTransfer.files)});\n';

  // Load saved keys
  h += 'window.onload=function(){\n';
  h += '  var k=localStorage.getItem("fa_ck"),e=localStorage.getItem("fa_ek");\n';
  h += '  if(k)document.getElementById("apiKey").value=k;\n';
  h += '  if(e)document.getElementById("ebayKey").value=e;\n';
  h += '  if(k)setStatus("Keys loaded","");\n';
  h += '};\n';

  h += 'function setStatus(m,t){var s=document.getElementById("keyStatus");s.textContent=m;s.className="status"+(t?" "+t:"")}\n';

  // Verify
  h += 'function verify(){\n';
  h += '  var k=document.getElementById("apiKey").value.trim();\n';
  h += '  var e=document.getElementById("ebayKey").value.trim();\n';
  h += '  if(!k){setStatus("Enter your Claude API key","err");return}\n';
  h += '  setStatus("Testing...","");\n';
  h += '  fetch("/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k})})\n';
  h += '  .then(function(r){return r.json()})\n';
  h += '  .then(function(d){\n';
  h += '    if(d.error){setStatus("Error: "+d.error,"err");return}\n';
  h += '    localStorage.setItem("fa_ck",k);\n';
  h += '    if(e)localStorage.setItem("fa_ek",e);\n';
  h += '    setStatus("Claude API working! eBay App ID saved. Ready to analyze.","");\n';
  h += '  })\n';
  h += '  .catch(function(err){setStatus("Failed: "+err.message,"err")})\n';
  h += '}\n';

  // Handle file drop/select
  h += 'function handleFiles(files){\n';
  h += '  var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});\n';
  h += '  if(!imgs.length){toast("No image files found","err");return}\n';
  h += '  imgs.sort(function(a,b){return a.lastModified-b.lastModified});\n';
  h += '  var groups=[],cur=[];\n';
  h += '  for(var i=0;i<imgs.length;i++){\n';
  h += '    if(cur.length===0){cur.push(imgs[i]);}\n';
  h += '    else{\n';
  h += '      var gap=(imgs[i].lastModified-imgs[i-1].lastModified)/1000;\n';
  h += '      if(gap<=GAP_SECONDS&&cur.length<12){cur.push(imgs[i]);}\n';
  h += '      else{groups.push(cur);cur=[imgs[i]];}\n';
  h += '    }\n';
  h += '  }\n';
  h += '  if(cur.length)groups.push(cur);\n';
  h += '  groups.forEach(function(g){\n';
  h += '    items.push({id:Date.now()+Math.random(),files:g,urls:g.map(function(f){return URL.createObjectURL(f)}),mainIdx:0,\n';
  h += '      status:"idle",title:"",author:"",bookTitle:"",format:"",language:"English",\n';
  h += '      desc:"",genre:"",publisher:"",publicationYear:"",isbn:"",topic:"",\n';
  h += '      condition:"Good",firstEdition:"",price:10,min:5,max:20,avg:12,weightLbs:"",weightOz:"",pkgL:"",pkgW:"",pkgH:"",editCond:false,editDesc:false});\n';
  h += '  });\n';
  h += '  document.getElementById("statsWrap").style.display="block";\n';
  h += '  document.getElementById("gapInfo").textContent="Grouped "+imgs.length+" photos into "+groups.length+" books ("+GAP_SECONDS+"s gap)";\n';
  h += '  render();updateStats();toast("Grouped "+imgs.length+" photos into "+groups.length+" books!","");\n';
  h += '}\n';

  h += 'function setMain(id,idx){var item=items.find(function(i){return i.id==id});if(item){item.mainIdx=idx;refresh(item)}}\n';
  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(item,n){var d=document.createElement("div");d.className="card "+item.status;d.id="c"+item.id;d.innerHTML=cardHTML(item,n+1);g.appendChild(d)})}\n';

  // Card HTML
  h += 'function cardHTML(item,num){\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var b="<img class=\'main-img\' src=\'"+item.urls[mi]+"\' loading=\'lazy\'>";\n';
  h += '  b+="<div class=\'thumb-strip\'>";\n';
  h += '  item.urls.forEach(function(url,i){b+="<img class=\'thumb"+(i===mi?" main":"")+" \' src=\'"+url+"\' onclick=\'setMain("+item.id+","+i+")\'>"}); \n';
  h += '  b+="</div><div class=\'card-body\'>";\n';
  h += '  b+="<div class=\'card-meta\'>Book #"+num+" &bull; "+item.files.length+" photo"+(item.files.length>1?"s":"")+" &bull; "+item.status+"</div>";\n';
  h += '  if(item.status==="processing"){b+="<div style=\'color:#7c6bff;padding:8px 0\'>Analyzing "+item.files.length+" photos...</div>";}\n';
  h += '  else if(item.status==="posting"){b+="<div style=\'color:#ffb800;padding:8px 0\'>Uploading & posting to eBay...</div>";}\n';
  h += '  else if(item.title){\n';
  // Price range
  h += '    b+="<div class=\'price-box\'>Range $"+item.min+"-$"+item.max+" &bull; Avg $"+item.avg+"<br><span class=\'price-big\'>List: $"+item.price+"</span></div>";\n';
  // Title
  h += '    b+="<div class=\'row-lbl\'>Title</div><input class=\'ef\' value=\'"+esc(item.title)+"\' onchange=\'upd("+item.id+",\\"title\\",this.value)\'>";\n';
  // Author + Format
  h += '    b+="<div class=\'ef-row\'>";\n';
  h += '    b+="<div><div class=\'row-lbl\'"+(item.author==="Unknown"?" style=\'color:#e0a800\'":" ")+">Author"+(item.author==="Unknown"?" ⚠":"")+"</div><input class=\'ef\' value=\'"+esc(item.author)+"\' onchange=\'upd("+item.id+",\\"author\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'row-lbl\'>Format</div><input class=\'ef\' value=\'"+esc(item.format)+"\' onchange=\'upd("+item.id+",\\"format\\",this.value)\'></div>";\n';
  h += '    b+="</div>";\n';
  // Genre + Year
  h += '    b+="<div class=\'ef-row\'>";\n';
  h += '    b+="<div><div class=\'row-lbl\'>Genre</div><input class=\'ef\' value=\'"+esc(item.genre)+"\' onchange=\'upd("+item.id+",\\"genre\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'row-lbl\'>Year</div><input class=\'ef\' value=\'"+esc(item.publicationYear)+"\' onchange=\'upd("+item.id+",\\"publicationYear\\",this.value)\'></div>";\n';
  h += '    b+="</div>";\n';
  // Condition — eBay-style tap rows
  h += '    b+="<div class=\'row-lbl\'>Condition</div>";\n';
  h += '    if(item.editCond){\n';
  h += '      b+="<div class=\'cond-list\'>";\n';
  h += '      ["Brand New","Like New","Very Good","Good","Acceptable"].forEach(function(c){\n';
  h += '        b+="<div class=\'cond-row"+(item.condition===c?" cond-sel":"")+"\' onclick=\'updCond("+item.id+",\\""+c+"\\")\'>"+c+"</div>";\n';
  h += '      });\n';
  h += '      b+="</div>";\n';
  h += '    } else {\n';
  h += '      b+="<div class=\'cond-display\' onclick=\'toggleCond("+item.id+")\'>"+item.condition+"<span class=\'cond-arrow\'>&#8250;</span></div>";\n';
  h += '    }\n';
  // 1st edition badge
  h += '    if(item.firstEdition==="Yes"){b+="<div class=\'badge-1st\'>⭐ 1st Edition</div>";}\n';
  // Description
  h += '    b+="<div class=\'row-lbl\'>Description <button class=\'edit-link\' onclick=\'toggleDesc("+item.id+")\'>Edit</button></div>";\n';
  h += '    if(item.editDesc){\n';
  h += '      b+="<textarea class=\'ef\' rows=\'3\' style=\'resize:vertical\' onchange=\'upd("+item.id+",\\"desc\\",this.value)\'>"+esc(item.desc)+"</textarea>";\n';
  h += '    } else {\n';
  h += '      b+="<div class=\'desc-preview\'>"+(item.desc||"Tap Edit to add a description")+"</div>";\n';
  h += '    }\n';
  // Weight + Package L W H like eBay
  h += '    b+="<div class=\'row-lbl\'>Package weight &amp; dimensions</div>";\n';
  h += '    b+="<div class=\'pkg-row\'>";\n';
  h += '    b+="<div><div class=\'pkg-lbl\'>Weight (lb)</div><input class=\'ef pkg-in\' type=\'number\' step=\'0.1\' placeholder=\'0\' value=\'"+(item.weightLbs||"")+"\' onchange=\'upd("+item.id+",\\"weightLbs\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'pkg-lbl\'>L (in)</div><input class=\'ef pkg-in\' type=\'number\' step=\'0.1\' placeholder=\'0\' value=\'"+(item.pkgL||"")+"\' onchange=\'upd("+item.id+",\\"pkgL\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'pkg-lbl\'>W (in)</div><input class=\'ef pkg-in\' type=\'number\' step=\'0.1\' placeholder=\'0\' value=\'"+(item.pkgW||"")+"\' onchange=\'upd("+item.id+",\\"pkgW\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'pkg-lbl\'>H (in)</div><input class=\'ef pkg-in\' type=\'number\' step=\'0.1\' placeholder=\'0\' value=\'"+(item.pkgH||"")+"\' onchange=\'upd("+item.id+",\\"pkgH\\",this.value)\'></div>";\n';
  h += '    b+="</div>";\n';
  // Price
  h += '    b+="<div class=\'row-lbl\'>Price $</div><input class=\'ef\' type=\'number\' value=\'"+item.price+"\' onchange=\'upd("+item.id+",\\"price\\",this.value)\'>";\n';
  // Actions
  h += '    if(item.ebayId){b+="<a href=\'"+item.ebayUrl+"\' target=\'_blank\' class=\'btn btn-sm\' style=\'text-decoration:none;display:inline-block;margin-top:8px\'>\u2713 View on eBay</a>";}\n';
  h += '    else{b+="<div class=\'actions\'><button class=\'btn btn-sm btn-purple\' onclick=\'postOne("+item.id+")\'>Post to eBay</button><button class=\'btn btn-sm btn-outline\' onclick=\'analyzeOne("+item.id+")\'>Re-analyze</button></div>";}\n';
  h += '  }\n';
  h += '  else if(item.status==="error"){b+="<div style=\'color:#a0a0c0;font-size:.78rem;margin:8px 0\'>"+(item.errorMsg||"Analysis failed")+"</div><div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Retry</button></div>";}\n';
  h += '  else{b+="<div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Analyze</button></div>";}\n';
  h += '  b+="</div>";\n';
  h += '  return b\n';
  h += '}\n';

  h += 'function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}\n';
  h += 'function upd(id,f,v){var i=items.find(function(x){return x.id==id});if(i){i[f]=v;updateStats()}}\n';
  h += 'function toggleCond(id){var i=items.find(function(x){return x.id==id});if(i){i.editCond=!i.editCond;refresh(i)}}\n';
  h += 'function updCond(id,v){var i=items.find(function(x){return x.id==id});if(i){i.condition=v;i.editCond=false;refresh(i)}}\n';
  h += 'function toggleDesc(id){var i=items.find(function(x){return x.id==id});if(i){i.editDesc=!i.editDesc;refresh(i)}}\n';
  h += 'function clearAll(){items=[];render();document.getElementById("statsWrap").style.display="none";updateStats()}\n';
  h += 'function analyzeOne(id){var item=items.find(function(i){return i.id==id});if(item)doAnalyze(item).then(function(){refresh(item);updateStats()})}\n';

  // Analyze all
  h += 'function analyzeAll(){\n';
  h += '  if(busy)return;\n';
  h += '  var k=localStorage.getItem("fa_ck");\n';
  h += '  if(!k){toast("Verify API key first","err");return}\n';
  h += '  busy=true;\n';
  h += '  var q=items.filter(function(i){return i.status==="idle"||i.status==="error"});\n';
  h += '  if(!q.length){busy=false;toast("All analyzed!","");return}\n';
  h += '  var idx=0;\n';
  h += '  document.getElementById("progSection").style.display="block";\n';
  h += '  function next(){\n';
  h += '    if(idx>=q.length){busy=false;document.getElementById("progSection").style.display="none";toast("Done! "+q.length+" books analyzed","");updateStats();return}\n';
  h += '    var item=q[idx];\n';
  h += '    document.getElementById("progFill").style.width=Math.round(idx/q.length*100)+"%";\n';
  h += '    document.getElementById("progLbl").textContent="Analyzing book "+(idx+1)+" of "+q.length;\n';
  h += '    doAnalyze(item).then(function(){refresh(item);updateStats();idx++;next()})\n';
  h += '  }\n';
  h += '  next()\n';
  h += '}\n';

  // Do analyze — downscale images to 800px before sending
  h += 'function doAnalyze(item){\n';
  h += '  var k=localStorage.getItem("fa_ck");\n';
  h += '  if(!k){item.status="error";item.errorMsg="No API key";return Promise.resolve()}\n';
  h += '  item.status="processing";refresh(item);\n';
  h += '  var promises=item.files.map(function(file){\n';
  h += '    return new Promise(function(res,rej){\n';
  h += '      var fr=new FileReader();fr.onload=function(){\n';
  h += '        var img=new Image();img.onload=function(){\n';
  h += '          var MAX=800;var scale=Math.min(MAX/img.width,MAX/img.height,1);\n';
  h += '          var c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);\n';
  h += '          c.getContext("2d").drawImage(img,0,0,c.width,c.height);\n';
  h += '          res({data:c.toDataURL("image/jpeg",0.85).split(",")[1],mimeType:"image/jpeg"});\n';
  h += '        };img.src=fr.result;\n';
  h += '      };fr.onerror=rej;fr.readAsDataURL(file);\n';
  h += '    })\n';
  h += '  });\n';
  h += '  return Promise.all(promises).then(function(images){\n';
  h += '    return fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,images:images})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.error)throw new Error(d.error);\n';
  h += '      var t=(d.content||[]).map(function(c){return c.text||""}).join("");\n';
  h += '      var s=t.indexOf("{"),e=t.lastIndexOf("}");\n';
  h += '      if(s<0||e<0)throw new Error("No JSON in response");\n';
  h += '      var p=JSON.parse(t.slice(s,e+1));\n';
  h += '      item.title=p.title||"Book";\n';
  h += '      item.author=p.author||"Unknown";\n';
  h += '      item.bookTitle=p.bookTitle||"";\n';
  h += '      item.format=p.format||"";\n';
  h += '      item.language=p.language||"English";\n';
  h += '      item.desc=p.description||"";\n';
  h += '      item.genre=p.genre||"";\n';
  h += '      item.publisher=p.publisher||"";\n';
  h += '      item.publicationYear=p.publicationYear||"";\n';
  h += '      item.isbn=p.isbn||"";\n';
  h += '      item.topic=p.topic||"";\n';
  h += '      item.condition=p.condition||"Good";item.firstEdition=p.firstEdition||"";\n';
  h += '      item.min=p.minPrice||5;\n';
  h += '      item.max=p.maxPrice||20;\n';
  h += '      item.avg=p.avgPrice||12;\n';
  h += '      item.price=p.suggestedPrice||12;\n';
  h += '      item.status="done";\n';
  h += '    })\n';
  h += '    .catch(function(err){item.status="error";item.errorMsg=err.message.substring(0,100);toast("Error: "+item.errorMsg,"err")})\n';
  h += '  })\n';
  h += '}\n';

  h += 'function refresh(item){var n=items.indexOf(item)+1;var c=document.getElementById("c"+item.id);if(c){c.className="card "+item.status;c.innerHTML=cardHTML(item,n)}}\n';

  // Confirm modal
  h += 'var confirmCallback=null;\n';
  h += 'document.getElementById("confirmYes").onclick=function(){document.getElementById("confirmModal").style.display="none";if(confirmCallback)confirmCallback()};\n';
  h += 'document.getElementById("confirmNo").onclick=function(){document.getElementById("confirmModal").style.display="none";confirmCallback=null;toast("Cancelled","")};\n';

  h += 'function showConfirm(item,onConfirm){\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var n=items.indexOf(item)+1;\n';
  h += '  document.getElementById("confirmSub").textContent="Book #"+n+" of "+items.length+" \u2014 Is this the right book?";\n';
  h += '  document.getElementById("confirmMainImg").src=item.urls[mi];\n';
  h += '  document.getElementById("confirmTitle").textContent=item.title;\n';
  h += '  document.getElementById("confirmAuthor").textContent=item.author||"Unknown";\n';
  h += '  document.getElementById("confirmFormat").textContent=item.format||"Unknown";\n';
  h += '  document.getElementById("confirmCondition").textContent=item.condition||"Good";\n';
  h += '  document.getElementById("confirmPrice").textContent="$"+item.price;\n';
  h += '  document.getElementById("confirmPhotos").textContent=item.files.length+" photo(s) will be uploaded";\n';
  h += '  var thumbs=document.getElementById("confirmThumbs");thumbs.innerHTML="";\n';
  h += '  item.urls.forEach(function(url,i){var img=document.createElement("img");img.className="modal-thumb"+(i===mi?" sel":"");img.src=url;img.onclick=function(){document.getElementById("confirmMainImg").src=url;item.mainIdx=i;Array.from(thumbs.children).forEach(function(c){c.classList.remove("sel")});img.classList.add("sel")};thumbs.appendChild(img)});\n';
  h += '  confirmCallback=onConfirm;\n';
  h += '  document.getElementById("confirmModal").style.display="flex"\n';
  h += '}\n';

  h += 'function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;showConfirm(item,function(){doPost(item)})}\n';

  // Do post — send full-res images to eBay (server handles upload)
  h += 'function doPost(item){\n';
  h += '  item.status="posting";refresh(item);\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var orderedFiles=[item.files[mi]].concat(item.files.filter(function(_,i){return i!==mi}));\n';
  h += '  var promises=orderedFiles.map(function(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:f.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(f)})});\n';
  h += '  Promise.all(promises).then(function(images){\n';
  h += '    return fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({\n';
  h += '      listing:{title:item.title,author:item.author,bookTitle:item.bookTitle,format:item.format,language:item.language,\n';
  h += '        description:item.desc,genre:item.genre,publisher:item.publisher,publicationYear:item.publicationYear,\n';
  h += '        isbn:item.isbn,topic:item.topic,price:item.price,condition:item.condition,firstEdition:item.firstEdition,\n';
  h += '        weightLbs:item.weightLbs,pkgL:item.pkgL,pkgW:item.pkgW,pkgH:item.pkgH},\n';
  h += '      images:images})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.success){item.ebayId=d.itemId;item.ebayUrl=d.url;item.status="posted";refresh(item);toast("Posted! eBay #"+d.itemId,"");updateStats()}\n';
  h += '      else{item.status="done";refresh(item);toast("eBay error: "+(d.message||"unknown").substring(0,120),"err")}\n';
  h += '    })\n';
  h += '    .catch(function(err){item.status="done";refresh(item);toast("Error: "+err.message,"err")})\n';
  h += '  })\n';
  h += '}\n';

  // Post all
  h += 'function postAll(){\n';
  h += '  var ready=items.filter(function(i){return i.status==="done"&&!i.ebayId});\n';
  h += '  if(!ready.length){toast("Analyze items first","err");return}\n';
  h += '  var i=0;\n';
  h += '  function next(){\n';
  h += '    if(i>=ready.length){toast("All done posting!","");return}\n';
  h += '    var item=ready[i];\n';
  h += '    showConfirm(item,function(){doPost(item);i++;setTimeout(next,4000)});\n';
  h += '  }\n';
  h += '  next()\n';
  h += '}\n';

  // Stats
  h += 'function updateStats(){\n';
  h += '  var total=items.length;\n';
  h += '  var analyzed=items.filter(function(i){return i.status==="done"||i.status==="posted"}).length;\n';
  h += '  var posted=items.filter(function(i){return i.ebayId}).length;\n';
  h += '  var photos=items.reduce(function(s,i){return s+i.files.length},0);\n';
  h += '  var val=items.reduce(function(s,i){return s+(parseFloat(i.price)||0)},0);\n';
  h += '  document.getElementById("sPhotos").textContent=photos;\n';
  h += '  document.getElementById("sBooks").textContent=total;\n';
  h += '  document.getElementById("sAnalyzed").textContent=analyzed;\n';
  h += '  document.getElementById("sValue").textContent="$"+Math.round(val).toLocaleString();\n';
  h += '  document.getElementById("sPosted").textContent=posted;\n';
  h += '}\n';

  // Toast
  h += 'function toast(msg,type){var w=document.getElementById("toasts"),t=document.createElement("div");t.className="toast"+(type?" "+type:"");t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},type==="err"?15000:6000)}\n';

  h += '<\/script></body></html>';
  res.send(h);
});

app.listen(PORT, function() {
  console.log('FlipAI Bookslayer running on port ' + PORT);
});


// ============================================================
// 😊 CONFIRMED WORKING TEMPLATE — March 13, 2026
// ============================================================
// STATUS: FULLY WORKING — books post to eBay with all photos
//
// COST: ~$0.03 per book (single Sonnet call, vision + pricing)
//
// KEY FACTS:
// - Single claude-sonnet-4-20250514 call does everything
// - Photo upload: XML Payload multipart, token in XML body
// - Boundary uses ASCII '--' (never copy-paste — upload as file)
// - EBAY_USER_TOKEN from Railway env var
// - EBAY_APP_ID from Railway env var
// - POSTAL_CODE from Railway env var (default 14701)
// - 30-second gap between photos = new book
// - Author defaults to "Unknown" to prevent eBay rejection
// - Photos downscaled 800px for AI, full-res sent to eBay
// - Parallel photo uploads (Promise.all)
//
// DEPLOY: Upload file to GitHub → Railway auto-deploys ~60s
// NEVER paste code through text editors (em-dash corruption kills multipart)
// ============================================================
