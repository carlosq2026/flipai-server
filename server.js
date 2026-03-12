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

app.post('/analyze', async function(req, res) {
  var apiKey = req.body.apiKey;
  var images = req.body.images;
  if (!apiKey || !images || !images.length) return res.status(400).json({ error: 'Missing apiKey or images' });
  try {
    var content = [];
    images.forEach(function(img) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data } });
    });
    content.push({ type: 'text', text: 'Analyze these book photos for eBay resale. Look carefully at ALL text on the cover, spine, and back — especially the author name which is almost always printed on the cover or spine. Reply ONLY with raw JSON, no markdown. Author is REQUIRED — if you can read the book cover, you can find the author. Use empty string only for truly unknown optional fields: {"title":"Full Title","author":"Author Full Name - REQUIRED, look on cover and spine","bookTitle":"Book Title Only without author","format":"Hardcover or Paperback or Trade Paperback","language":"English","description":"2-3 sentence description mentioning condition and key features","genre":"Fiction, Mystery, Science, Biography, History, Self-Help, etc or empty","publisher":"Publisher name if visible or empty","publicationYear":"4-digit year if visible or empty","isbn":"ISBN-10 or ISBN-13 if visible on back cover or empty","topic":"Main subject or topic of the book or empty","minPrice":5,"maxPrice":25,"avgPrice":12,"suggestedPrice":10}' });
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: content }] })
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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

async function uploadPhotoToEbay(base64Data, mimeType, appId, token) {
  var boundary = 'EBAY_BOUNDARY_' + Date.now();
  var xmlPart = '<?xml version="1.0" encoding="utf-8"?><UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials><PictureName>book</PictureName></UploadSiteHostedPicturesRequest>';
  var imgBuffer = Buffer.from(base64Data, 'base64');
  var ext = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  var bodyStart = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="XML Payload"\r\nContent-Type: text/xml;charset=utf-8\r\n\r\n' + xmlPart + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="book.' + ext + '"\r\nContent-Type: ' + (mimeType || 'image/jpeg') + '\r\nContent-Transfer-Encoding: binary\r\n\r\n', 'binary');
  var bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n', 'binary');
  var fullBody = Buffer.concat([bodyStart, imgBuffer, bodyEnd]);
  var r = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'UploadSiteHostedPictures', 'X-EBAY-API-APP-NAME': appId || '', 'Content-Length': fullBody.length },
    body: fullBody
  });
  var text = await r.text();
  var match = text.match(/<FullURL>(.*?)<\/FullURL>/);
  if (match) return match[1];
  throw new Error('Photo upload failed: ' + text.substring(0, 300));
}

