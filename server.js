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

// VERIFY CLAUDE KEY
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

// ANALYZE — last image is note card with condition/shelf/weight. All others are book photos.
app.post('/analyze', async function(req, res) {
  var apiKey = req.body.apiKey;
  var images = req.body.images;
  if (!apiKey || !images || !images.length) return res.status(400).json({ error: 'Missing apiKey or images' });
  try {
    var content = [];
    images.forEach(function(img) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data } });
    });
    content.push({ type: 'text', text: 'You are a professional book reseller. Analyze these book photos for an eBay listing. Look carefully at the cover and spine to find the title and author. Reply ONLY with raw JSON, no markdown:\n{"title":"Full Book Title","author":"Author Full Name or Unknown","bookTitle":"Title Only no subtitle","format":"Hardcover or Paperback or Trade Paperback","language":"English","description":"2-3 sentences about the book","genre":"Fiction or Nonfiction or Mystery or Romance or Thriller etc","publisher":"Publisher Name or unknown","publicationYear":"YYYY or unknown","isbn":"ISBN if visible or unknown","topic":"main subject/topic","firstEdition":"Yes if stated on copyright page, No otherwise","minPrice":5,"maxPrice":25,"avgPrice":12,"suggestedPrice":10}' });
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 700, messages: [{ role: 'user', content: content }] })
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ANALYZE NOTE CARD — reads just the last photo for condition/shelf/weight
app.post('/analyze-notecard', async function(req, res) {
  var apiKey = req.body.apiKey;
  var image = req.body.image;
  if (!apiKey || !image) return res.status(400).json({ error: 'Missing apiKey or image' });
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: image.mimeType || 'image/jpeg', data: image.data } },
          { type: 'text', text: 'This is a handwritten note card for a used book. Read it carefully and extract: condition, shelf/storage location, weight in lbs and oz. Reply ONLY with raw JSON: {"condition":"text from card","shelfLocation":"location from card","weightLbs":"number or 0","weightOz":"number or 0"}' }
        ]}]
      })
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// UPLOAD ONE PHOTO TO EBAY
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
    xmlPayload + CRLF, 'utf8');
  var imgHeader = Buffer.from(
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="image"; filename="book.' + ext + '"' + CRLF +
    'Content-Type: ' + (mimeType || 'image/jpeg') + CRLF +
    'Content-Transfer-Encoding: binary' + CRLF + CRLF, 'utf8');
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

