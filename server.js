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
    content.push({ type: 'text', text: 'Analyze these book photos for eBay resale. Reply ONLY with raw JSON, no markdown: {"title":"Full Title by Author","author":"Author Name","bookTitle":"Book Title Only","format":"Hardcover or Paperback or Trade Paperback","language":"English","description":"2-3 sentence description mentioning condition","minPrice":5,"maxPrice":25,"avgPrice":12,"suggestedPrice":10}' });
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
    if (listing.author) specifics += '<NameValueList><n>Author</n><Value>' + esc(listing.author) + '</Value></NameValueList>';
    if (listing.bookTitle) specifics += '<NameValueList><n>Book Title</n><Value>' + esc(listing.bookTitle) + '</Value></NameValueList>';
    if (listing.format) specifics += '<NameValueList><n>Format</n><Value>' + esc(listing.format) + '</Value></NameValueList>';
    specifics += '<NameValueList><n>Language</n><Value>' + esc(listing.language || 'English') + '</Value></NameValueList>';
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
  // Big drop zone
  h += '.drop{border:2px dashed #2a2a3d;border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;position:relative;background:#12121a;transition:all .2s;margin-bottom:20px}';
  h += '.drop:hover,.drop.over{border-color:#00e5a0;background:rgba(0,229,160,.03)}';
  h += '.drop input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}';
  h += '.drop-icon{font-size:3rem;margin-bottom:12px}';
  h += '.drop h2{font-size:1.3rem;font-weight:800;color:#f0f0ff;margin-bottom:8px;font-family:monospace}';
  h += '.drop p{color:#6b6b8a;font-size:0.85rem;line-height:1.6}';
  h += '.drop .tip{background:#1a1a26;border:1px solid #2a2a3d;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:0.78rem;color:#00e5a0;text-align:left}';
  // Stats bar
  h += '.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}';
  h += '.stat{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:14px;text-align:center}';
  h += '.stat-num{font-size:1.6rem;font-weight:800;color:#00e5a0;font-family:monospace}';
  h += '.stat-num.orange{color:#ff6b35}.stat-num.purple{color:#7c6bff}.stat-num.yellow{color:#ffb800}';
  h += '.stat-lbl{font-size:0.65rem;color:#6b6b8a;text-transform:uppercase;margin-top:4px}';
  // Progress
  h += '.prog-section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:10px;padding:16px;margin-bottom:20px}';
  h += '.prog-track{background:#12121a;border-radius:100px;height:8px;margin:10px 0;overflow:hidden}';
  h += '.prog-fill{height:100%;background:linear-gradient(90deg,#00e5a0,#7c6bff);border-radius:100px;transition:width .4s}';
  h += '.prog-lbl{font-size:0.78rem;color:#6b6b8a}';
  // Grid
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
  h += '.grouping-badge{background:#7c6bff;color:white;font-size:0.65rem;padding:2px 8px;border-radius:100px;font-weight:bold}';
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

  h += '<script>';
  h += 'var items=[],busy=false;';
  h += 'var GAP_SECONDS=5;'; // photos within 5s = same book
  h += 'var drop=document.getElementById("drop");';
  h += 'drop.addEventListener("dragover",function(e){e.preventDefault();drop.classList.add("over")});';
  h += 'drop.addEventListener("dragleave",function(){drop.classList.remove("over")});';
  h += 'drop.addEventListener("drop",function(e){e.preventDefault();drop.classList.remove("over");handleFiles(e.dataTransfer.files)});';
  h += 'window.onload=function(){var k=localStorage.getItem("fa_ck"),e=localStorage.getItem("fa_ek");if(k)document.getElementById("apiKey").value=k;if(e)document.getElementById("ebayKey").value=e;if(k)setStatus("Keys loaded","")};';
  h += 'function setStatus(m,t){var s=document.getElementById("keyStatus");s.textContent=m;s.className="status"+(t?" "+t:"")}';
  h += 'function verify(){var k=document.getElementById("apiKey").value.trim(),e=document.getElementById("ebayKey").value.trim();';
  h += 'if(!k){setStatus("Enter your Claude API key","err");return}setStatus("Testing...","");';
  h += 'fetch("/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k})})';
  h += '.then(function(r){return r.json()}).then(function(d){if(d.error){setStatus("Error: "+d.error,"err");return}';
  h += 'localStorage.setItem("fa_ck",k);if(e)localStorage.setItem("fa_ek",e);setStatus("Claude API working! Ready to analyze books","")})';
  h += '.catch(function(err){setStatus("Failed: "+err.message,"err")})}';

  // Core grouping logic — sort by lastModified, group by GAP_SECONDS gap
  h += 'function handleFiles(files){';
  h += 'var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});';
  h += 'if(!imgs.length){toast("No image files found","err");return}';
  h += 'imgs.sort(function(a,b){return a.lastModified-b.lastModified});';
  h += 'var groups=[],cur=[];';
  h += 'for(var i=0;i<imgs.length;i++){';
  h += '  if(cur.length===0){cur.push(imgs[i]);}';
  h += '  else{';
  h += '    var gap=(imgs[i].lastModified-imgs[i-1].lastModified)/1000;';
  h += '    if(gap<=GAP_SECONDS&&cur.length<9){cur.push(imgs[i]);}';
  h += '    else{groups.push(cur);cur=[imgs[i]];}';
  h += '  }';
  h += '}';
  h += 'if(cur.length)groups.push(cur);';
  h += 'groups.forEach(function(g){items.push({id:Date.now()+Math.random(),files:g,urls:g.map(function(f){return URL.createObjectURL(f)}),mainIdx:0,status:"idle",title:"",author:"",bookTitle:"",format:"",language:"English",desc:"",price:10,min:5,max:20,avg:12})});';
  h += 'document.getElementById("statsWrap").style.display="block";';
  h += 'document.getElementById("gapInfo").textContent="Grouped "+imgs.length+" photos into "+groups.length+" books ("+GAP_SECONDS+"s gap rule)";';
  h += 'render();updateStats();toast("Grouped "+imgs.length+" photos into "+groups.length+" books!","")}';

  h += 'function setMain(id,idx){var item=items.find(function(i){return i.id==id});if(item){item.mainIdx=idx;refresh(item)}}';
  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(item,n){var d=document.createElement("div");d.className="card "+item.status;d.id="c"+item.id;d.innerHTML=cardHTML(item,n+1);g.appendChild(d)})}';

  h += 'function cardHTML(item,num){';
  h += 'var mi=item.mainIdx||0;';
  h += 'var b="<img class=\'main-img\' src=\'"+item.urls[mi]+"\' loading=\'lazy\'>";';
  h += 'b+="<div class=\'thumb-strip\'>";';
  h += 'item.urls.forEach(function(url,i){b+="<img class=\'thumb"+(i===mi?" main":"")+"\' src=\'"+url+"\' onclick=\'setMain("+item.id+","+i+")\'>"});';
  h += 'b+="</div><div class=\'card-body\'>";';
  h += 'b+="<div class=\'card-meta\'>Book #"+num+" &bull; "+item.files.length+" photo"+(item.files.length>1?"s":"")+" &bull; "+item.status+"</div>";';
  h += 'if(item.status==="processing")b+="<div style=\'color:#7c6bff;padding:8px 0\'>Analyzing "+item.files.length+" photos...</div>";';
  h += 'else if(item.status==="posting")b+="<div style=\'color:#ffb800;padding:8px 0\'>Uploading & posting to eBay...</div>";';
  h += 'else if(item.title){';
  h += 'b+="<div class=\'price-box\'>Avg $"+item.avg+" | $"+item.min+"-$"+item.max+"<br><span class=\'price-big\'>List: $"+item.price+"</span></div>";';
  h += 'b+="<div class=\'fl\'>Title</div><input class=\'ef\' value=\'"+esc(item.title)+"\' onchange=\'upd("+item.id+",\\\"title\\\",this.value)\'>";';
  h += 'b+="<div class=\'ef-row\'><div><div class=\'fl\'>Author</div><input class=\'ef\' value=\'"+esc(item.author)+"\' onchange=\'upd("+item.id+",\\\"author\\\",this.value)\'></div>";';
  h += '<div><div class=\'fl\'>Format</div><input class=\'ef\' value=\'"+esc(item.format)+"\' onchange=\'upd("+item.id+",\\\"format\\\",this.value)\'></div></div>";';
  h += 'b+="<div class=\'fl\'>Price</div><input class=\'ef\' type=\'number\' value=\'"+item.price+"\' onchange=\'upd("+item.id+",\\\"price\\\",this.value)\'>";';
  h += 'if(item.ebayId){b+="<a href=\'"+item.ebayUrl+"\' target=\'_blank\' class=\'btn btn-sm\' style=\'text-decoration:none;display:inline-block\'>✓ View on eBay</a>";}';
  h += 'else{b+="<div class=\'actions\'><button class=\'btn btn-sm btn-purple\' onclick=\'postOne("+item.id+")\'>Post to eBay</button><button class=\'btn btn-sm btn-outline\' onclick=\'analyzeOne("+item.id+")\'>Re-analyze</button></div>";}}';
  h += 'else if(item.status==="error"){b+="<div style=\'color:#ff6b35;font-size:.78rem;margin:6px 0\'>"+(item.errorMsg||"Failed")+"</div><div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Retry</button></div>";}';
  h += 'else{b+="<div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Analyze</button></div>";}';
  h += 'b+="</div>";return b}';

  h += 'function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}';
  h += 'function upd(id,f,v){var i=items.find(function(x){return x.id==id});if(i){i[f]=v;updateStats()}}';
  h += 'function clearAll(){items=[];render();document.getElementById("statsWrap").style.display="none";updateStats()}';
  h += 'function analyzeOne(id){var item=items.find(function(i){return i.id==id});if(item)doAnalyze(item).then(function(){refresh(item);updateStats()})}';

  h += 'function analyzeAll(){if(busy)return;var k=localStorage.getItem("fa_ck");if(!k){toast("Verify API key first","err");return}';
  h += 'busy=true;var q=items.filter(function(i){return i.status==="idle"||i.status==="error"});if(!q.length){busy=false;toast("All analyzed!","");return}';
  h += 'var idx=0;document.getElementById("progSection").style.display="block";';
  h += 'function next(){if(idx>=q.length){busy=false;document.getElementById("progSection").style.display="none";toast("Done! "+q.length+" books analyzed","");updateStats();return}';
  h += 'var item=q[idx];';
  h += 'document.getElementById("progFill").style.width=Math.round(idx/q.length*100)+"%";';
  h += 'document.getElementById("progLbl").textContent="Analyzing book "+(idx+1)+" of "+q.length+": "+item.files[0].name;';
  h += 'doAnalyze(item).then(function(){refresh(item);updateStats();idx++;next()})}next()}';

  h += 'function doAnalyze(item){var k=localStorage.getItem("fa_ck");if(!k){item.status="error";return Promise.resolve()}';
  h += 'item.status="processing";refresh(item);';
  h += 'var promises=item.files.map(function(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:file.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(file)})});';
  h += 'return Promise.all(promises).then(function(images){';
  h += 'return fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,images:images})})';
  h += '.then(function(r){return r.json()}).then(function(d){';
  h += 'if(d.error)throw new Error(d.error);';
  h += 'var t=(d.content||[]).map(function(c){return c.text||""}).join("");';
  h += 'var s=t.indexOf("{"),e=t.lastIndexOf("}");var p=JSON.parse(t.slice(s,e+1));';
  h += 'item.title=p.title||"Book";item.author=p.author||"";item.bookTitle=p.bookTitle||"";';
  h += 'item.format=p.format||"";item.language=p.language||"English";';
  h += 'item.desc=p.description||"";item.min=p.minPrice||5;item.max=p.maxPrice||20;item.avg=p.avgPrice||12;item.price=p.suggestedPrice||12;item.status="done"})';
  h += '.catch(function(err){item.status="error";item.errorMsg=err.message.substring(0,80);toast("Error: "+item.errorMsg,"err")})})}';

  h += 'function refresh(item){var n=items.indexOf(item)+1;var c=document.getElementById("c"+item.id);if(c){c.className="card "+item.status;c.innerHTML=cardHTML(item,n)}}';

  h += 'function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;';
  h += 'item.status="posting";refresh(item);';
  h += 'var mi=item.mainIdx||0;';
  h += 'var orderedFiles=[item.files[mi]].concat(item.files.filter(function(_,i){return i!==mi}));';
  h += 'var promises=orderedFiles.map(function(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:f.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(f)})});';
  h += 'Promise.all(promises).then(function(images){';
  h += 'return fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({';
  h += 'listing:{title:item.title,author:item.author,bookTitle:item.bookTitle,format:item.format,language:item.language,description:item.desc,price:item.price},images:images})})';
  h += '.then(function(r){return r.json()}).then(function(d){';
  h += 'if(d.success){item.ebayId=d.itemId;item.ebayUrl=d.url;item.status="posted";toast("Posted! eBay #"+d.itemId,"");updateStats()}';
  h += 'else{item.status="done";toast("eBay: "+(d.message||"error").substring(0,80),"err")}})';
  h += '.catch(function(err){item.status="done";toast("Error: "+err.message,"err")})';
  h += '}).then(function(){refresh(item)})}';

  h += 'function postAll(){var ready=items.filter(function(i){return i.status==="done"&&!i.ebayId});if(!ready.length){toast("Analyze items first","err");return}';
  h += 'toast("Posting "+ready.length+" books to eBay...","");var i=0;function next(){if(i>=ready.length)return;postOne(ready[i].id);i++;setTimeout(next,3500)}next()}';

  h += 'function updateStats(){';
  h += 'var total=items.length,analyzed=items.filter(function(i){return i.status==="done"||i.status==="posted"}).length;';
  h += 'var posted=items.filter(function(i){return i.ebayId}).length;';
  h += 'var photos=items.reduce(function(s,i){return s+i.files.length},0);';
  h += 'var val=items.filter(function(i){return i.price}).reduce(function(s,i){return s+(parseFloat(i.price)||0)},0);';
  h += 'document.getElementById("sPhotos").textContent=photos;';
  h += 'document.getElementById("sBooks").textContent=total;';
  h += 'document.getElementById("sAnalyzed").textContent=analyzed;';
  h += 'document.getElementById("sValue").textContent="$"+Math.round(val).toLocaleString();';
  h += 'document.getElementById("sPosted").textContent=posted;}';

  h += 'function toast(msg,type){var w=document.getElementById("toasts"),t=document.createElement("div");t.className="toast"+(type?" "+type:"");t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},5000)}';
  h += '<\/script></body></html>';
  res.send(h);
});

app.listen(PORT, function() { console.log('FlipAI running on port ' + PORT); });