app.post('/post-listing', async function(req, res) {
  var listing = req.body.listing;
  var images = req.body.images || [];
  if (!listing) return res.status(400).json({ success: false, message: 'No listing data' });
  var token = process.env.EBAY_USER_TOKEN;
  var appId = process.env.EBAY_APP_ID;
  var postal = process.env.POSTAL_CODE || '14701';
  if (!token) return res.status(500).json({ success: false, message: 'EBAY_USER_TOKEN not set' });
  try {
    var uploadedUrls = [];
    for (var i = 0; i < Math.min(images.length, 12); i++) {
      try {
        var url = await uploadPhotoToEbay(images[i].data, images[i].mimeType, appId, token);
        uploadedUrls.push(url);
      } catch(pe) { console.log('Photo ' + i + ' upload failed:', pe.message); }
    }
    var pictureXml = uploadedUrls.length > 0 ? '<PictureDetails>' + uploadedUrls.map(function(u){ return '<PictureURL>' + u + '</PictureURL>'; }).join('') + '</PictureDetails>' : '';
    var specifics = '';
    specifics += '<NameValueList><Name>Author</Name><Value>' + esc(listing.author || 'Unknown') + '</Value></NameValueList>';
    if (listing.bookTitle) specifics += '<NameValueList><Name>Book Title</Name><Value>' + esc(listing.bookTitle) + '</Value></NameValueList>';
    if (listing.format) specifics += '<NameValueList><Name>Format</Name><Value>' + esc(listing.format) + '</Value></NameValueList>';
    specifics += '<NameValueList><Name>Language</Name><Value>English</Value></NameValueList>';
    if (listing.genre) specifics += '<NameValueList><Name>Genre</Name><Value>' + esc(listing.genre) + '</Value></NameValueList>';
    if (listing.publisher) specifics += '<NameValueList><Name>Publisher</Name><Value>' + esc(listing.publisher) + '</Value></NameValueList>';
    if (listing.publicationYear) specifics += '<NameValueList><Name>Publication Year</Name><Value>' + esc(listing.publicationYear) + '</Value></NameValueList>';
    if (listing.isbn) specifics += '<NameValueList><Name>ISBN</Name><Value>' + esc(listing.isbn) + '</Value></NameValueList>';
    if (listing.topic) specifics += '<NameValueList><Name>Topic</Name><Value>' + esc(listing.topic) + '</Value></NameValueList>';
    var xml = '<?xml version="1.0" encoding="utf-8"?><AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials><Item>' +
      '<Title>' + esc(listing.title) + '</Title>' +
      '<Description><![CDATA[' + (listing.description || '') + ']]></Description>' +
      pictureXml +
      '<ItemSpecifics>' + specifics + '</ItemSpecifics>' +
      '<PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory>' +
      '<StartPrice>' + listing.price + '</StartPrice>' +
      '<Country>US</Country><Currency>USD</Currency>' +
      '<DispatchTimeMax>2</DispatchTimeMax>' +
      '<ListingDuration>GTC</ListingDuration>' +
      '<ListingType>FixedPriceItem</ListingType>' +
      '<PostalCode>' + postal + '</PostalCode>' +
      '<Quantity>1</Quantity>' +
      '<ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>USPSMedia</ShippingService><ShippingServiceCost>3.99</ShippingServiceCost></ShippingServiceOptions></ShippingDetails>' +
      '<ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy>' +
      '<ConditionID>3000</ConditionID><Site>US</Site></Item></AddItemRequest>';
    var r = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'AddItem', 'X-EBAY-API-APP-NAME': appId || '' },
      body: xml
    });
    var text = await r.text();
    if (text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>')) {
      var match = text.match(/<ItemID>(\d+)<\/ItemID>/);
      res.json({ success: true, itemId: match ? match[1] : 'unknown', url: 'https://www.ebay.com/itm/' + (match ? match[1] : '') });
    } else {
      var err = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
      res.status(400).json({ success: false, message: err ? err[1] : 'eBay error', raw: text.substring(0, 400) });
    }
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