// POST LISTING TO EBAY
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

    // Condition mapping
    var conditionMap = {
      'new': '1000',
      'like new': '2750',
      'very good': '2750',
      'good': '3000',
      'acceptable': '4000',
      'poor': '7000',
      'for parts': '7000',
      'for parts/not working': '7000'
    };
    var conditionId = conditionMap[(listing.condition || 'good').toLowerCase()] || '3000';

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

    // DEBUG — log exactly what we received
    console.log('POST-LISTING received:', JSON.stringify({
      title: listing.title,
      author: listing.author,
      bookTitle: listing.bookTitle,
      language: listing.language,
      format: listing.format,
      genre: listing.genre
    }));

    // Item specifics — required fields always sent with fallbacks
    var specifics = '';
    // Required by eBay — always send
    specifics += '<NameValueList><n>Author</n><Value>' + esc(listing.author || 'Unknown') + '</Value></NameValueList>';
    specifics += '<NameValueList><n>Book Title</n><Value>' + esc(listing.bookTitle || listing.title || 'Unknown') + '</Value></NameValueList>';
    specifics += '<NameValueList><n>Language</n><Value>English</Value></NameValueList>';
    // Optional — only send if known
    if (listing.format) specifics += '<NameValueList><n>Format</n><Value>' + esc(listing.format) + '</Value></NameValueList>';
    if (listing.genre) specifics += '<NameValueList><n>Genre</n><Value>' + esc(listing.genre) + '</Value></NameValueList>';
    if (listing.publisher && listing.publisher !== 'unknown') specifics += '<NameValueList><n>Publisher</n><Value>' + esc(listing.publisher) + '</Value></NameValueList>';
    if (listing.publicationYear && listing.publicationYear !== 'unknown') specifics += '<NameValueList><n>Publication Year</n><Value>' + esc(listing.publicationYear) + '</Value></NameValueList>';
    if (listing.isbn && listing.isbn !== 'unknown') specifics += '<NameValueList><n>ISBN</n><Value>' + esc(listing.isbn) + '</Value></NameValueList>';
    if (listing.topic) specifics += '<NameValueList><n>Topic</n><Value>' + esc(listing.topic) + '</Value></NameValueList>';
    // First edition — only add if confirmed Yes (worth noting, skip if No/unknown)
    if (listing.firstEdition && listing.firstEdition.toLowerCase() === 'yes') specifics += '<NameValueList><n>Edition</n><Value>1st Edition</Value></NameValueList>';

    // Description: AI text + shelf location appended
    var description = (listing.description || '');
    if (listing.shelfLocation) description += '\n\nLocation: ' + listing.shelfLocation;

    // Weight + box dimensions (only include if weight provided)
    var weightXml = '';
    if (listing.weightLbs || listing.weightOz) {
      var boxL = parseInt(listing.boxL) || 7;
      var boxW = parseInt(listing.boxW) || 7;
      var boxH = parseInt(listing.boxH) || 7;
      weightXml = '<ShippingPackageDetails>' +
        '<WeightMajor unit="lbs">' + (parseInt(listing.weightLbs) || 0) + '</WeightMajor>' +
        '<WeightMinor unit="oz">' + (parseInt(listing.weightOz) || 0) + '</WeightMinor>' +
        '<PackageDepth unit="in">' + boxH + '</PackageDepth>' +
        '<PackageLength unit="in">' + boxL + '</PackageLength>' +
        '<PackageWidth unit="in">' + boxW + '</PackageWidth>' +
        '</ShippingPackageDetails>';
    }

    var xml = '<?xml version="1.0" encoding="utf-8"?>' +
      '<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
      '<RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials>' +
      '<Item>' +
      '<Title>' + esc(listing.title) + '</Title>' +
      '<Description><![CDATA[' + description + ']]></Description>' +
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
      res.status(400).json({ success: false, message: allErrors || 'eBay error', raw: text.substring(0, 600) });
    }
  } catch(e) {
    console.log('post-listing error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// FRONTEND
app.get('/', function(req, res) {
  res.setHeader('Content-Type', 'text/html');
  var h = '';
  h += '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI Bookslayer</title><style>';
  h += '*{box-sizing:border-box;margin:0;padding:0}';
  h += 'body{background:#0a0a0f;color:#f0f0ff;font-family:monospace;padding:24px;max-width:1300px;margin:0 auto}';
  h += 'h1{font-size:1.8rem;font-weight:800;color:#00e5a0;margin-bottom:4px}';
  h += '.sub{font-size:0.8rem;color:#6b6b8a;margin-bottom:24px}';
  h += '.section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;padding:20px;margin-bottom:20px}';
  h += '.section h2{font-size:0.75rem;color:#00e5a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}';
  h += 'label{display:block;font-size:0.7rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:4px}';
  h += 'input,select{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px;color:#f0f0ff;font-family:monospace;margin-bottom:12px;font-size:0.85rem}';
  h += '.btn{background:#00e5a0;color:#0a0a0f;border:none;border-radius:8px;padding:11px 22px;font-weight:bold;font-size:0.85rem;cursor:pointer;margin-right:8px;margin-bottom:8px;transition:filter .15s}';
  h += '.btn:hover{filter:brightness(1.15)}.btn-purple{background:#7c6bff;color:#fff}.btn-outline{background:transparent;color:#00e5a0;border:1px solid #00e5a0}.btn-orange{background:#ff6b35;color:#fff}.btn-sm{padding:6px 12px;font-size:0.75rem}';
  h += '.kstatus{font-size:0.8rem;margin-top:8px;color:#00e5a0;min-height:18px}.kstatus.err{color:#ff6b35}';
  h += '.drop{border:2px dashed #2a2a3d;border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;position:relative;background:#12121a;transition:all .2s;margin-bottom:20px}';
  h += '.drop:hover,.drop.over{border-color:#00e5a0;background:rgba(0,229,160,.03)}';
  h += '.drop input[type=file]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}';
  h += '.drop-icon{font-size:3rem;margin-bottom:12px}.drop h2{font-size:1.3rem;font-weight:800;color:#f0f0ff;margin-bottom:8px}.drop p{color:#6b6b8a;font-size:0.85rem;line-height:1.6}';
  h += '.drop .tip{background:#1a1a26;border:1px solid #2a2a3d;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:0.78rem;color:#00e5a0;text-align:left}';
  h += '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}';
  h += '.stat{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:14px;text-align:center}';
  h += '.stat-num{font-size:1.6rem;font-weight:800;color:#00e5a0}.stat-num.or{color:#ff6b35}.stat-num.pu{color:#7c6bff}.stat-num.ye{color:#ffb800}';
  h += '.stat-lbl{font-size:0.65rem;color:#6b6b8a;text-transform:uppercase;margin-top:4px}';
  h += '.prog{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:16px;margin-bottom:20px}';
  h += '.prog-track{background:#12121a;border-radius:100px;height:8px;margin:10px 0;overflow:hidden}';
  h += '.prog-fill{height:100%;background:linear-gradient(90deg,#00e5a0,#7c6bff);border-radius:100px;transition:width .4s}';
  h += '.prog-lbl{font-size:0.78rem;color:#6b6b8a}';
  h += '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}';
  h += '.card{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;overflow:hidden;transition:border-color .2s}';
  h += '.card.done{border-color:#00e5a0}.card.error{border-color:#ff6b35}.card.processing{border-color:#7c6bff}.card.posting{border-color:#ffb800}.card.posted{border-color:#00e5a0;opacity:.7}';
  h += '.thumbs{display:flex;gap:3px;padding:6px;background:#0a0a0f;flex-wrap:wrap}';
  h += '.th{width:52px;height:52px;object-fit:cover;border-radius:5px;border:2px solid transparent;cursor:pointer;transition:border-color .15s}';
  h += '.th.sel{border-color:#00e5a0}.th.nc{border-color:#ff6b35;opacity:.55;cursor:default}';
  h += '.main-img{width:100%;height:165px;object-fit:cover;display:block}';
  h += '.cb{padding:12px}.cmeta{font-size:0.68rem;color:#6b6b8a;margin-bottom:8px}';
  h += '.pbox{background:#12121a;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:0.76rem}';
  h += '.pbig{color:#ffb800;font-size:0.95rem;font-weight:bold}';
  h += '.ef{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:5px;padding:7px 9px;color:#f0f0ff;font-family:monospace;font-size:0.75rem;margin-bottom:6px}';
  h += '.ef.hi{border-color:#ffb800}';
  h += '.r2{display:grid;grid-template-columns:1fr 1fr;gap:6px}';
  h += '.r3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}';
  h += '.fl{font-size:0.63rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:2px}';
  h += '.fl.g{color:#00e5a0}.fl.y{color:#ffb800}';
  h += '.acts{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}';
  h += '.tw{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:480px}';
  h += '.tn{background:#1a1a26;border:1px solid #00e5a0;border-radius:8px;padding:12px 16px;font-size:0.82rem;word-break:break-word}.tn.err{border-color:#ff6b35}';
  h += '.mbg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px}';
  h += '.mo{background:#1a1a26;border:1px solid #00e5a0;border-radius:16px;padding:24px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto}';
  h += '.mo h3{font-size:1.1rem;font-weight:800;color:#00e5a0;margin-bottom:4px}.mo .ms{font-size:0.75rem;color:#6b6b8a;margin-bottom:16px}';
  h += '.mimg{width:100%;height:220px;object-fit:contain;background:#12121a;border-radius:10px;margin-bottom:14px}';
  h += '.mths{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}';
  h += '.mth{width:58px;height:58px;object-fit:cover;border-radius:6px;border:2px solid #2a2a3d;cursor:pointer}.mth.s{border-color:#00e5a0}';
  h += '.mi{background:#12121a;border-radius:8px;padding:12px;margin-bottom:14px;font-size:0.8rem}';
  h += '.mi .rw{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2a3d}.mi .rw:last-child{border:none}';
  h += '.mi .lb{color:#6b6b8a}.mi .vl{color:#f0f0ff;font-weight:bold;text-align:right;max-width:65%}';
  h += '.mac{display:flex;gap:10px}';
  h += '</style></head><body>';

  h += '<h1>FlipAI \u2014 Bookslayer</h1>';
  h += '<div class="sub">Last photo = note card (condition + shelf + weight) \u2014 AI reads it, drops it, posts only book photos</div>';

  h += '<div class="section"><h2>\ud83d\udd11 Keys</h2>';
  h += '<label>Claude API Key</label><input type="password" id="apiKey" placeholder="sk-ant-api03-...">';
  h += '<label>eBay App ID</label><input type="text" id="ebayKey" placeholder="YOURNAME-App-PRD-...">';
  h += '<button class="btn" onclick="verify()">Verify Keys</button>';
  h += '<div class="kstatus" id="keyStatus"></div></div>';

  h += '<div class="drop" id="drop">';
  h += '<input type="file" accept="image/*" multiple onchange="handleFiles(this.files)">';
  h += '<div class="drop-icon">\ud83d\udcf1</div>';
  h += '<h2>Dump Your Camera Roll Here</h2>';
  h += '<p>Select all photos \u2014 AI groups into books by timestamp gap</p>';
  h += '<div class="tip">\ud83d\uddd2 <strong>Note card workflow:</strong> Last photo per book = handwritten card with condition, shelf location, weight. AI reads it then drops it \u2014 never uploaded to eBay.</div>';
  h += '</div>';

  h += '<div id="sw" style="display:none">';
  h += '<div class="stats">';
  h += '<div class="stat"><div class="stat-num" id="sP">0</div><div class="stat-lbl">Photos</div></div>';
  h += '<div class="stat"><div class="stat-num or" id="sB">0</div><div class="stat-lbl">Books</div></div>';
  h += '<div class="stat"><div class="stat-num pu" id="sA">0</div><div class="stat-lbl">Analyzed</div></div>';
  h += '<div class="stat"><div class="stat-num ye" id="sV">$0</div><div class="stat-lbl">Est. Value</div></div>';
  h += '<div class="stat"><div class="stat-num" id="sPo">0</div><div class="stat-lbl">Posted</div></div>';
  h += '</div>';
  h += '<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">';
  h += '<button class="btn" onclick="analyzeAll()">Analyze All</button>';
  h += '<button class="btn btn-purple" onclick="postAll()">Post All to eBay</button>';
  h += '<button class="btn btn-outline" onclick="clearAll()">Clear All</button>';
  h += '<span id="gi" style="font-size:0.75rem;color:#6b6b8a;align-self:center"></span>';
  h += '</div>';
  h += '<div class="prog" id="pg" style="display:none"><div class="prog-lbl" id="pl">Starting...</div>';
  h += '<div class="prog-track"><div class="prog-fill" id="pf" style="width:0%"></div></div></div>';
  h += '</div>';

  h += '<div class="grid" id="grid"></div>';
  h += '<div class="tw" id="tw"></div>';

  // Confirm modal
  h += '<div class="mbg" id="cm" style="display:none"><div class="mo">';
  h += '<h3>Confirm Before Posting</h3><div class="ms" id="cms"></div>';
  h += '<img class="mimg" id="cmi" src=""><div class="mths" id="cmt"></div>';
  h += '<div class="mi">';
  h += '<div class="rw"><span class="lb">Title</span><span class="vl" id="ct"></span></div>';
  h += '<div class="rw"><span class="lb">Author</span><span class="vl" id="ca"></span></div>';
  h += '<div class="rw"><span class="lb">Condition</span><span class="vl" id="cc"></span></div>';
  h += '<div class="rw"><span class="lb">Shelf Location</span><span class="vl" id="cl"></span></div>';
  h += '<div class="rw"><span class="lb">Price</span><span class="vl" id="cp"></span></div>';
  h += '<div class="rw"><span class="lb">Photos to eBay</span><span class="vl" id="cph"></span></div>';
  h += '</div>';
  h += '<div class="mac"><button class="btn" style="flex:1" id="cy">\u2713 Yes, Post to eBay</button>';
  h += '<button class="btn btn-orange" style="flex:1" id="cn">\u2717 Cancel</button></div>';
  h += '</div></div>';

  h += '<script>\n';
  h += 'var items=[],busy=false,GAP=30;\n';

  h += 'var drop=document.getElementById("drop");\n';
  h += 'drop.addEventListener("dragover",function(e){e.preventDefault();drop.classList.add("over")});\n';
  h += 'drop.addEventListener("dragleave",function(){drop.classList.remove("over")});\n';
  h += 'drop.addEventListener("drop",function(e){e.preventDefault();drop.classList.remove("over");handleFiles(e.dataTransfer.files)});\n';

  h += 'window.onload=function(){var k=localStorage.getItem("fa_ck"),e=localStorage.getItem("fa_ek");if(k)document.getElementById("apiKey").value=k;if(e)document.getElementById("ebayKey").value=e;if(k)ss("Keys loaded","")};\n';

  h += 'function ss(m,t){var s=document.getElementById("keyStatus");s.textContent=m;s.className="kstatus"+(t?" "+t:"")}\n';

  h += 'function verify(){\n';
  h += '  var k=document.getElementById("apiKey").value.trim();\n';
  h += '  var e=document.getElementById("ebayKey").value.trim();\n';
  h += '  if(!k){ss("Enter Claude API key","err");return}\n';
  h += '  ss("Testing...","");\n';
  h += '  fetch("/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k})})\n';
  h += '  .then(function(r){return r.json()}).then(function(d){\n';
  h += '    if(d.error){ss("Error: "+d.error,"err");return}\n';
  h += '    localStorage.setItem("fa_ck",k);if(e)localStorage.setItem("fa_ek",e);\n';
  h += '    ss("Claude API working! Ready to analyze.","");\n';
  h += '  }).catch(function(err){ss("Failed: "+err.message,"err")})\n';
  h += '}\n';

  h += 'function handleFiles(files){\n';
  h += '  var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});\n';
  h += '  if(!imgs.length){toast("No images found","err");return}\n';
  h += '  imgs.sort(function(a,b){return a.lastModified-b.lastModified});\n';
  h += '  var groups=[],cur=[];\n';
  h += '  for(var i=0;i<imgs.length;i++){\n';
  h += '    if(!cur.length){cur.push(imgs[i]);}\n';
  h += '    else{var g=(imgs[i].lastModified-imgs[i-1].lastModified)/1000;\n';
  h += '      if(g<=GAP&&cur.length<13){cur.push(imgs[i]);}else{groups.push(cur);cur=[imgs[i]];}}\n';
  h += '  }\n';
  h += '  if(cur.length)groups.push(cur);\n';
  h += '  groups.forEach(function(g){\n';
  h += '    items.push({id:Date.now()+Math.random(),files:g,urls:g.map(function(f){return URL.createObjectURL(f)}),mainIdx:0,\n';
  h += '      status:"idle",title:"",author:"",bookTitle:"",format:"",language:"English",\n';
  h += '      desc:"",genre:"",publisher:"",publicationYear:"",isbn:"",topic:"",\n';
  h += '      condition:"",shelfLocation:"",firstEdition:"",weightLbs:"",weightOz:"",\n';
  h += '      boxL:"7",boxW:"7",boxH:"7",price:10,min:5,max:20,avg:12});\n';
  h += '  });\n';
  h += '  document.getElementById("sw").style.display="block";\n';
  h += '  document.getElementById("gi").textContent="Grouped "+imgs.length+" photos into "+groups.length+" books ("+GAP+"s gap)";\n';
  h += '  render();updateStats();toast("Grouped "+imgs.length+" photos into "+groups.length+" books!","");\n';
  h += '}\n';

  h += 'function setMain(id,idx){var it=items.find(function(i){return i.id==id});if(it){it.mainIdx=idx;refresh(it)}}\n';
  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(it,n){var d=document.createElement("div");d.className="card "+it.status;d.id="c"+it.id;d.innerHTML=cardHTML(it,n+1);g.appendChild(d)})}\n';

  h += 'function cardHTML(it,num){\n';
  h += '  var mi=it.mainIdx||0;\n';
  h += '  var bUrls=it.urls.slice(0,it.urls.length-1);\n';
  h += '  var ncUrl=it.urls[it.urls.length-1];\n';
  h += '  var b="<img class=\'main-img\' src=\'"+it.urls[mi]+"\' loading=\'lazy\'>";\n';
  h += '  b+="<div class=\'thumbs\'>";\n';
  h += '  bUrls.forEach(function(url,i){b+="<img class=\'th"+(i===mi?" sel":"")+"\' src=\'"+url+"\' onclick=\'setMain("+it.id+","+i+")\' title=\'Photo "+(i+1)+"\'>"}); \n';
  h += '  b+="<img class=\'th nc\' src=\'"+ncUrl+"\' title=\'Note card \u2014 not posted to eBay\'>";\n';
  h += '  b+="</div><div class=\'cb\'>";\n';
  h += '  b+="<div class=\'cmeta\'>Book #"+num+" \u2022 "+bUrls.length+" book photo"+(bUrls.length!==1?"s":"")+" + \ud83d\uddd2 note \u2022 "+it.status+"</div>";\n';
  h += '  if(it.status==="processing"){b+="<div style=\'color:#7c6bff;padding:8px 0\'>Reading note card + analyzing...</div>";}\n';
  h += '  else if(it.status==="posting"){b+="<div style=\'color:#ffb800;padding:8px 0\'>Uploading & posting to eBay...</div>";}\n';
  h += '  else if(it.title){\n';
  h += '    b+="<div class=\'pbox\'>Range $"+it.min+"\u2013$"+it.max+" \u2022 Avg $"+it.avg+"<br><span class=\'pbig\'>List: $"+it.price+"</span></div>";\n';
  // Title
  h += '    b+="<div class=\'fl\'>Title</div><input class=\'ef\' value=\'"+esc(it.title)+"\' onchange=\'upd("+it.id+",\\"title\\",this.value)\'>";\n';
  // Author (highlighted yellow if Unknown)
  h += '    b+="<div class=\'fl y\'>\u270f Author"+(it.author==="Unknown"?" \u26a0 fill in manually":""  )+"</div>";\n';
  h += '    b+="<input class=\'ef"+(it.author==="Unknown"?" hi":"")+"\' value=\'"+esc(it.author)+"\' placeholder=\'Type author name\' onchange=\'upd("+it.id+",\\"author\\",this.value)\'>";\n';
  // Format + Genre row
  h += '    b+="<div class=\'r2\'><div><div class=\'fl\'>Format</div><input class=\'ef\' value=\'"+esc(it.format)+"\' onchange=\'upd("+it.id+",\\"format\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'fl\'>Genre</div><input class=\'ef\' value=\'"+esc(it.genre)+"\' onchange=\'upd("+it.id+",\\"genre\\",this.value)\'></div></div>";\n';
  // Condition (from note card)
  h += '    b+="<div class=\'fl g\'>\ud83d\uddd2 Condition (note card)</div><input class=\'ef\' value=\'"+esc(it.condition)+"\' placeholder=\'e.g. Good, Like New\' onchange=\'upd("+it.id+",\\"condition\\",this.value)\'>";\n';
  h += '    if(it.firstEdition&&it.firstEdition.toLowerCase()==="yes"){b+="<div style=\'background:#2a1a00;border:1px solid #ffb800;border-radius:5px;padding:5px 9px;font-size:0.72rem;color:#ffb800;margin-bottom:6px\'>\u2b50 1st Edition \u2014 consider higher price</div>";}\n';
  // Shelf location (from note card)
  h += '    b+="<div class=\'fl g\'>\ud83d\udccd Shelf Location (note card)</div><input class=\'ef\' value=\'"+esc(it.shelfLocation)+"\' placeholder=\'e.g. Shelf B3\' onchange=\'upd("+it.id+",\\"shelfLocation\\",this.value)\'>";\n';
  // Weight row (from note card)
  h += '    b+="<div class=\'r2\'><div><div class=\'fl g\'>\u2696 Weight lbs</div><input class=\'ef\' type=\'number\' placeholder=\'0\' value=\'"+(it.weightLbs||"")+"\' onchange=\'upd("+it.id+",\\"weightLbs\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'fl g\'>\u2696 Weight oz</div><input class=\'ef\' type=\'number\' placeholder=\'0\' value=\'"+(it.weightOz||"")+"\' onchange=\'upd("+it.id+",\\"weightOz\\",this.value)\'></div></div>";\n';
  // Box dimensions (default 7x7x7, editable)
  h += '    b+="<div class=\'fl\'>\ud83d\udce6 Box L\xd7W\xd7H (inches, default 7\xd77\xd77)</div>";\n';
  h += '    b+="<div class=\'r3\'>";\n';
  h += '    b+="<div><div class=\'fl\'>L</div><input class=\'ef\' type=\'number\' value=\'"+(it.boxL||"7")+"\' onchange=\'upd("+it.id+",\\"boxL\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'fl\'>W</div><input class=\'ef\' type=\'number\' value=\'"+(it.boxW||"7")+"\' onchange=\'upd("+it.id+",\\"boxW\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'fl\'>H</div><input class=\'ef\' type=\'number\' value=\'"+(it.boxH||"7")+"\' onchange=\'upd("+it.id+",\\"boxH\\",this.value)\'></div>";\n';
  h += '    b+="</div>";\n';
  // Price
  h += '    b+="<div class=\'fl\'>Price $</div><input class=\'ef\' type=\'number\' value=\'"+it.price+"\' onchange=\'upd("+it.id+",\\"price\\",this.value)\'>";\n';
  // Actions
  h += '    if(it.ebayId){b+="<a href=\'"+it.ebayUrl+"\' target=\'_blank\' class=\'btn btn-sm\' style=\'text-decoration:none;display:inline-block;margin-top:6px\'>\u2713 View on eBay</a>";}\n';
  h += '    else{b+="<div class=\'acts\'><button class=\'btn btn-sm btn-purple\' onclick=\'postOne("+it.id+")\'>Post to eBay</button><button class=\'btn btn-sm btn-outline\' onclick=\'analyzeOne("+it.id+")\'>Re-analyze</button></div>";}\n';
  h += '  }\n';
  h += '  else if(it.status==="error"){b+="<div style=\'color:#ff6b35;font-size:.78rem;margin:8px 0\'>"+(it.errorMsg||"Failed")+"</div><div class=\'acts\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+it.id+")\'>Retry</button></div>";}\n';
  h += '  else{b+="<div class=\'acts\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+it.id+")\'>Analyze</button></div>";}\n';
  h += '  b+="</div>";return b\n';
  h += '}\n';

  h += 'function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}\n';
  h += 'function upd(id,f,v){var i=items.find(function(x){return x.id==id});if(i){i[f]=v;updateStats()}}\n';
  h += 'function clearAll(){items=[];render();document.getElementById("sw").style.display="none";updateStats()}\n';
  h += 'function analyzeOne(id){var it=items.find(function(i){return i.id==id});if(it)doAnalyze(it).then(function(){refresh(it);updateStats()})}\n';

  h += 'function analyzeAll(){\n';
  h += '  if(busy)return;\n';
  h += '  var k=localStorage.getItem("fa_ck");if(!k){toast("Verify API key first","err");return}\n';
  h += '  busy=true;var q=items.filter(function(i){return i.status==="idle"||i.status==="error"});\n';
  h += '  if(!q.length){busy=false;toast("All analyzed!","");return}\n';
  h += '  var idx=0;document.getElementById("pg").style.display="block";\n';
  h += '  function next(){\n';
  h += '    if(idx>=q.length){busy=false;document.getElementById("pg").style.display="none";toast("Done! "+q.length+" books analyzed","");updateStats();return}\n';
  h += '    var it=q[idx];\n';
  h += '    document.getElementById("pf").style.width=Math.round(idx/q.length*100)+"%";\n';
  h += '    document.getElementById("pl").textContent="Analyzing book "+(idx+1)+" of "+q.length;\n';
  h += '    doAnalyze(it).then(function(){refresh(it);updateStats();idx++;next()})\n';
  h += '  }\n';
  h += '  next()\n';
  h += '}\n';

  // doAnalyze — send ALL files including note card (last). Server reads note card for condition/shelf/weight.
  h += 'function doAnalyze(it){\n';
  h += '  var k=localStorage.getItem("fa_ck");\n';
  h += '  if(!k){it.status="error";it.errorMsg="No API key";return Promise.resolve()}\n';
  h += '  it.status="processing";refresh(it);\n';
  h += '  var bookFiles=it.files.slice(0,it.files.length-1);\n';
  h += '  var promises=bookFiles.map(function(file){\n';
  h += '    return new Promise(function(res,rej){\n';
  h += '      var fr=new FileReader();fr.onload=function(){\n';
  h += '        var img=new Image();img.onload=function(){\n';
  h += '          var MAX=800,scale=Math.min(MAX/img.width,MAX/img.height,1);\n';
  h += '          var c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);\n';
  h += '          c.getContext("2d").drawImage(img,0,0,c.width,c.height);\n';
  h += '          res({data:c.toDataURL("image/jpeg",0.85).split(",")[1],mimeType:"image/jpeg"});\n';
  h += '        };img.src=fr.result;\n';
  h += '      };fr.onerror=rej;fr.readAsDataURL(file);\n';
  h += '    })\n';
  h += '  });\n';
  h += '  // Encode note card (last file) separately\n';
  h += '  var ncFile=it.files[it.files.length-1];\n';
  h += '  var ncPromise=new Promise(function(res,rej){var fr=new FileReader();fr.onload=function(){var img=new Image();img.onload=function(){var MAX=800,scale=Math.min(MAX/img.width,MAX/img.height,1);var c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext("2d").drawImage(img,0,0,c.width,c.height);res({data:c.toDataURL("image/jpeg",0.85).split(",")[1],mimeType:"image/jpeg"})};img.src=fr.result};fr.onerror=rej;fr.readAsDataURL(ncFile)});\n';
  h += '  return Promise.all(promises).then(function(images){\n';
  h += '    var bookCall=fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,images:images})}).then(function(r){return r.json()});\n';
  h += '    var ncCall=ncPromise.then(function(ncImg){return fetch("/analyze-notecard",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,image:ncImg})}).then(function(r){return r.json()})});\n';
  h += '    return Promise.all([bookCall,ncCall]).then(function(results){\n';
  h += '      var d=results[0],nc=results[1];\n';
  h += '      if(d.error)throw new Error(d.error);\n';
  h += '      var t=(d.content||[]).map(function(c){return c.text||""}).join("");\n';
  h += '      var s=t.indexOf("{"),e=t.lastIndexOf("}");\n';
  h += '      if(s<0||e<0)throw new Error("No JSON in response");\n';
  h += '      var p=JSON.parse(t.slice(s,e+1));\n';
  h += '      // Book fields from book photos\n';
  h += '      it.title=p.title||"Book";it.author=p.author||"Unknown";it.bookTitle=p.bookTitle||"";\n';
  h += '      it.format=p.format||"";it.language=p.language||"English";\n';
  h += '      it.desc=p.description||"";it.genre=p.genre||"";\n';
  h += '      it.publisher=p.publisher||"";it.publicationYear=p.publicationYear||"";\n';
  h += '      it.isbn=p.isbn||"";it.topic=p.topic||"";it.firstEdition=p.firstEdition||"";\n';
  h += '      it.min=p.minPrice||5;it.max=p.maxPrice||20;it.avg=p.avgPrice||12;it.price=p.suggestedPrice||12;\n';
  h += '      // Note card fields from dedicated note card call\n';
  h += '      try{\n';
  h += '        var nt=(nc.content||[]).map(function(c){return c.text||""}).join("");\n';
  h += '        var ns=nt.indexOf("{"),ne=nt.lastIndexOf("}");\n';
  h += '        if(ns>=0&&ne>=0){var np=JSON.parse(nt.slice(ns,ne+1));\n';
  h += '          it.condition=np.condition||"";it.shelfLocation=np.shelfLocation||"";\n';
  h += '          it.weightLbs=String(np.weightLbs||"");it.weightOz=String(np.weightOz||"");\n';
  h += '        }\n';
  h += '      }catch(e2){console.log("Note card parse failed",e2.message)}\n';
  h += '      it.status="done";\n';
  h += '    })\n';
  h += '    .catch(function(err){it.status="error";it.errorMsg=err.message.substring(0,100);toast("Error: "+it.errorMsg,"err")})\n';
  h += '  })\n';
  h += '}\n';

  h += 'function refresh(it){var n=items.indexOf(it)+1;var c=document.getElementById("c"+it.id);if(c){c.className="card "+it.status;c.innerHTML=cardHTML(it,n)}}\n';

  h += 'var ccb=null;\n';
  h += 'document.getElementById("cy").onclick=function(){document.getElementById("cm").style.display="none";if(ccb)ccb()};\n';
  h += 'document.getElementById("cn").onclick=function(){document.getElementById("cm").style.display="none";ccb=null;toast("Cancelled","")};\n';

  h += 'function showConfirm(it,cb){\n';
  h += '  var mi=it.mainIdx||0,bCount=it.files.length-1,n=items.indexOf(it)+1;\n';
  h += '  document.getElementById("cms").textContent="Book #"+n+" of "+items.length+" \u2014 Ready to post?";\n';
  h += '  document.getElementById("cmi").src=it.urls[mi];\n';
  h += '  document.getElementById("ct").textContent=it.title;\n';
  h += '  document.getElementById("ca").textContent=it.author||"(not set)";\n';
  h += '  document.getElementById("cc").textContent=it.condition||"(not set)";\n';
  h += '  document.getElementById("cl").textContent=it.shelfLocation||"(not set)";\n';
  h += '  document.getElementById("cp").textContent="$"+it.price;\n';
  h += '  document.getElementById("cph").textContent=bCount+" (note card excluded)";\n';
  h += '  var th=document.getElementById("cmt");th.innerHTML="";\n';
  h += '  it.urls.slice(0,bCount).forEach(function(url,i){var img=document.createElement("img");img.className="mth"+(i===mi?" s":"");img.src=url;img.onclick=function(){document.getElementById("cmi").src=url;it.mainIdx=i;Array.from(th.children).forEach(function(c){c.classList.remove("s")});img.classList.add("s")};th.appendChild(img)});\n';
  h += '  ccb=cb;document.getElementById("cm").style.display="flex"\n';
  h += '}\n';

  h += 'function postOne(id){var it=items.find(function(i){return i.id==id});if(!it)return;showConfirm(it,function(){doPost(it)})}\n';

  // doPost — strips last file (note card) before sending to server
  h += 'function doPost(it){\n';
  h += '  it.status="posting";refresh(it);\n';
  h += '  var mi=it.mainIdx||0;\n';
  h += '  var bFiles=it.files.slice(0,it.files.length-1);\n';
  h += '  var ordered=[bFiles[mi]].concat(bFiles.filter(function(_,i){return i!==mi}));\n';
  h += '  var promises=ordered.map(function(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:f.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(f)})});\n';
  h += '  Promise.all(promises).then(function(images){\n';
  h += '    return fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({\n';
  h += '      listing:{title:it.title,author:it.author,bookTitle:it.bookTitle,format:it.format,\n';
  h += '        language:it.language,description:it.desc,genre:it.genre,publisher:it.publisher,\n';
  h += '        publicationYear:it.publicationYear,isbn:it.isbn,topic:it.topic,price:it.price,\n';
  h += '        condition:it.condition,shelfLocation:it.shelfLocation,firstEdition:it.firstEdition,\n';
  h += '        weightLbs:it.weightLbs,weightOz:it.weightOz,\n';
  h += '        boxL:it.boxL,boxW:it.boxW,boxH:it.boxH},\n';
  h += '      images:images})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.success){it.ebayId=d.itemId;it.ebayUrl=d.url;it.status="posted";refresh(it);toast("Posted! eBay #"+d.itemId,"");updateStats()}\n';
  h += '      else{it.status="error";it.errorMsg=(d.message||"eBay error")+(d.raw?" | "+d.raw:"");refresh(it);toast("eBay: "+it.errorMsg.substring(0,400),"err")}\n';
  h += '    })\n';
  h += '    .catch(function(err){it.status="done";refresh(it);toast("Error: "+err.message,"err")})\n';
  h += '  })\n';
  h += '}\n';

  h += 'function postAll(){\n';
  h += '  var ready=items.filter(function(i){return i.status==="done"&&!i.ebayId});\n';
  h += '  if(!ready.length){toast("Analyze items first","err");return}\n';
  h += '  var i=0;\n';
  h += '  function next(){if(i>=ready.length){toast("All done!","");return}var it=ready[i];showConfirm(it,function(){doPost(it);i++;setTimeout(next,4000)})}\n';
  h += '  next()\n';
  h += '}\n';

  h += 'function updateStats(){\n';
  h += '  var total=items.length,analyzed=items.filter(function(i){return i.status==="done"||i.status==="posted"}).length;\n';
  h += '  var posted=items.filter(function(i){return i.ebayId}).length;\n';
  h += '  var photos=items.reduce(function(s,i){return s+i.files.length},0);\n';
  h += '  var val=items.reduce(function(s,i){return s+(parseFloat(i.price)||0)},0);\n';
  h += '  document.getElementById("sP").textContent=photos;\n';
  h += '  document.getElementById("sB").textContent=total;\n';
  h += '  document.getElementById("sA").textContent=analyzed;\n';
  h += '  document.getElementById("sV").textContent="$"+Math.round(val).toLocaleString();\n';
  h += '  document.getElementById("sPo").textContent=posted;\n';
  h += '}\n';

  h += 'function toast(msg,type){var w=document.getElementById("tw"),t=document.createElement("div");t.className="tn"+(type?" "+type:"");t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},type==="err"?15000:6000)}\n';

  h += '<\/script></body></html>';
  res.send(h);
});


