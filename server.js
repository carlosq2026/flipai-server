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

app.use(express.json({ limit: '50mb' }));

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
  var imageData = req.body.imageData;
  var imageMime = req.body.imageMime || 'image/jpeg';
  if (!listing) return res.status(400).json({ success: false, message: 'No listing data' });
  var token = process.env.EBAY_USER_TOKEN;
  var appId = process.env.EBAY_APP_ID;
  var postal = process.env.POSTAL_CODE || '14701';
  if (!token) return res.status(500).json({ success: false, message: 'EBAY_USER_TOKEN not set' });

  try {
    var pictureXml = '';
    if (imageData) {
      try {
        var photoUrl = await uploadPhotoToEbay(imageData, imageMime, appId, token);
        pictureXml = '<PictureDetails><PictureURL>' + photoUrl + '</PictureURL></PictureDetails>';
      } catch(pe) {
        console.log('Photo upload failed, continuing without photo:', pe.message);
      }
    }

    // Build item specifics - author, book title, format, language
    var specifics = '';
    if (listing.author) specifics += '<NameValueList><Name>Author</Name><Value>' + esc(listing.author) + '</Value></NameValueList>';
    if (listing.bookTitle) specifics += '<NameValueList><Name>Book Title</Name><Value>' + esc(listing.bookTitle) + '</Value></NameValueList>';
    if (listing.format) specifics += '<NameValueList><Name>Format</Name><Value>' + esc(listing.format) + '</Value></NameValueList>';
    specifics += '<NameValueList><Name>Language</Name><Value>' + esc(listing.language || 'English') + '</Value></NameValueList>';
    var itemSpecificsXml = specifics ? '<ItemSpecifics>' + specifics + '</ItemSpecifics>' : '';

    var xml = '<?xml version="1.0" encoding="utf-8"?><AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials><Item>' +
      '<Title>' + esc(listing.title) + '</Title>' +
      '<Description><![CDATA[' + (listing.description || '') + ']]></Description>' +
      pictureXml +
      itemSpecificsXml +
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
      '<ConditionID>3000</ConditionID>' +
      '<Site>US</Site>' +
      '</Item></AddItemRequest>';

    var r = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'AddItem', 'X-EBAY-API-APP-NAME': appId || '' },
      body: xml
    });
    var text = await r.text();
    if (text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>')) {
      var match = text.match(/<ItemID>(\d+)<\/ItemID>/);
      var itemId = match ? match[1] : 'unknown';
      res.json({ success: true, itemId: itemId, url: 'https://www.ebay.com/itm/' + itemId });
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
  h += '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI</title>';
  h += '<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0f;color:#f0f0ff;font-family:monospace;padding:24px;max-width:1200px;margin:0 auto}';
  h += 'h1{font-size:1.8rem;font-weight:800;color:#00e5a0;margin-bottom:24px}';
  h += '.section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;padding:20px;margin-bottom:20px}';
  h += '.section h2{font-size:0.75rem;color:#00e5a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}';
  h += 'label{display:block;font-size:0.7rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:5px}';
  h += 'input{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px;color:#f0f0ff;font-family:monospace;margin-bottom:12px;font-size:0.85rem}';
  h += '.btn{background:#00e5a0;color:#0a0a0f;border:none;border-radius:8px;padding:11px 22px;font-weight:bold;font-size:0.85rem;cursor:pointer;margin-right:8px;margin-bottom:8px}';
  h += '.btn:hover{filter:brightness(1.1)}.btn-purple{background:#7c6bff;color:white}.btn-outline{background:transparent;color:#00e5a0;border:1px solid #00e5a0}';
  h += '.btn-sm{padding:6px 12px;font-size:0.75rem}';
  h += '.status{font-size:0.8rem;margin-top:8px;color:#00e5a0;min-height:18px}.status.err{color:#ff6b35}';
  h += '.drop{border:2px dashed #2a2a3d;border-radius:12px;padding:40px;text-align:center;cursor:pointer;position:relative;background:#12121a;transition:border-color .2s;margin-bottom:16px}';
  h += '.drop:hover,.drop.over{border-color:#00e5a0}.drop input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}';
  h += '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;margin-top:20px}';
  h += '.card{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;overflow:hidden}';
  h += '.card.done{border-color:#00e5a0}.card.error{border-color:#ff6b35}.card.processing{border-color:#7c6bff}.card.posting{border-color:#ffb800}';
  h += '.thumb-strip{display:flex;gap:4px;padding:8px;background:#12121a;flex-wrap:wrap}';
  h += '.thumb{width:56px;height:56px;object-fit:cover;border-radius:6px;border:2px solid #2a2a3d;cursor:pointer}';
  h += '.thumb.main{border-color:#00e5a0}.main-img{width:100%;height:175px;object-fit:cover;display:block}';
  h += '.add-photo{width:56px;height:56px;border-radius:6px;border:2px dashed #2a2a3d;background:transparent;color:#6b6b8a;font-size:1.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}';
  h += '.add-photo input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}';
  h += '.card-body{padding:14px}';
  h += '.price-box{background:#12121a;border-radius:8px;padding:10px;margin-bottom:10px;font-size:0.78rem}';
  h += '.price-big{color:#ffb800;font-size:1rem;font-weight:bold}';
  h += '.ef{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:6px;padding:8px;color:#f0f0ff;font-family:monospace;font-size:0.78rem;margin-bottom:6px}';
  h += '.ef-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}';
  h += '.field-label{font-size:0.65rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:3px}';
  h += '.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}';
  h += '.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px}';
  h += '.toast{background:#1a1a26;border:1px solid #00e5a0;border-radius:8px;padding:12px 16px;font-size:0.82rem;max-width:300px}';
  h += '.toast.err{border-color:#ff6b35}.prog{background:#12121a;border-radius:100px;height:4px;margin:10px 0;overflow:hidden}';
  h += '.prog-bar{height:100%;background:linear-gradient(90deg,#00e5a0,#7c6bff);border-radius:100px;transition:width .3s}';
  h += '.meta{font-size:0.7rem;color:#6b6b8a;margin-bottom:8px}';
  h += '</style></head><body>';
  h += '<h1>FlipAI - Bookslayer Edition</h1>';
  h += '<div class="section"><h2>Step 1 - Enter Keys</h2>';
  h += '<label>Claude API Key</label><input type="password" id="apiKey" placeholder="sk-ant-api03-...">';
  h += '<label>eBay App ID</label><input type="text" id="ebayKey" placeholder="ARLOWES-Bookslay-PRD-...">';
  h += '<button class="btn" onclick="verify()">Verify Keys</button>';
  h += '<div class="status" id="keyStatus"></div></div>';
  h += '<div class="drop" id="drop"><input type="file" accept="image/*" multiple onchange="handleFiles(this.files)">';
  h += '<div style="font-size:2rem">📦</div>';
  h += '<div style="margin-top:10px;font-size:1.1rem;font-weight:bold">Drop book photos here or click to browse</div>';
  h += '<div style="font-size:0.8rem;color:#6b6b8a;margin-top:6px">Each photo = one book. Add extra photos per card for better analysis.</div></div>';
  h += '<div id="controls" style="display:none;margin-bottom:4px">';
  h += '<button class="btn" onclick="analyzeAll()">Analyze All</button>';
  h += '<button class="btn btn-purple" onclick="postAll()">Post All to eBay</button>';
  h += '<button class="btn btn-outline" onclick="clearAll()">Clear All</button>';
  h += '<div class="prog" id="progWrap" style="display:none"><div class="prog-bar" id="progBar" style="width:0%"></div></div>';
  h += '<div style="font-size:0.75rem;color:#6b6b8a;margin-top:4px" id="progLbl"></div></div>';
  h += '<div class="grid" id="grid"></div>';
  h += '<div class="toast-wrap" id="toasts"></div>';
  h += '<script>';
  h += 'var items=[],busy=false;';
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
  h += 'function handleFiles(files){';
  h += 'var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});';
  h += 'if(!imgs.length){toast("No image files found","err");return}';
  h += 'imgs.forEach(function(f){items.push({id:Date.now()+Math.random(),files:[f],urls:[URL.createObjectURL(f)],mainIdx:0,status:"idle",title:"",author:"",bookTitle:"",format:"",language:"English",desc:"",price:10,min:5,max:20,avg:12})});';
  h += 'render();document.getElementById("controls").style.display="block";toast(imgs.length+" photos loaded!","")}';
  h += 'function addPhotos(id,files){var item=items.find(function(i){return i.id==id});if(!item)return;';
  h += 'var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});';
  h += 'imgs.forEach(function(f){item.files.push(f);item.urls.push(URL.createObjectURL(f))});';
  h += 'if(item.status==="done")item.status="idle";refresh(item);toast(imgs.length+" photo(s) added","")}';
  h += 'function setMain(id,idx){var item=items.find(function(i){return i.id==id});if(item){item.mainIdx=idx;refresh(item)}}';
  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(item){var d=document.createElement("div");d.className="card "+item.status;d.id="c"+item.id;d.innerHTML=cardHTML(item);g.appendChild(d)})}';
  h += 'function cardHTML(item){';
  h += 'var mi=item.mainIdx||0;';
  h += 'var b="<img class=\'main-img\' src=\'"+item.urls[mi]+"\' loading=\'lazy\'>";';
  h += 'b+="<div class=\'thumb-strip\'>";';
  h += 'item.urls.forEach(function(url,i){b+="<img class=\'thumb"+(i===mi?" main":"")+"\' src=\'"+url+"\' onclick=\'setMain("+item.id+","+i+")\' title=\'Set as eBay photo\'>"});';
  h += 'b+="<div class=\'add-photo\'><input type=\'file\' accept=\'image/*\' multiple onchange=\'addPhotos("+item.id+",this.files)\'>+</div>";';
  h += 'b+="</div><div class=\'card-body\'>";';
  h += 'b+="<div class=\'meta\'>"+item.files.length+" photo"+(item.files.length>1?"s":"")+' + '" | "+item.status+"</div>";';
  h += 'if(item.status==="processing")b+="<div style=\'color:#7c6bff;padding:10px 0\'>Analyzing "+item.files.length+" photo(s)...</div>";';
  h += 'else if(item.status==="posting")b+="<div style=\'color:#ffb800;padding:10px 0\'>Uploading photo & posting to eBay...</div>";';
  h += 'else if(item.status==="done"||item.status==="idle"){';
  h += 'if(item.title){';
  h += 'b+="<div class=\'price-box\'>Avg $"+item.avg+" | Range $"+item.min+"-$"+item.max+"<br><span class=\'price-big\'>List at: $"+item.price+"</span></div>";';
  h += 'b+="<div class=\'field-label\'>Title</div><input class=\'ef\' value=\'"+esc(item.title)+"\' onchange=\'upd("+item.id+",\\\"title\\\",this.value)\'>";';
  h += 'b+="<div class=\'ef-row\'>";';
  h += 'b+="<div><div class=\'field-label\'>Author</div><input class=\'ef\' value=\'"+esc(item.author)+"\' onchange=\'upd("+item.id+",\\\"author\\\",this.value)\'></div>";';
  h += 'b+="<div><div class=\'field-label\'>Format</div><input class=\'ef\' value=\'"+esc(item.format)+"\' onchange=\'upd("+item.id+",\\\"format\\\",this.value)\'></div>";';
  h += 'b+="</div>";';
  h += 'b+="<div class=\'field-label\'>Description</div><textarea class=\'ef\' style=\'height:55px\' onchange=\'upd("+item.id+",\\\"desc\\\",this.value)\'>"+esc(item.desc)+"</textarea>";';
  h += 'b+="<div class=\'field-label\'>Price ($)</div><input class=\'ef\' type=\'number\' value=\'"+item.price+"\' onchange=\'upd("+item.id+",\\\"price\\\",this.value)\'>";';
  h += 'if(item.ebayId){b+="<a href=\'"+item.ebayUrl+"\' target=\'_blank\' class=\'btn btn-sm\' style=\'display:inline-block;text-decoration:none;\'>View on eBay ✓</a>";}';
  h += 'else{b+="<div class=\'actions\'><button class=\'btn btn-sm btn-purple\' onclick=\'postOne("+item.id+")\'>Post to eBay</button><button class=\'btn btn-sm btn-outline\' onclick=\'analyzeOne("+item.id+")\'>Re-analyze</button></div>";}}';
  h += 'else{b+="<div style=\'color:#6b6b8a;font-size:.8rem;margin:8px 0\'>"+(item.files.length>1?"Ready: "+item.files.length+" photos":item.files[0].name)+"</div><div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Analyze</button></div>";}}';
  h += 'else if(item.status==="error"){b+="<div style=\'color:#ff6b35;font-size:.8rem;margin:8px 0\'>"+(item.errorMsg||"Failed")+"</div><div class=\'actions\'><button class=\'btn btn-sm\' onclick=\'analyzeOne("+item.id+")\'>Retry</button></div>";}';
  h += 'b+="</div>";return b}';
  h += 'function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}';
  h += 'function upd(id,f,v){var i=items.find(function(x){return x.id==id});if(i)i[f]=v}';
  h += 'function clearAll(){items=[];render();document.getElementById("controls").style.display="none"}';
  h += 'function analyzeOne(id){var item=items.find(function(i){return i.id==id});if(item)doAnalyze(item).then(function(){refresh(item)})}';
  h += 'function analyzeAll(){if(busy)return;var k=localStorage.getItem("fa_ck");if(!k){toast("Verify API key first","err");return}';
  h += 'busy=true;var q=items.filter(function(i){return i.status==="idle"||i.status==="error"});if(!q.length){busy=false;toast("All done!","");return}';
  h += 'var idx=0;document.getElementById("progWrap").style.display="block";';
  h += 'function next(){if(idx>=q.length){busy=false;document.getElementById("progWrap").style.display="none";toast("Done! "+q.length+" analyzed","");return}';
  h += 'var item=q[idx];document.getElementById("progBar").style.width=Math.round(idx/q.length*100)+"%";';
  h += 'document.getElementById("progLbl").textContent="Analyzing "+(idx+1)+"/"+q.length+" ("+item.files.length+" photo"+(item.files.length>1?"s":"")+")";';
  h += 'doAnalyze(item).then(function(){refresh(item);idx++;next()})}next()}';
  h += 'function doAnalyze(item){var k=localStorage.getItem("fa_ck");if(!k){item.status="error";return Promise.resolve()}';
  h += 'item.status="processing";refresh(item);';
  h += 'var promises=item.files.map(function(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res({data:r.result.split(",")[1],mimeType:file.type||"image/jpeg"})};r.onerror=rej;r.readAsDataURL(file)})});';
  h += 'return Promise.all(promises).then(function(images){';
  h += 'return fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,images:images})})';
  h += '.then(function(r){return r.json()}).then(function(d){';
  h += 'if(d.error)throw new Error(d.error);';
  h += 'var t=(d.content||[]).map(function(c){return c.text||""}).join("");';
  h += 'var s=t.indexOf("{"),e=t.lastIndexOf("}");var p=JSON.parse(t.slice(s,e+1));';
  h += 'item.title=p.title||"Book";item.author=p.author||"";item.bookTitle=p.bookTitle||p.title||"";';
  h += 'item.format=p.format||"";item.language=p.language||"English";';
  h += 'item.desc=p.description||"";item.min=p.minPrice||5;item.max=p.maxPrice||20;item.avg=p.avgPrice||12;item.price=p.suggestedPrice||12;item.status="done"})';
  h += '.catch(function(err){item.status="error";item.errorMsg=err.message.substring(0,80);toast(item.errorMsg,"err")})})}';
  h += 'function refresh(item){var c=document.getElementById("c"+item.id);if(c){c.className="card "+item.status;c.innerHTML=cardHTML(item)}}';
  h += 'function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;';
  h += 'item.status="posting";refresh(item);';
  h += 'var mainFile=item.files[item.mainIdx||0];';
  h += 'var reader=new FileReader();';
  h += 'reader.onload=function(){var b64=reader.result.split(",")[1];';
  h += 'fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({';
  h += 'listing:{title:item.title,author:item.author,bookTitle:item.bookTitle,format:item.format,language:item.language,description:item.desc,price:item.price},';
  h += 'imageData:b64,imageMime:mainFile.type||"image/jpeg"})})';
  h += '.then(function(r){return r.json()}).then(function(d){';
  h += 'if(d.success){item.ebayId=d.itemId;item.ebayUrl=d.url;item.status="done";toast("Posted! eBay #"+d.itemId,"");refresh(item)}';
  h += 'else{item.status="done";toast("eBay: "+(d.message||"error").substring(0,80),"err");refresh(item)}})';
  h += '.catch(function(err){item.status="done";toast("Error: "+err.message,"err");refresh(item)})};';
  h += 'reader.readAsDataURL(mainFile)}';
  h += 'function postAll(){var ready=items.filter(function(i){return i.status==="done"&&!i.ebayId});if(!ready.length){toast("Analyze items first","err");return}';
  h += 'toast("Posting "+ready.length+" items...","");var i=0;function next(){if(i>=ready.length)return;postOne(ready[i].id);i++;setTimeout(next,3000)}next()}';
  h += 'function toast(msg,type){var w=document.getElementById("toasts"),t=document.createElement("div");t.className="toast"+(type?" "+type:"");t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},5000)}';
  h += '<\/script></body></html>';
  res.send(h);
});

app.listen(PORT, function() { console.log('FlipAI running on port ' + PORT); });