app.get('/', function(req, res) {
  res.setHeader('Content-Type', 'text/html');
  var h = '';
  h += '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI - Bookslayer</title>';
  h += '<style>';
  h += '*{box-sizing:border-box;margin:0;padding:0}';
  h += 'body{background:#0a0a0f;color:#f0f0ff;font-family:monospace;padding:24px;max-width:1300px;margin:0 auto}';
  h += 'h1{font-size:1.8rem;font-weight:800;color:#00e5a0;margin-bottom:6px}';
  h += '.subtitle{font-size:0.8rem;color:#6b6b8a;margin-bottom:24px}';
  h += '.section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;padding:20px;margin-bottom:20px}';
  h += '.section h2{font-size:0.75rem;color:#00e5a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}';
  h += 'label{display:block;font-size:0.7rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:5px}';
  h += 'input{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px;color:#f0f0ff;font-family:monospace;margin-bottom:12px;font-size:0.85rem}';
  h += '.btn{background:#00e5a0;color:#0a0a0f;border:none;border-radius:8px;padding:11px 22px;font-weight:bold;font-size:0.85rem;cursor:pointer;margin-right:8px;margin-bottom:8px;transition:filter .15s}';
  h += '.btn:hover{filter:brightness(1.15)}.btn-purple{background:#7c6bff;color:white}.btn-outline{background:transparent;color:#00e5a0;border:1px solid #00e5a0}.btn-orange{background:#ff6b35;color:white}';
  h += '.btn-sm{padding:6px 12px;font-size:0.75rem}';
  h += '.status{font-size:0.8rem;margin-top:8px;color:#00e5a0;min-height:18px}.status.err{color:#ff6b35}';
  h += '.drop{border:2px dashed #2a2a3d;border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;position:relative;background:#12121a;transition:all .2s;margin-bottom:20px}';
  h += '.drop:hover,.drop.over{border-color:#00e5a0;background:rgba(0,229,160,.03)}';
  h += '.drop input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}';
  h += '.drop-icon{font-size:3rem;margin-bottom:12px}';
  h += '.drop h2{font-size:1.3rem;font-weight:800;color:#f0f0ff;margin-bottom:8px;font-family:monospace}';
  h += '.drop p{color:#6b6b8a;font-size:0.85rem;line-height:1.6}';
  h += '.drop .tip{background:#1a1a26;border:1px solid #2a2a3d;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:0.78rem;color:#00e5a0;text-align:left}';
  h += '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}';
  h += '.stat{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:14px;text-align:center}';
  h += '.stat-num{font-size:1.6rem;font-weight:800;color:#00e5a0;font-family:monospace}';
  h += '.stat-num.orange{color:#ff6b35}.stat-num.purple{color:#7c6bff}.stat-num.yellow{color:#ffb800}';
  h += '.stat-lbl{font-size:0.65rem;color:#6b6b8a;text-transform:uppercase;margin-top:4px}';
  h += '.prog-section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:16px;margin-bottom:20px}';
  h += '.prog-track{background:#12121a;border-radius:100px;height:8px;margin:10px 0;overflow:hidden}';
  h += '.prog-fill{height:100%;background:linear-gradient(90deg,#00e5a0,#7c6bff);border-radius:100px;transition:width .4s}';
  h += '.prog-lbl{font-size:0.78rem;color:#6b6b8a}';
  h += '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}';
  h += '.card{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;overflow:hidden;transition:border-color .2s}';
  h += '.card.done{border-color:#00e5a0}.card.error{border-color:#ff6b35}.card.processing{border-color:#7c6bff}.card.posting{border-color:#ffb800}.card.posted{border-color:#00e5a0;opacity:.7}';
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
  h += '.actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}';
  h += '.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:320px}';
  h += '.toast{background:#1a1a26;border:1px solid #00e5a0;border-radius:8px;padding:12px 16px;font-size:0.82rem}';
  h += '.toast.err{border-color:#ff6b35}';
  h += '.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px}';
  h += '.modal{background:#1a1a26;border:1px solid #00e5a0;border-radius:16px;padding:24px;max-width:520px;width:100%}';
  h += '.modal h3{font-size:1.1rem;font-weight:800;color:#00e5a0;margin-bottom:4px}';
  h += '.modal .sub{font-size:0.75rem;color:#6b6b8a;margin-bottom:16px}';
  h += '.modal-img{width:100%;height:220px;object-fit:contain;background:#12121a;border-radius:10px;margin-bottom:14px}';
  h += '.modal-thumbs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}';
  h += '.modal-thumb{width:58px;height:58px;object-fit:cover;border-radius:6px;border:2px solid #2a2a3d;cursor:pointer}';
  h += '.modal-thumb.sel{border-color:#00e5a0}';
  h += '.modal-info{background:#12121a;border-radius:8px;padding:12px;margin-bottom:14px;font-size:0.8rem}';
  h += '.modal-info .row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #2a2a3d}';
  h += '.modal-info .row:last-child{border:none}';
  h += '.modal-info .lbl{color:#6b6b8a}.modal-info .val{color:#f0f0ff;font-weight:bold;text-align:right;max-width:60%}';
  h += '.modal-actions{display:flex;gap:10px}';
  h += '</style></head><body>';

  h += '<h1>FlipAI - Bookslayer Edition</h1>';
  h += '<div class="subtitle">Dump your entire camera roll — AI auto-groups photos into books by timestamp</div>';

  h += '<div class="section"><h2>Step 1 - Enter Keys</h2>';
  h += '<label>Claude API Key</label><input type="password" id="apiKey" placeholder="sk-ant-api03-...">';
  h += '<label>eBay App ID</label><input type="text" id="ebayKey" placeholder="ARLOWES-Bookslay-PRD-...">';
  h += '<button class="btn" onclick="verify()">Verify Keys</button>';
  h += '<div class="status" id="keyStatus"></div></div>';

  h += '<div class="drop" id="drop">';
  h += '<input type="file" accept="image/*" multiple onchange="handleFiles(this.files)">';
  h += '<div class="drop-icon">📱</div>';
  h += '<h2>Dump Your Entire Camera Roll Here</h2>';
  h += '<p>Select ALL your book photos at once — hundreds or thousands at a time<br>FlipAI auto-groups them into books by photo timestamp</p>';
  h += '<div class="tip">📸 <strong>How to shoot:</strong> Take 3-9 photos per book, then pause 5+ seconds before the next book. That gap = new book.</div>';
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
  h += '<div class="row"><span class="lbl">Price</span><span class="val" id="confirmPrice"></span></div>';
  h += '<div class="row"><span class="lbl">Photos</span><span class="val" id="confirmPhotos"></span></div>';
  h += '</div>';
  h += '<div class="modal-actions">';
  h += '<button class="btn" style="flex:1" id="confirmYes">✓ Yes, Post to eBay</button>';
  h += '<button class="btn btn-orange" style="flex:1;background:#ff6b35;color:white" id="confirmNo">✗ Cancel</button>';
  h += '</div></div></div>';

  h += '<script>\n';
  h += 'var items=[],busy=false;\n';
  h += 'var GAP_SECONDS=30;\n';
  h += 'var drop=document.getElementById("drop");\n';
  h += 'drop.addEventListener("dragover",function(e){e.preventDefault();drop.classList.add("over")});\n';
  h += 'drop.addEventListener("dragleave",function(){drop.classList.remove("over")});\n';
  h += 'drop.addEventListener("drop",function(e){e.preventDefault();drop.classList.remove("over");handleFiles(e.dataTransfer.files)});\n';
  h += 'window.onload=function(){var k=localStorage.getItem("fa_ck"),e=localStorage.getItem("fa_ek");if(k)document.getElementById("apiKey").value=k;if(e)document.getElementById("ebayKey").value=e;if(k)setStatus("Keys loaded","")};\n';
  h += 'function setStatus(m,t){var s=document.getElementById("keyStatus");s.textContent=m;s.className="status"+(t?" "+t:"")}\n';
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
  h += '    setStatus("Claude API working! Ready to analyze books","")\n';
  h += '  })\n';
  h += '  .catch(function(err){setStatus("Failed: "+err.message,"err")})\n';
  h += '}\n';

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
  h += '  groups.forEach(function(g){items.push({id:Date.now()+Math.random(),files:g,urls:g.map(function(f){return URL.createObjectURL(f)}),mainIdx:0,status:"idle",title:"",author:"",bookTitle:"",format:"",language:"English",desc:"",genre:"",publisher:"",publicationYear:"",isbn:"",topic:"",price:10,min:5,max:20,avg:12})});\n';
  h += '  document.getElementById("statsWrap").style.display="block";\n';
  h += '  document.getElementById("gapInfo").textContent="Grouped "+imgs.length+" photos into "+groups.length+" books ("+GAP_SECONDS+"s gap rule)";\n';
  h += '  render();updateStats();toast("Grouped "+imgs.length+" photos into "+groups.length+" books!","")\n';
  h += '}\n';

  h += 'function setMain(id,idx){var item=items.find(function(i){return i.id==id});if(item){item.mainIdx=idx;refresh(item)}}\n';
  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(item,n){var d=document.createElement("div");d.className="card "+item.status;d.id="c"+item.id;d.innerHTML=cardHTML(item,n+1);g.appendChild(d)})}\n';

  h += 'function cardHTML(item,num){\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var b="<img class=\'main-img\' src=\'"+item.urls[mi]+"\' loading=\'lazy\'>";\n';
  h += '  b+="<div class=\'thumb-strip\'>";\n';
  h += '  item.urls.forEach(function(url,i){b+="<img class=\'thumb"+(i===mi?" main":"")+"\' src=\'"+url+"\' onclick=\'setMain("+item.id+","+i+")\'>"});\n';
  h += '  b+="</div><div class=\'card-body\'>";\n';
  h += '  b+="<div class=\'card-meta\'>Book #"+num+" &bull; "+item.files.length+" photo"+(item.files.length>1?"s":"")+" &bull; "+item.status+"</div>";\n';
  h += '  if(item.status==="processing"){b+="<div style=\'color:#7c6bff;padding:8px 0\'>Analyzing "+item.files.length+" photos...</div>";}\n';
  h += '  else if(item.status==="posting"){b+="<div style=\'color:#ffb800;padding:8px 0\'>Uploading & posting to eBay...</div>";}\n';
  h += '  else if(item.title){\n';
  h += '    b+="<div class=\'price-box\'>Avg $"+item.avg+" | $"+item.min+"-$"+item.max+"<br><span class=\'price-big\'>List: $"+item.price+"</span></div>";\n';
  h += '    b+="<div class=\'fl\'>Title</div><input class=\'ef\' value=\'"+esc(item.title)+"\' onchange=\'upd("+item.id+",\\"title\\",this.value)\'>";\n';
  h += '    b+="<div class=\'ef-row\'>";\n';
  h += '    b+="<div><div class=\'fl\'>Author</div><input class=\'ef\' value=\'"+esc(item.author)+"\' onchange=\'upd("+item.id+",\\"author\\",this.value)\'></div>";\n';
  h += '    b+="<div><div class=\'fl\'>Format</div><input class=\'ef\' value=\'"+esc(item.format)+"\' onchange=\'upd("+item.id+",\\"format\\",this.value)\'></div>";\n';
  h += '    b+="</div>";\n';
  h += '    b+="<div class=\'fl\'>Price</div><input class=\'ef\' type=\'number\' value=\'"+item.price+"\' onchange=\'upd("+item.id+",\\"price\\",this.value)\'>";\n';
  h += '    if(item.ebayId){b+="<a href=\'"+item.ebayUrl+"\' target=\'_blank\' class=\'btn btn-sm\' style=\'text-decoration:none;display:inline-block\'>&#10003; View on eBay</a>";}\n';
  h += '    else{b+="<div class=\'actions\'><button class=\'btn btn-sm btn-purple\' onclick=\'postOne("+item.id+")\'>Post to eBay</button><button class=\'btn btn-sm btn-outline\' onclick=\'analyzeOne("+item.id+")\'>Re-analyze</button></div>";}\n';
  h += '  }\n';
  h += '  else if(item.status==="error"){b+="<div style=\'color:#ff6b35;font-size:.78rem;margin:6px 0\'>"+(item.errorMsg||"Failed")+"</div><div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Retry</button></div>";}\n';
  h += '  else{b+="<div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Analyze</button></div>";}\n';
  h += '  b+="</div>";\n';
  h += '  return b\n';
  h += '}\n';

  h += 'function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}\n';
  h += 'function upd(id,f,v){var i=items.find(function(x){return x.id==id});if(i){i[f]=v;updateStats()}}\n';
  h += 'function clearAll(){items=[];render();document.getElementById("statsWrap").style.display="none";updateStats()}\n';
  h += 'function analyzeOne(id){var item=items.find(function(i){return i.id==id});if(item)doAnalyze(item).then(function(){refresh(item);updateStats()})}\n';

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
  h += '    document.getElementById("progLbl").textContent="Analyzing book "+(idx+1)+" of "+q.length+": "+item.files[0].name;\n';
  h += '    doAnalyze(item).then(function(){refresh(item);updateStats();idx++;next()})\n';
  h += '  }\n';
  h += '  next()\n';
  h += '}\n';

  h += 'function doAnalyze(item){\n';
  h += '  var k=localStorage.getItem("fa_ck");\n';
  h += '  if(!k){item.status="error";return Promise.resolve()}\n';
  h += '  item.status="processing";refresh(item);\n';
  h += '  var promises=item.files.map(function(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:file.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(file)})});\n';
  h += '  return Promise.all(promises).then(function(images){\n';
  h += '    return fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,images:images})})\n';
  h += '    .then(function(r){return r.json()})\n';
  h += '    .then(function(d){\n';
  h += '      if(d.error)throw new Error(d.error);\n';
  h += '      var t=(d.content||[]).map(function(c){return c.text||""}).join("");\n';
  h += '      var s=t.indexOf("{"),e=t.lastIndexOf("}");\n';
  h += '      var p=JSON.parse(t.slice(s,e+1));\n';
  h += '      item.title=p.title||"Book";item.author=p.author||"Unknown";item.bookTitle=p.bookTitle||p.title||"Book";\n';
  h += '      item.format=p.format||"";item.language=p.language||"English";\n';
  h += '      item.desc=p.description||"";item.min=p.minPrice||5;item.max=p.maxPrice||20;\n';
  h += '      item.avg=p.avgPrice||12;item.price=p.suggestedPrice||12;item.status="done"\n';
  h += '    })\n';
  h += '    .catch(function(err){item.status="error";item.errorMsg=err.message.substring(0,80);toast("Error: "+item.errorMsg,"err")})\n';
  h += '  })\n';
  h += '}\n';

  h += 'function refresh(item){var n=items.indexOf(item)+1;var c=document.getElementById("c"+item.id);if(c){c.className="card "+item.status;c.innerHTML=cardHTML(item,n)}}\n';

  h += 'var confirmCallback=null;\n';
  h += 'document.getElementById("confirmYes").onclick=function(){document.getElementById("confirmModal").style.display="none";if(confirmCallback)confirmCallback()};\n';
  h += 'document.getElementById("confirmNo").onclick=function(){document.getElementById("confirmModal").style.display="none";confirmCallback=null;toast("Cancelled","")};\n';

  h += 'function showConfirm(item,onConfirm){\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var n=items.indexOf(item)+1;\n';
  h += '  document.getElementById("confirmSub").textContent="Book #"+n+" of "+items.length+" — Is this the right book?";\n';
  h += '  document.getElementById("confirmMainImg").src=item.urls[mi];\n';
  h += '  document.getElementById("confirmTitle").textContent=item.title;\n';
  h += '  document.getElementById("confirmAuthor").textContent=item.author||"Unknown";\n';
  h += '  document.getElementById("confirmFormat").textContent=item.format||"Unknown";\n';
  h += '  document.getElementById("confirmPrice").textContent="$"+item.price;\n';
  h += '  document.getElementById("confirmPhotos").textContent=item.files.length+" photo(s) will be uploaded";\n';
  h += '  var thumbs=document.getElementById("confirmThumbs");thumbs.innerHTML="";\n';
  h += '  item.urls.forEach(function(url,i){var img=document.createElement("img");img.className="modal-thumb"+(i===mi?" sel":"");img.src=url;img.onclick=function(){document.getElementById("confirmMainImg").src=url;item.mainIdx=i;Array.from(thumbs.children).forEach(function(c){c.classList.remove("sel")});img.classList.add("sel")};thumbs.appendChild(img)});\n';
  h += '  confirmCallback=onConfirm;\n';
  h += '  document.getElementById("confirmModal").style.display="flex"\n';
  h += '}\n';

  h += 'function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;showConfirm(item,function(){doPost(item)})}\n';

  h += 'function doPost(item){\n';
  h += '  item.status="posting";refresh(item);\n';
  h += '  var mi=item.mainIdx||0;\n';
  h += '  var orderedFiles=[item.files[mi]].concat(item.files.filter(function(_,i){return i!==mi}));\n';
  h += '  var promises=orderedFiles.map(function(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:f.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(f)})});\n';
  h += '  Promise.all(promises).then(function(images){\n';
  h += '    return fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({\n';
  h += '      listing:{title:item.title,author:item.author,bookTitle:item.bookTitle,format:item.format,language:item.language,description:item.desc,genre:item.genre,publisher:item.publisher,publicationYear:item.publicationYear,isbn:item.isbn,topic:item.topic,price:item.price},images:images})})\n';
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
  h += '  function next(){\n';
  h += '    if(i>=ready.length){toast("All done posting!","");return}\n';
  h += '    var item=ready[i];\n';
  h += '    showConfirm(item,function(){doPost(item);i++;setTimeout(next,3500)});\n';
  h += '  }\n';
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
  h += '<\/script></body></html>';

  res.send(h);
});

app.listen(PORT, function() { console.log('FlipAI running on port ' + PORT); });