// DEBUG - returns the XML that would be sent to eBay (no actual posting)
app.post('/debug-xml', async function(req, res) {
  var listing = req.body.listing || {};
  var conditionMap = {
    'new': '1000', 'like new': '2750', 'very good': '2750',
    'good': '3000', 'acceptable': '4000', 'poor': '7000',
    'for parts': '7000', 'for parts/not working': '7000'
  };
  var conditionId = conditionMap[(listing.condition || 'good').toLowerCase()] || '3000';
  var categoryMap = {
    'fiction': '261186', 'nonfiction': '11232', 'non-fiction': '11232',
    'children': '11721', "children's": '11721', 'comics': '259104', 'graphic novel': '259104'
  };
  var categoryId = categoryMap[(listing.genre || '').toLowerCase()] || '261186';

  var specifics = '';
  specifics += '<NameValueList><Name>Author</Name><Value>' + esc(listing.author || 'Unknown') + '</Value></NameValueList>';
  if (listing.bookTitle) specifics += '<NameValueList><Name>Book Title</Name><Value>' + esc(listing.bookTitle) + '</Value></NameValueList>';
  if (listing.format)    specifics += '<NameValueList><Name>Format</Name><Value>' + esc(listing.format) + '</Value></NameValueList>';
  if (listing.genre)     specifics += '<NameValueList><Name>Genre</Name><Value>' + esc(listing.genre) + '</Value></NameValueList>';

  var xml = '<?xml version="1.0" encoding="utf-8"?>' +
    '<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    '<RequesterCredentials><eBayAuthToken>TOKEN_REDACTED</eBayAuthToken></RequesterCredentials>' +
    '<Item>' +
    '<Title>' + esc(listing.title || 'Test') + '</Title>' +
    '<ItemSpecifics>' + specifics + '</ItemSpecifics>' +
    '<PrimaryCategory><CategoryID>' + categoryId + '</CategoryID></PrimaryCategory>' +
    '</Item>' +
    '</AddItemRequest>';

  res.setHeader('Content-Type', 'text/plain');
  res.send(xml);
});


