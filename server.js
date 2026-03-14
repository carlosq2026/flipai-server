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

// ─── VERIFY API KEY ───────────────────────────────────────────────────────────
app.post('/verify', async function(req, res) {
  var apiKey = req.body.apiKey;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CLASSIFY PHOTOS BY BOOK ID NUMBER ───────────────────────────────────────
app.post('/classify-photos', async function(req, res) {
  var apiKey = req.body.apiKey;
  var photos = req.body.photos;
  if (!apiKey || !photos || !photos.length) return res.status(400).json({ error: 'Missing data' });
  try {
    var content = [];
    photos.forEach(function(p, i) {
      content.push({ type: 'image', source: { type: 'base64', media_type: p.mimeType || 'image/jpeg', data: p.data } });
      content.push({ type: 'text', text: 'Photo ' + i + ':' });
    });
    content.push({ type: 'text', text: 'Look at each photo carefully. Each book has a handwritten number (like 123456) written on a sticky note or piece of paper somewhere in the frame — could be in a corner, on a table nearby, or held up. This number is the BOOK ID and groups photos of the same book together. IMPORTANT: The number may appear in book photos AND in inside-page photos AND on the note card — they all belong to the same book if the number matches. A note card is a plain piece of paper/card with handwritten words like condition, weight, location — it also shows the book number. For each photo output exactly: index,bookId,type — where type is notecard if it looks like a handwritten info card, or photo otherwise. If truly no number visible anywhere in the frame use the same bookId as the previous photo. Example:\n0,123456,photo\n1,123456,photo\n2,123456,photo\n3,123456,notecard\n4,789012,photo\nReply ONLY with these comma-separated lines, nothing else.' });
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: content }] })
    });
    var d = await r.json();
    var text = (d.content || []).map(function(c) { return c.text || ''; }).join('');
    var results = new Array(photos.length).fill(null).map(function() { return { bookId: '?', type: 'photo' }; });
    text.split('\n').forEach(function(line) {
      var parts = line.trim().split(',');
      if (parts.length >= 3) {
        var idx = parseInt(parts[0]);
        if (!isNaN(idx) && idx >= 0 && idx < results.length) {
          results[idx] = { bookId: parts[1].trim(), type: parts[2].trim().toLowerCase() };
        }
      }
    });
    res.json({ results: results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ANALYZE BOOK (Two-stage: Haiku reads photos -> Sonnet prices) ────────────
app.post('/analyze', async function(req, res) {
  var apiKey = req.body.apiKey;
  var images = req.body.images;
  if (!apiKey || !images || !images.length) return res.status(400).json({ error: 'Missing apiKey or images' });
  try {
    // STAGE 1: Haiku reads all photos and extracts book details
    var visionContent = [];
    images.forEach(function(img) {
      visionContent.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data } });
    });
    visionContent.push({ type: 'text', text: 'Extract book details from these photos. Check EVERY photo -- cover, spine, inside title page, copyright page, back cover, note card. AUTHOR: look on cover (above/below title), spine (vertical text), inside title page (centered name), back cover (bio), copyright page (Copyright by [Name]). EDITION: copyright page for First Edition, First Published, 1st Edition, or number line ending in 1. NOTE CARD: last photo may be handwritten with condition, weight lbs/oz, location/shelf code. Reply ONLY raw JSON: {"title":"Full Title","author":"Author Name","format":"Hardcover or Paperback or Trade Paperback","genre":"genre","publisher":"publisher","publicationYear":"4-digit year","isbn":"ISBN or empty","topic":"subject","condition":"condition","weightLbs":"lbs or empty","weightOz":"oz or empty","location":"shelf code or empty","firstEdition":false,"description":"1-2 sentence plot summary only"}' });

    var stage1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: visionContent }] })
    });
    var s1 = await stage1.json();
    var s1text = (s1.content || []).map(function(c){ return c.text || ''; }).join('');
    var s1start = s1text.indexOf('{'), s1end = s1text.lastIndexOf('}');
    var bookData = {};
    if (s1start >= 0 && s1end >= 0) {
      try { bookData = JSON.parse(s1text.slice(s1start, s1end + 1)); } catch(e) {}
    }

    // STAGE 2: Sonnet does ONLY pricing via web search -- no images needed
    var title = bookData.title || 'Unknown Book';
    var author = bookData.author || '';
    var isFirst = bookData.firstEdition || false;
    var pricingPrompt = 'Price this book for eBay resale using web_search. ' +
      'Book: "' + title + '" by ' + (author || 'Unknown') + '. ' +
      (isFirst ? 'THIS IS A 1ST EDITION -- search specifically for first edition sold prices, they are 2x-10x higher. ' : '') +
      'Search order: (1) eBay SOLD listings "' + title + ' ' + author + (isFirst ? ' first edition' : '') + ' used sold" -- strongest signal. ' +
      '(2) AbeBooks, Alibris for comparison. (3) Google Books for edition verification. ' +
      'HAPPY STEAL FORMULA: collect sold prices, strip top/bottom 10% outliers, median = TRUE value. ' +
      'suggestedPrice = 85% of TRUE value rounded DOWN to .95 or .99 ending. ' +
      'minPrice = 70% of TRUE. maxPrice = 110% of TRUE. avgPrice = TRUE median. ' +
      (isFirst ? 'Set firstEditionPremium true. ' : '') +
      'Reply ONLY raw JSON: {"suggestedPrice":10.95,"minPrice":7,"maxPrice":15,"avgPrice":12,"firstEditionPremium":false}';

    var stage2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: pricingPrompt }]
      })
    });
    var s2 = await stage2.json();
    var s2text = (s2.content || []).filter(function(c){ return c.type === 'text'; }).map(function(c){ return c.text || ''; }).join('');
    var s2start = s2text.indexOf('{'), s2end = s2text.lastIndexOf('}');
    var priceData = { suggestedPrice: 9.95, minPrice: 5, maxPrice: 20, avgPrice: 12, firstEditionPremium: false };
    if (s2start >= 0 && s2end >= 0) {
      try { priceData = Object.assign(priceData, JSON.parse(s2text.slice(s2start, s2end + 1))); } catch(e) {}
    }

    var merged = Object.assign({}, bookData, priceData);
    res.json({ content: [{ type: 'text', text: JSON.stringify(merged) }] });

  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── UPLOAD PHOTO TO EBAY ─────────────────────────────────────────────────────