// RAW TEST — GET /rawtest?author=Karen+Kingsbury to test with a real author name
app.get('/rawtest', async function(req, res) {
  var testAuthor = req.query.author || 'Karen Kingsbury';
  var token = process.env.EBAY_USER_TOKEN;
  var appId = process.env.EBAY_APP_ID;
  var postal = process.env.POSTAL_CODE || '14701';
  if (!token) return res.send('No EBAY_USER_TOKEN set');

  var xml = '<?xml version="1.0" encoding="utf-8"?>' +
    '<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    '<RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials>' +
    '<Item>' +
    '<Title>Test Book Listing FlipAI</Title>' +
    '<Description><![CDATA[Test description]]></Description>' +
    '<ItemSpecifics>' +
    '<NameValueList><Name>Author</Name><Value>Test Author</Value></NameValueList>' +
    '<NameValueList><Name>Language</Name><Value>English</Value></NameValueList>' +
    '<NameValueList><Name>Format</Name><Value>Paperback</Value></NameValueList>' +
    '</ItemSpecifics>' +
    '<PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory>' +
    '<StartPrice>9.99</StartPrice>' +
    '<Country>US</Country><Currency>USD</Currency>' +
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
    '<ConditionID>3000</ConditionID>' +
    '<Site>US</Site>' +
    '</Item>' +
    '</AddItemRequest>';

  try {
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
    res.setHeader('Content-Type', 'text/plain');
    res.send('=== REQUEST XML ===\n' + xml + '\n\n=== EBAY RESPONSE ===\n' + text);
  } catch(e) {
    res.send('Error: ' + e.message);
  }
});

app.listen(PORT, function() {
  console.log('FlipAI Bookslayer running on port ' + PORT);
});