async function uploadPhotoToEbay(base64Data, mimeType, appId, token) {
  var boundary = 'FLIPAI_' + Date.now();
  var imgBuffer = Buffer.from(base64Data, 'base64');
  var ext = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  var CRLF = '\r\n';

  // XML Payload part -- auth token goes in the body, NOT just headers
  // CRITICAL: boundary lines use exactly two ASCII hyphens: --
  // Never use em-dash or en-dash characters here
  var xmlPayload =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    '<RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials>' +
    '<PictureName>book</PictureName>' +
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
    'binary'
  );

  // Closing boundary: --boundary--
  var imgFooter = Buffer.from(CRLF + '--' + boundary + '--' + CRLF, 'binary');

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
  console.log('Photo upload response:', text.substring(0, 400));
  var match = text.match(/<FullURL>(.*?)<\/FullURL>/);
  if (match) return match[1];
  throw new Error('Photo upload failed: ' + text.substring(0, 150));
}

// ─── POST LISTING TO EBAY ─────────────────────────────────────────────────────
app.post('/post-listing', async function(req, res) {
  var listing = req.body.listing;
  var images = req.body.images || [];
  var appId = process.env.EBAY_APP_ID;
  var token = req.body.ebayToken || process.env.EBAY_USER_TOKEN || '';
  var postalCode = process.env.POSTAL_CODE || '14701';
  if (!appId) return res.status(400).json({ error: 'Missing EBAY_APP_ID in Railway environment' });

  try {
    // Upload all photos in parallel
    var uploadSlots = images.slice(0, 12);
    var photoUrls = (await Promise.all(
      uploadSlots.map(function(img) {
        return uploadPhotoToEbay(img.data, img.mimeType, appId, token)
          .catch(function(e) { console.log('Photo upload error:', e.message); return null; });
      })
    )).filter(Boolean);

    function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // Condition mapping
    var condMap = { 'new': '1000', 'like new': '2750', 'very good': '2750', 'good': '3000', 'acceptable': '4000', 'for parts': '7000' };
    var condText = (listing.condition || 'good').toLowerCase();
    var condId = '3000';
    Object.keys(condMap).forEach(function(k) { if (condText.includes(k)) condId = condMap[k]; });

    // Build description
    var conditionLine = listing.condition ? 'Condition: ' + listing.condition + '.\n\n' : '';
    var fullDescription = conditionLine + (listing.description || '');
    if (listing.location) fullDescription += '\n\nLocation: ' + listing.location;

    // Item specifics
    var specifics = '';
    if (listing.genre) specifics += '<NameValueList><Name>Genre</Name><Value>' + esc(listing.genre) + '</Value></NameValueList>';
    if (listing.publisher) specifics += '<NameValueList><Name>Publisher</Name><Value>' + esc(listing.publisher) + '</Value></NameValueList>';
    if (listing.publicationYear) specifics += '<NameValueList><Name>Publication Year</Name><Value>' + esc(listing.publicationYear) + '</Value></NameValueList>';
    if (listing.isbn) specifics += '<NameValueList><Name>ISBN</Name><Value>' + esc(listing.isbn) + '</Value></NameValueList>';
    if (listing.topic) specifics += '<NameValueList><Name>Topic</Name><Value>' + esc(listing.topic) + '</Value></NameValueList>';
    if (listing.firstEdition) specifics += '<NameValueList><Name>Special Attributes</Name><Value>1st Edition</Value></NameValueList>';

    // Photos XML
    var pictureXml = photoUrls.length ? '<PictureDetails>' + photoUrls.map(function(u) { return '<PictureURL>' + esc(u) + '</PictureURL>'; }).join('') + '</PictureDetails>' : '';

    // Weight
    var weightXml = '';
    if (listing.weightLbs || listing.weightOz) {
      weightXml = '<ShippingPackageDetails>' +
        '<WeightMajor unit="lbs">' + (listing.weightLbs || '0') + '</WeightMajor>' +
        '<WeightMinor unit="oz">' + (listing.weightOz || '0') + '</WeightMinor>' +
        '<PackageDepth unit="in">7</PackageDepth>' +
        '<PackageLength unit="in">7</PackageLength>' +
        '<PackageWidth unit="in">7</PackageWidth>' +
        '</ShippingPackageDetails>';
    }

    var categoryId = (function(){
      var gen = (listing.genre || '').toLowerCase();
      if (gen.includes('child')) return '11721';
      if (gen.includes('comic') || gen.includes('manga')) return '259104';
      if (gen.includes('fiction') || gen.includes('mystery') || gen.includes('thriller') || gen.includes('romance')) return '261186';
      if (gen.includes('history') || gen.includes('biography') || gen.includes('science') || gen.includes('self')) return '11232';
      return '280';
    })();

    var xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
      '<RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials>' +
      '<Item>' +
      '<Title>' + esc((listing.title || 'Book').substring(0, 80)) + '</Title>' +
      '<Description><![CDATA[' + fullDescription + ']]></Description>' +
      '<PrimaryCategory><CategoryID>' + categoryId + '</CategoryID></PrimaryCategory>' +
      '<StartPrice>' + (parseFloat(listing.price) || 9.99).toFixed(2) + '</StartPrice>' +
      '<Quantity>1</Quantity>' +
      '<ListingType>FixedPriceItem</ListingType>' +
      '<ListingDuration>GTC</ListingDuration>' +
      '<Country>US</Country>' +
      '<Currency>USD</Currency>' +
      '<Location>' + esc(postalCode) + '</Location>' +
      '<PostalCode>' + esc(postalCode) + '</PostalCode>' +
      '<ConditionID>' + condId + '</ConditionID>' +
      '<ItemSpecifics>' + specifics + '</ItemSpecifics>' +
      pictureXml +
      '<ShippingDetails>' +
        '<ShippingType>Calculated</ShippingType>' +
        '<ShippingServiceOptions>' +
          '<ShippingServicePriority>1</ShippingServicePriority>' +
          '<ShippingService>USPSMedia</ShippingService>' +
        '</ShippingServiceOptions>' +
      '</ShippingDetails>' +
      weightXml +
      '<DispatchTimeMax>3</DispatchTimeMax>' +
      '<ReturnPolicy>' +
        '<ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>' +
        '<RefundOption>MoneyBack</RefundOption>' +
        '<ReturnsWithinOption>Days_30</ReturnsWithinOption>' +
        '<ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>' +
      '</ReturnPolicy>' +
      '</Item></AddItemRequest>';

    var ebayRes = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'AddItem',
        'X-EBAY-API-APP-NAME': appId
      },
      body: xml
    });
    var ebayText = await ebayRes.text();
    var itemId = (ebayText.match(/<ItemID>(\d+)<\/ItemID>/) || [])[1];
    var ack = (ebayText.match(/<Ack>(.*?)<\/Ack>/) || [])[1];
    var errMsg = (ebayText.match(/<LongMessage>(.*?)<\/LongMessage>/) || [])[1];
    if (itemId && ack !== 'Failure') {
      res.json({ success: true, itemId: itemId, url: 'https://www.ebay.com/itm/' + itemId });
    } else {
      res.json({ success: false, message: errMsg || ack || 'Unknown eBay error', raw: ebayText.substring(0, 500) });
    }

  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── FRONTEND ─────────────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI Bookslayer</title><style>';
  h += '*{box-sizing:border-box;margin:0;padding:0}';
  h += 'body{background:#0a0a0f;color:#f0f0ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}';
  h += '.header{background:linear-gradient(135deg,#1a0533,#0d1f3c);padding:18px 20px;text-align:center;border-bottom:1px solid #2a2a3d}';
  h += '.header h1{font-size:1.5rem;font-weight:800;background:linear-gradient(90deg,#a855f7,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}';
  h += '.header p{font-size:0.75rem;color:#6b6b8a;margin-top:2px}';
  h += '.keys{background:#12121a;border:1px solid #2a2a3d;border-radius:12px;padding:14px;margin:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}';
  h += 'input.ki{flex:1;min-width:140px;background:#0a0a0f;border:1px solid #3a3a5c;border-radius:8px;color:#f0f0ff;padding:8px 10px;font-size:0.8rem}';
  h += '.btn{border:none;border-radius:8px;padding:9px 16px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all .15s}';
  h += '.btn-green{background:#00e5a0;color:#0a0a0f}.btn-green:hover{background:#00c88c}';
  h += '.btn-purple{background:linear-gradient(135deg,#a855f7,#3b82f6);color:#fff}';
  h += '.btn-red{background:#ff3b5c;color:#fff}';
  h += '.btn-outline{background:transparent;border:1px solid #3a3a5c;color:#a0a0c0}.btn-outline:hover{border-color:#a855f7;color:#a855f7}';
  h += '.btn-sm{padding:6px 12px;font-size:0.75rem}';
  h += '.key-status{font-size:0.75rem;color:#00e5a0;margin-left:4px}';
  h += '.drop{border:2px dashed #3a3a5c;border-radius:16px;margin:0 16px 16px;padding:40px 20px;text-align:center;cursor:pointer;transition:border-color .2s;background:#0d0d17}';
  h += '.drop:hover,.drop.drag{border-color:#a855f7;background:#12091f}';
  h += '.drop h2{font-size:1.1rem;font-weight:700;margin-bottom:6px}';
  h += '.drop p{font-size:0.78rem;color:#6b6b8a;margin-bottom:12px}';
  h += '.tip{background:#0d1f0d;border:1px solid #1a3a1a;border-radius:8px;padding:10px 14px;font-size:0.75rem;color:#4ade80;margin-top:10px;text-align:left;line-height:1.5}';
  h += '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:0 16px 12px;text-align:center}';
  h += '.stat{background:#12121a;border:1px solid #2a2a3d;border-radius:10px;padding:10px 4px}';
  h += '.stat-val{font-size:1.2rem;font-weight:800;color:#a855f7}';
  h += '.stat-val.green{color:#00e5a0}.stat-val.gold{color:#ffb800}.stat-val.blue{color:#3b82f6}';
  h += '.stat-lbl{font-size:0.6rem;color:#6b6b8a;text-transform:uppercase;letter-spacing:.5px}';
  h += '.controls{display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 12px;align-items:center}';
  h += '.gap-info{font-size:0.72rem;color:#6b6b8a;flex:1}';
  h += '.prog{background:#12121a;border:1px solid #2a2a3d;border-radius:10px;margin:0 16px 12px;padding:10px}';
  h += '.prog-bar{height:6px;background:#2a2a3d;border-radius:3px;overflow:hidden;margin-bottom:6px}';
  h += '.prog-fill{height:100%;background:linear-gradient(90deg,#a855f7,#3b82f6);border-radius:3px;transition:width .3s}';
  h += '.prog-lbl{font-size:0.72rem;color:#a0a0c0}';
  h += '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding:0 16px 80px}';
  h += '.card{background:#12121a;border:1px solid #2a2a3d;border-radius:14px;overflow:hidden;transition:border-color .2s}';
  h += '.card.processing{border-color:#3b82f6;animation:pulse 1.5s infinite}';
  h += '.card.done{border-color:#00e5a0}';
  h += '.card.error{border-color:#ff3b5c}';
  h += '.card.posted{border-color:#a855f7}';
  h += '.card.posting{border-color:#ffb800;animation:pulse 1.5s infinite}';
  h += '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}';
  h += '.main-img{width:100%;height:200px;object-fit:cover;background:#0a0a0f;cursor:pointer}';
  h += '.thumbs{display:flex;gap:4px;padding:6px 8px;overflow-x:auto;background:#0d0d17}';
  h += '.thumb{width:44px;height:44px;object-fit:cover;border-radius:5px;cursor:pointer;border:2px solid transparent;flex-shrink:0}';
  h += '.thumb.sel{border-color:#a855f7}';
  h += '.card-body{padding:10px 12px}';
  h += '.book-num{font-size:0.65rem;color:#6b6b8a;margin-bottom:4px}';
  h += '.book-title{font-size:0.9rem;font-weight:700;color:#f0f0ff;margin-bottom:2px;line-height:1.3}';
  h += '.book-author{font-size:0.75rem;color:#a0a0c0;margin-bottom:6px}';
  h += '.fl{font-size:0.65rem;color:#6b6b8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;display:flex;align-items:center;gap:4px}';
  h += '.ef{width:100%;background:#0a0a0f;border:1px solid #3a3a5c;border-radius:6px;color:#f0f0ff;padding:6px 8px;font-size:0.78rem;margin-bottom:6px}';
  h += '.ef-val{background:#12121a;border:1px solid #2a2a3d;border-radius:6px;padding:7px 9px;color:#f0f0ff;font-size:0.78rem;margin-bottom:6px;min-height:32px}';
  h += '.price-edit{color:#ffb800;font-weight:bold;font-size:0.95rem}';
  h += '.edit-btn{background:none;border:none;cursor:pointer;font-size:0.75rem;padding:0 3px;opacity:0.5;transition:opacity .15s}.edit-btn:hover{opacity:1}';
  h += '.price-box{background:#0d1f0d;border:1px solid #1a3a1a;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:0.72rem;color:#6b6b8a}';
  h += '.price-big{font-size:1.1rem;font-weight:800;color:#00e5a0}';
  h += '.badge-1st{display:inline-block;background:#ffb800;color:#0a0a0f;font-size:0.65rem;font-weight:800;padding:2px 8px;border-radius:100px;margin-top:4px}';
  h += '.badge-loc{font-size:0.7rem;color:#6b6b8a;margin-top:4px}';
  h += '.status-bar{font-size:0.7rem;padding:4px 10px;text-align:center}';
  h += '.status-bar.processing{background:#0d1a2e;color:#3b82f6}';
  h += '.status-bar.error{background:#1f0d10;color:#ff3b5c}';
  h += '.status-bar.posted{background:#1a0533;color:#a855f7}';
  h += '.status-bar.posting{background:#1f1700;color:#ffb800}';
  h += '.actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}';
  h += '.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;align-items:center;justify-content:center;padding:20px}';
  h += '.modal{background:#12121a;border:1px solid #3a3a5c;border-radius:16px;padding:20px;max-width:400px;width:100%}';
  h += '.modal h3{font-size:1rem;font-weight:700;margin-bottom:4px}';
  h += '.modal-sub{font-size:0.75rem;color:#6b6b8a;margin-bottom:12px}';
  h += '.modal-img{width:100%;height:200px;object-fit:cover;border-radius:10px;margin-bottom:8px}';
  h += '.modal-thumbs{display:flex;gap:4px;overflow-x:auto;margin-bottom:12px}';
  h += '.modal-thumb{width:50px;height:50px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;flex-shrink:0}';
  h += '.modal-thumb.sel{border-color:#a855f7}';
  h += '.modal-info{font-size:0.78rem;color:#a0a0c0;margin-bottom:12px;line-height:1.6}';
  h += '.modal-btns{display:flex;gap:8px}';
  h += '.toasts{position:fixed;bottom:20px;right:16px;z-index:200;display:flex;flex-direction:column;gap:6px}';
  h += '.toast{background:#1a1a2e;border:1px solid #3a3a5c;border-radius:8px;padding:10px 14px;font-size:0.8rem;color:#f0f0ff;animation:fadeIn .2s}';
  h += '.toast.err{border-color:#ff3b5c;color:#ff3b5c}';
  h += '@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}';
  h += '</style></head><body>';

  h += '<div class="header"><h1>\uD83D\uDCDA FlipAI Bookslayer</h1><p>AI-powered eBay book listing</p></div>';

  h += '<div class="keys">';
  h += '<input class="ki" id="ckInput" placeholder="Claude API Key (sk-ant-...)" type="password">';
  h += '<input class="ki" id="ekInput" placeholder="eBay Token" type="password">';
  h += '<button class="btn btn-green" onclick="verifyKeys()">Verify Keys</button>';
  h += '<span class="key-status" id="keyStatus"></span>';
  h += '</div>';

  h += '<div class="drop" id="dropZone">';
  h += '<div style="font-size:2rem;margin-bottom:8px">\uD83D\uDCF1</div>';
  h += '<h2>Dump Your Entire Camera Roll Here</h2>';
  h += '<p>Select ALL your book photos at once \u2014 AI groups them by the number on your sticky note</p>';
  h += '<input type="file" id="fileInput" multiple accept="image/*" style="display:none">';
  h += '<button class="btn btn-outline" onclick="document.getElementById(\'fileInput\').click()">Select Photos</button>';
  h += '<div class="tip">\uD83D\uDCF8 <strong>How to shoot:</strong> Write a unique number (e.g. <strong>123456</strong>) on a sticky note. Keep it visible in ALL photos of that book. Last photo = note card with same number + condition + weight + location. Different number for each book. Dump entire camera roll \u2014 AI groups by number regardless of order. \u2702\uFE0F Split or \uD83D\uDD17 Merge to fix any mistakes.</div>';
  h += '</div>';

  h += '<div id="statsWrap" style="display:none">';
  h += '<div class="stats">';
  h += '<div class="stat"><div class="stat-val blue" id="sPhotos">0</div><div class="stat-lbl">Photos</div></div>';
  h += '<div class="stat"><div class="stat-val" id="sBooks">0</div><div class="stat-lbl">Books</div></div>';
  h += '<div class="stat"><div class="stat-val green" id="sAnalyzed">0</div><div class="stat-lbl">Analyzed</div></div>';
  h += '<div class="stat"><div class="stat-val gold" id="sValue">$0</div><div class="stat-lbl">Est. Value</div></div>';
  h += '<div class="stat"><div class="stat-val" id="sPosted">0</div><div class="stat-lbl">Posted</div></div>';
  h += '</div>';
  h += '<div class="controls">';
  h += '<button class="btn btn-green" onclick="analyzeAll()">Analyze All</button>';
  h += '<button class="btn btn-purple" onclick="postAll()">Post All to eBay</button>';
  h += '<button class="btn btn-red btn-sm" onclick="clearAll()">Clear All</button>';
  h += '<span class="gap-info" id="gapInfo"></span>';
  h += '</div>';
  h += '<div class="prog" id="progSection" style="display:none"><div class="prog-bar"><div class="prog-fill" id="progFill" style="width:0%"></div></div><div class="prog-lbl" id="progLbl"></div></div>';
  h += '</div>';

  h += '<div class="grid" id="grid"></div>';

  h += '<div class="modal-overlay" id="confirmModal">';
  h += '<div class="modal">';
  h += '<h3>Confirm Listing</h3><div class="modal-sub" id="confirmSub"></div>';
  h += '<img class="modal-img" id="confirmMainImg" src="">';
  h += '<div class="modal-thumbs" id="confirmThumbs"></div>';
  h += '<div class="modal-info">';
  h += '<strong id="confirmTitle"></strong><br>';
  h += 'By <span id="confirmAuthor"></span><br>';
  h += 'Format: <span id="confirmFormat"></span><br>';
  h += 'Price: <span id="confirmPrice"></span><br>';
  h += '<span id="confirmPhotos"></span>';
  h += '</div>';
  h += '<div class="modal-btns"><button class="btn btn-green" id="confirmYes">Post to eBay \u2713</button><button class="btn btn-outline" id="confirmNo">Cancel</button></div>';
  h += '</div></div>';

  h += '<div class="toasts" id="toasts"></div>';

  h += '<script>';
  h += 'var items=[];var busy=false;\n';

  h += 'var ck=localStorage.getItem("fa_ck")||"";var ek=localStorage.getItem("fa_ek")||"";\n';
  h += 'document.getElementById("ckInput").value=ck;\n';
  h += 'document.getElementById("ekInput").value=ek;\n';
  h += 'if(ck&&ek)document.getElementById("keyStatus").textContent="Keys loaded";\n';

  h += 'function verifyKeys(){\n';
  h += '  var ck=document.getElementById("ckInput").value.trim();\n';
  h += '  var ek=document.getElementById("ekInput").value.trim();\n';
  h += '  if(!ck||!ek){toast("Enter both keys","err");return}\n';
  h += '  document.getElementById("keyStatus").textContent="Verifying\u2026";\n';
  h += '  fetch("/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:ck})})\n';
  h += '  .then(function(r){return r.json()})\n';
  h += '  .then(function(d){\n';
  h += '    if(d.type==="error"){document.getElementById("keyStatus").textContent="Claude key invalid";toast("Claude key invalid","err");return}\n';
  h += '    localStorage.setItem("fa_ck",ck);localStorage.setItem("fa_ek",ek);\n';
  h += '    document.getElementById("keyStatus").textContent="\u2713 Keys saved";\n';
  h += '    toast("Keys verified and saved!","")\n';
  h += '  }).catch(function(){toast("Verify failed","err")})\n';
  h += '}\n';

  h += 'function makeItem(g){return {id:Date.now()+Math.random(),files:g,urls:g.map(function(f){return URL.createObjectURL(f)}),mainIdx:0,status:"idle",title:"",author:"",bookTitle:"",format:"",language:"English",desc:"",genre:"",publisher:"",publicationYear:"",isbn:"",topic:"",condition:"Good",weightLbs:"",weightOz:"",location:"",firstEdition:false,firstEditionPremium:false,editingAuthor:false,editingPrice:false,price:10,min:5,max:20,avg:12}}\n';

  h += 'function handleFiles(files){\n';
  h += '  var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});\n';
  h += '  if(!imgs.length){toast("No image files found","err");return}\n';
  h += '  imgs.sort(function(a,b){return a.lastModified-b.lastModified});\n';
  h += '  document.getElementById("statsWrap").style.display="block";\n';
  h += '  document.getElementById("gapInfo").textContent="Scanning "+imgs.length+" photos \u2014 reading book ID numbers\u2026";\n';
  h += '  var k=localStorage.getItem("fa_ck");\n';
  h += '  if(!k){toast("Verify API key first","err");return}\n';
  h += '  var thumbPromises=imgs.map(function(f){\n';
  h += '    return new Promise(function(res){\n';
  h += '      var r=new FileReader();\n';
  h += '      r.onload=function(){\n';
  h += '        var img=new Image();\n';
  h += '        img.onload=function(){\n';
  h += '          var canvas=document.createElement("canvas");\n';
  h += '          var MAX=256;var scale=Math.min(MAX/img.width,MAX/img.height,1);\n';
  h += '          canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);\n';
  h += '          canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);\n';
  h += '          res({data:canvas.toDataURL("image/jpeg",0.7).split(",")[1],mimeType:"image/jpeg"});\n';
  h += '        };\n';
  h += '        img.src=r.result;\n';
  h += '      };\n';
  h += '      r.readAsDataURL(f);\n';
  h += '    });\n';
  h += '  });\n';
  h += '  Promise.all(thumbPromises).then(function(thumbs){\n';
  h += '    fetch("/classify-photos",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,photos:thumbs})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.error||!d.results){toast("Classification failed \u2014 using fallback","err");fallbackGroup(imgs);return}\n';
  h += '      var results=d.results;\n';
  h += '      var bookMap={};var bookOrder=[];var lastKnownId=null;\n';
  h += '      for(var i=0;i<imgs.length;i++){\n';
  h += '        var r=results[i]||{bookId:"?",type:"photo"};\n';
  h += '        var bid=(r.bookId||"?").replace(/[^0-9a-zA-Z]/g,"");\n';
  h += '        if(!bid||bid==="?"||bid.length<2){\n';
  h += '          bid=lastKnownId||(bookOrder.length>0?bookOrder[bookOrder.length-1]:"unknown");\n';
  h += '        } else {\n';
  h += '          lastKnownId=bid;\n';
  h += '        }\n';
  h += '        if(!bookMap[bid]){bookMap[bid]={photos:[],notecard:null};bookOrder.push(bid)}\n';
  h += '        if(r.type==="notecard"){bookMap[bid].notecard=imgs[i]}\n';
  h += '        else{bookMap[bid].photos.push(imgs[i])}\n';
  h += '      }\n';
  h += '      var groups=bookOrder.map(function(bid){var e=bookMap[bid];var g=e.photos.slice();if(e.notecard)g.push(e.notecard);return g});\n';
  h += '      var valid=groups.filter(function(g){return g.length>=2});\n';
  h += '      var skipped=groups.length-valid.length;\n';
  h += '      valid.forEach(function(g){items.push(makeItem(g))});\n';
  h += '      var msg="Grouped "+imgs.length+" photos into "+valid.length+" books by ID number";\n';
  h += '      if(skipped>0)msg+=" ("+skipped+" skipped)";\n';
  h += '      document.getElementById("gapInfo").textContent=msg;\n';
  h += '      render();updateStats();toast(msg,"")\n';
  h += '    })\n';
  h += '    .catch(function(){toast("Grouping error \u2014 using fallback","err");fallbackGroup(imgs)})\n';
  h += '  })\n';
  h += '}\n';

  h += 'function fallbackGroup(imgs){\n';
  h += '  var groups=[],cur=[];\n';
  h += '  for(var i=0;i<imgs.length;i++){\n';
  h += '    if(cur.length===0){cur.push(imgs[i])}\n';
  h += '    else{var gap=(imgs[i].lastModified-imgs[i-1].lastModified)/1000;\n';
  h += '    if(gap<=7&&cur.length<15){cur.push(imgs[i])}else{groups.push(cur);cur=[imgs[i]]}}\n';
  h += '  }\n';
  h += '  if(cur.length)groups.push(cur);\n';
  h += '  var valid=groups.filter(function(g){return g.length>=2});\n';
  h += '  valid.forEach(function(g){items.push(makeItem(g))});\n';
  h += '  document.getElementById("gapInfo").textContent="Grouped into "+valid.length+" books (fallback 7s gap)";\n';
  h += '  render();updateStats()\n';
  h += '}\n';

  h += 'var dz=document.getElementById("dropZone");\n';
  h += 'dz.addEventListener("dragover",function(e){e.preventDefault();dz.classList.add("drag")});\n';
  h += 'dz.addEventListener("dragleave",function(){dz.classList.remove("drag")});\n';
  h += 'dz.addEventListener("drop",function(e){e.preventDefault();dz.classList.remove("drag");handleFiles(e.dataTransfer.files)});\n';
  h += 'document.getElementById("fileInput").addEventListener("change",function(e){handleFiles(e.target.files)});\n';

  h += 'function clearAll(){items=[];render();updateStats();document.getElementById("statsWrap").style.display="none"}\n';

  h += 'function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}\n';

  h += 'function upd(id,field,val){\n';
  h += '  var item=items.find(function(i){return i.id==id});\n';
  h += '  if(!item)return;\n';
  h += '  if(field==="price")val=parseFloat(val)||item.price;\n';
  h += '  item[field]=val;refresh(item)\n';
  h += '}\n';

  h += 'function editField(id,field){\n';
  h += '  var item=items.find(function(i){return i.id==id});\n';
  h += '  if(!item)return;\n';
  h += '  if(field==="author")item.editingAuthor=true;\n';
  h += '  if(field==="price")item.editingPrice=true;\n';
  h += '  refresh(item);\n';
  h += '  setTimeout(function(){var el=document.getElementById("ef_"+field+"_"+id);if(el){el.focus();el.select()}},50)\n';
  h += '}\n';

  h += 'function doneEdit(id,field){\n';
  h += '  var item=items.find(function(i){return i.id==id});\n';
  h += '  if(!item)return;\n';
  h += '  if(field==="author")item.editingAuthor=false;\n';
  h += '  if(field==="price")item.editingPrice=false;\n';
  h += '  refresh(item)\n';
  h += '}\n';

  h += 'function splitGroup(id){\n';
  h += '  var idx=items.findIndex(function(i){return i.id==id});\n';
  h += '  if(idx<0)return;\n';
  h += '  var item=items[idx];\n';
  h += '  if(item.files.length<2){toast("Need at least 2 photos to split","err");return}\n';
  h += '  var half=Math.ceil(item.files.length/2);\n';
  h += '  var newItem=makeItem(item.files.slice(half));\n';
  h += '  newItem.urls=item.urls.slice(half);\n';
  h += '  item.files=item.files.slice(0,half);\n';
  h += '  item.urls=item.urls.slice(0,half);\n';
  h += '  items.splice(idx+1,0,newItem);\n';
  h += '  render();updateStats();toast("Split into 2 \u2014 re-analyze both","")\n';
  h += '}\n';

  h += 'function mergeGroup(id){\n';
  h += '  var idx=items.findIndex(function(i){return i.id==id});\n';
  h += '  if(idx<0||idx===items.length-1){toast("No next book to merge with","err");return}\n';
  h += '  var item=items[idx];var next=items[idx+1];\n';
  h += '  item.files=item.files.concat(next.files);\n';
  h += '  item.urls=item.urls.concat(next.urls);\n';
  h += '  item.status="idle";item.title="";\n';
  h += '  items.splice(idx+1,1);\n';
  h += '  render();updateStats();toast("Merged \u2014 re-analyze","")\n';
  h += '}\n';

  h += 'function cardHTML(item,n){\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var b="";\n';
  h += '  b+=\'<img class="main-img" src="\'+item.urls[mi]+\'" onclick="cycleMain(\'+item.id+\')" />\';\n';
  h += '  if(item.urls.length>1){\n';
  h += '    b+=\'<div class="thumbs">\';\n';
  h += '    item.urls.forEach(function(u,i){b+=\'<img class="thumb\'+(i===mi?\' sel\':\'\')+\'" src="\'+u+\'" onclick="setMain(\'+item.id+\',\'+i+\')" />\'});\n';
  h += '    b+=\'</div>\';\n';
  h += '  }\n';
  h += '  if(item.status==="processing")b+=\'<div class="status-bar processing">\uD83D\uDD0D Analyzing\u2026</div>\';\n';
  h += '  else if(item.status==="posting")b+=\'<div class="status-bar posting">\uD83D\uDCE4 Posting to eBay\u2026</div>\';\n';
  h += '  else if(item.status==="error")b+=\'<div class="status-bar error">\u274C \'+(item.errorMsg||"Error")+\'</div>\';\n';
  h += '  else if(item.status==="posted")b+=\'<div class="status-bar posted">\u2705 Posted: <a href="\'+item.ebayUrl+\'" target="_blank" style="color:#a855f7">eBay #\'+item.ebayId+\'</a></div>\';\n';
  h += '  b+=\'<div class="card-body">\';\n';
  h += '  b+=\'<div class="book-num">Book #\'+n+\' \u2022 \'+item.files.length+\' photos</div>\';\n';
  h += '  if(item.title){b+=\'<div class="book-title">\'+esc(item.title)+\'</div>\'}\n';
  h += '  b+=\'<div class="fl">Author <button class="edit-btn" onclick="editField(\'+item.id+\',\\\'author\\\')">&#9999;&#65039;</button></div>\';\n';
  h += '  if(item.editingAuthor){\n';
  h += '    b+=\'<input class="ef" id="ef_author_\'+item.id+\'" value="\'+esc(item.author)+\'" onchange="upd(\'+item.id+\',\\\'author\\\',this.value)" onblur="doneEdit(\'+item.id+\',\\\'author\\\')">\';\n';
  h += '  } else {\n';
  h += '    b+=\'<div class="ef-val">\'+(item.author||\'<span style="color:#ff6b35">Unknown \u2014 tap &#9999;&#65039;</span>\')+\'</div>\';\n';
  h += '  }\n';
  h += '  b+=\'<div class="fl">Condition</div><input class="ef" value="\'+esc(item.condition)+\'" onchange="upd(\'+item.id+\',\\\'condition\\\',this.value)">\';\n';
  h += '  b+=\'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">\';\n';
  h += '  b+=\'<div><div class="fl">Genre</div><input class="ef" value="\'+esc(item.genre||"")+\'" onchange="upd(\'+item.id+\',\\\'genre\\\',this.value)"></div>\';\n';
  h += '  b+=\'<div><div class="fl">Year</div><input class="ef" value="\'+esc(item.publicationYear||"")+\'" onchange="upd(\'+item.id+\',\\\'publicationYear\\\',this.value)"></div>\';\n';
  h += '  b+=\'</div>\';\n';
  h += '  if(item.status==="done"||item.status==="posted"){\n';
  h += '    b+=\'<div class="price-box">\';\n';
  h += '    b+="Avg $"+item.avg+" | $"+item.min+" - $"+item.max;\n';
  h += '    if(item.firstEditionPremium)b+=\' <span style="color:#ffb800;font-size:0.7rem">(1st Ed pricing)</span>\';\n';
  h += '    b+=\'<br><div class="fl" style="margin-top:4px">List Price <button class="edit-btn" onclick="editField(\'+item.id+\',\\\'price\\\')">&#9999;&#65039;</button></div>\';\n';
  h += '    if(item.editingPrice){\n';
  h += '      b+=\'<input class="ef" id="ef_price_\'+item.id+\'" type="number" value="\'+item.price+\'" onchange="upd(\'+item.id+\',\\\'price\\\',this.value)" onblur="doneEdit(\'+item.id+\',\\\'price\\\')">\';\n';
  h += '    } else {\n';
  h += '      b+=\'<div class="price-big">$\'+item.price+\'</div>\';\n';
  h += '    }\n';
  h += '    b+=\'</div>\';\n';
  h += '    if(item.firstEdition)b+=\'<div class="badge-1st">\u2B50 1ST EDITION</div>\';\n';
  h += '    if(item.location)b+=\'<div class="badge-loc">\uD83D\uDCCD \'+esc(item.location)+\'</div>\';\n';
  h += '  }\n';
  h += '  b+=\'<div class="actions">\';\n';
  h += '  if(item.status==="posted"){\n';
  h += '    b+=\'<button class="btn btn-sm btn-outline" onclick="analyzeOne(\'+item.id+\')">Re-analyze</button>\';\n';
  h += '  } else if(item.status==="done"){\n';
  h += '    b+=\'<button class="btn btn-sm btn-purple" onclick="postOne(\'+item.id+\')">Post to eBay</button>\';\n';
  h += '    b+=\'<button class="btn btn-sm btn-outline" onclick="analyzeOne(\'+item.id+\')">Re-analyze</button>\';\n';
  h += '  } else if(item.status!=="processing"&&item.status!=="posting"){\n';
  h += '    b+=\'<button class="btn btn-sm btn-green" onclick="analyzeOne(\'+item.id+\')">Analyze</button>\';\n';
  h += '  }\n';
  h += '  if(item.status!=="processing"&&item.status!=="posting"){\n';
  h += '    b+=\'<button class="btn btn-sm btn-outline" onclick="splitGroup(\'+item.id+\')">\u2702\uFE0F Split</button>\';\n';
  h += '    b+=\'<button class="btn btn-sm btn-outline" onclick="mergeGroup(\'+item.id+\')">\uD83D\uDD17 Merge</button>\';\n';
  h += '  }\n';
  h += '  b+=\'</div>\';\n';
  h += '  b+=\'</div>\';\n';
  h += '  return b\n';
  h += '}\n';

  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(item,i){var d=document.createElement("div");d.className="card "+item.status;d.id="c"+item.id;d.innerHTML=cardHTML(item,i+1);g.appendChild(d)})}\n';

  h += 'function setMain(id,i){var item=items.find(function(x){return x.id==id});if(!item)return;item.mainIdx=i;refresh(item)}\n';
  h += 'function cycleMain(id){var item=items.find(function(x){return x.id==id});if(!item)return;item.mainIdx=((item.mainIdx||0)+1)%item.urls.length;refresh(item)}\n';

  h += 'function analyzeOne(id){var item=items.find(function(i){return i.id==id});if(item)doAnalyze(item).then(function(){refresh(item);updateStats()})}\n';

  h += 'function analyzeAll(){\n';
  h += '  if(busy){toast("Already running","err");return}\n';
  h += '  var q=items.filter(function(i){return i.status==="idle"||i.status==="error"});\n';
  h += '  if(!q.length){toast("Nothing to analyze","err");return}\n';
  h += '  busy=true;var idx=0;\n';
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

  h += 'function doAnalyze(item){\n';
  h += '  var k=localStorage.getItem("fa_ck");\n';
  h += '  if(!k){item.status="error";return Promise.resolve()}\n';
  h += '  item.status="processing";refresh(item);\n';
  h += '  var filesToRead=item.files;\n';
  h += '  var promises=filesToRead.map(function(file){return new Promise(function(res,rej){\n';
  h += '    var fr=new FileReader();fr.onload=function(){\n';
  h += '      var img=new Image();img.onload=function(){\n';
  h += '        var MAX=800;var scale=Math.min(MAX/img.width,MAX/img.height,1);\n';
  h += '        var c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);\n';
  h += '        c.getContext("2d").drawImage(img,0,0,c.width,c.height);\n';
  h += '        res({data:c.toDataURL("image/jpeg",0.82).split(",")[1],mimeType:"image/jpeg"});\n';
  h += '      };img.src=fr.result;\n';
  h += '    };fr.onerror=rej;fr.readAsDataURL(file);\n';
  h += '  })});\n';
  h += '  return Promise.all(promises).then(function(images){\n';
  h += '    return fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,images:images})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.error)throw new Error(d.error);\n';
  h += '      var t=(d.content||[]).filter(function(c){return c.type==="text"}).map(function(c){return c.text||""}).join("");\n';
  h += '      var s=t.indexOf("{"),e=t.lastIndexOf("}");\n';
  h += '      if(s<0||e<0)throw new Error("No JSON in response");\n';
  h += '      var p=JSON.parse(t.slice(s,e+1));\n';
  h += '      item.title=p.title||"Book";\n';
  h += '      item.author=p.author||"";\n';
  h += '      item.bookTitle=p.bookTitle||p.title||"Book";\n';
  h += '      item.format=p.format||"";\n';
  h += '      item.language=p.language||"English";\n';
  h += '      item.desc=p.description||"";\n';
  h += '      item.genre=p.genre||"";\n';
  h += '      item.publisher=p.publisher||"";\n';
  h += '      item.publicationYear=p.publicationYear||"";\n';
  h += '      item.isbn=p.isbn||"";\n';
  h += '      item.topic=p.topic||"";\n';
  h += '      item.condition=p.condition||"Good";\n';
  h += '      item.weightLbs=p.weightLbs||"";\n';
  h += '      item.weightOz=p.weightOz||"";\n';
  h += '      item.location=p.location||"";\n';
  h += '      item.firstEdition=p.firstEdition||false;\n';
  h += '      item.firstEditionPremium=p.firstEditionPremium||false;\n';
  h += '      item.min=p.minPrice||5;\n';
  h += '      item.max=p.maxPrice||20;\n';
  h += '      item.avg=p.avgPrice||12;\n';
  h += '      item.price=p.suggestedPrice||12;\n';
  h += '      item.conditionId=p.conditionId||"3000";\n';
  h += '      item.status="done"\n';
  h += '    })\n';
  h += '    .catch(function(err){item.status="error";item.errorMsg=err.message.substring(0,80);toast("Error: "+item.errorMsg,"err")})\n';
  h += '  })\n';
  h += '}\n';

  h += 'function refresh(item){var n=items.indexOf(item)+1;var c=document.getElementById("c"+item.id);if(c){c.className="card "+item.status;c.innerHTML=cardHTML(item,n)}}\n';

  h += 'var confirmCallback=null;\n';
  h += 'document.getElementById("confirmYes").onclick=function(){document.getElementById("confirmModal").style.display="none";if(confirmCallback)confirmCallback()};\n';
  h += 'document.getElementById("confirmNo").onclick=function(){document.getElementById("confirmModal").style.display="none";confirmCallback=null};\n';

  h += 'function showConfirm(item,onConfirm){\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var n=items.indexOf(item)+1;\n';
  h += '  document.getElementById("confirmSub").textContent="Book #"+n+" \u2014 confirm before posting";\n';
  h += '  document.getElementById("confirmMainImg").src=item.urls[mi];\n';
  h += '  document.getElementById("confirmTitle").textContent=item.title||"Unknown";\n';
  h += '  document.getElementById("confirmAuthor").textContent=item.author||"Unknown";\n';
  h += '  document.getElementById("confirmFormat").textContent=item.format||"Unknown";\n';
  h += '  document.getElementById("confirmPrice").textContent="$"+item.price;\n';
  h += '  document.getElementById("confirmPhotos").textContent=(item.files.length-1)+" photo(s) will be uploaded (note card excluded)";\n';
  h += '  var thumbs=document.getElementById("confirmThumbs");thumbs.innerHTML="";\n';
  h += '  item.urls.slice(0,-1).forEach(function(url,i){\n';
  h += '    var img=document.createElement("img");\n';
  h += '    img.className="modal-thumb"+(i===mi?" sel":"");\n';
  h += '    img.src=url;\n';
  h += '    img.onclick=function(){\n';
  h += '      document.getElementById("confirmMainImg").src=url;\n';
  h += '      item.mainIdx=i;\n';
  h += '      Array.from(thumbs.children).forEach(function(c){c.classList.remove("sel")});\n';
  h += '      img.classList.add("sel")\n';
  h += '    };\n';
  h += '    thumbs.appendChild(img)\n';
  h += '  });\n';
  h += '  confirmCallback=onConfirm;\n';
  h += '  document.getElementById("confirmModal").style.display="flex"\n';
  h += '}\n';

  h += 'function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;showConfirm(item,function(){doPost(item)})}\n';

  h += 'function doPost(item){\n';
  h += '  item.status="posting";refresh(item);\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var ebayFiles=item.files.length>1?item.files.slice(0,-1):item.files;\n';
  h += '  var orderedFiles=[ebayFiles[mi]].concat(ebayFiles.filter(function(_,i){return i!==mi}));\n';
  h += '  var promises=orderedFiles.map(function(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:f.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(f)})});\n';
  h += '  Promise.all(promises).then(function(images){\n';
  h += '    var ebayTok=localStorage.getItem("fa_ek")||"";\n';
  h += '    return fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({\n';
  h += '      ebayToken:ebayTok,\n';
  h += '      listing:{title:item.title,author:item.author,bookTitle:item.bookTitle,format:item.format,language:item.language,description:item.desc,genre:item.genre,publisher:item.publisher,publicationYear:item.publicationYear,isbn:item.isbn,topic:item.topic,price:item.price,condition:item.condition,conditionId:item.conditionId,weightLbs:item.weightLbs,weightOz:item.weightOz,location:item.location,firstEdition:item.firstEdition},\n';
  h += '      images:images})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.success){item.ebayId=d.itemId;item.ebayUrl=d.url;item.status="posted";toast("Posted! eBay #"+d.itemId,"");updateStats()}\n';
  h += '      else{item.status="done";toast("eBay: "+(d.message||"error").substring(0,80),"err")}\n';
  h += '    })\n';
  h += '    .catch(function(err){item.status="done";toast("Error: "+err.message,"err")})\n';
  h += '  }).then(function(){refresh(item)})\n';
  h += '}\n';

  h += 'function postAll(){\n';
  h += '  var ready=items.filter(function(i){return i.status==="done"&&!i.ebayId});\n';
  h += '  if(!ready.length){toast("Analyze items first","err");return}\n';
  h += '  var i=0;\n';
  h += '  function next(){if(i>=ready.length){toast("All posted!","");return}var item=ready[i];showConfirm(item,function(){doPost(item);i++;setTimeout(next,3500)})}\n';
  h += '  next()\n';
  h += '}\n';

  h += 'function updateStats(){\n';
  h += '  var total=items.length,analyzed=items.filter(function(i){return i.status==="done"||i.status==="posted"}).length;\n';
  h += '  var posted=items.filter(function(i){return i.ebayId}).length;\n';
  h += '  var photos=items.reduce(function(s,i){return s+i.files.length},0);\n';
  h += '  var val=items.filter(function(i){return i.price}).reduce(function(s,i){return s+(parseFloat(i.price)||0)},0);\n';
  h += '  document.getElementById("sPhotos").textContent=photos;\n';
  h += '  document.getElementById("sBooks").textContent=total;\n';
  h += '  document.getElementById("sAnalyzed").textContent=analyzed;\n';
  h += '  document.getElementById("sValue").textContent="$"+Math.round(val).toLocaleString();\n';
  h += '  document.getElementById("sPosted").textContent=posted;\n';
  h += '}\n';

  h += 'function toast(msg,type){var w=document.getElementById("toasts"),t=document.createElement("div");t.className="toast"+(type?" "+type:"");t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},5000)}\n';

  h += '</script></body></html>';

  res.send(h);
});

app.listen(PORT, function() { console.log('FlipAI Bookslayer running on port ' + PORT); });
