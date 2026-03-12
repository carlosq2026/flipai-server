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

app.use(express.json({ limit: '20mb' }));

// Proxy Claude API calls to avoid browser CORS issues
app.post('/analyze', async function(req, res) {
  var apiKey = req.body.apiKey;
  var imageData = req.body.imageData;
  var mimeType = req.body.mimeType || 'image/jpeg';
  if (!apiKey || !imageData) return res.status(400).json({ error: 'Missing apiKey or imageData' });
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageData } },
          { type: 'text', text: 'Analyze this book for eBay resale. Reply ONLY with raw JSON, no markdown: {"title":"Full Title by Author","description":"2-3 sentence description","minPrice":5,"maxPrice":25,"avgPrice":12,"suggestedPrice":10}' }
        ]}]
      })
    });
    var data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Verify API key
app.post('/verify', async function(req, res) {
  var apiKey = req.body.apiKey;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
    });
    var data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Post to eBay
app.post('/post-listing', async function(req, res) {
  var listing = req.body.listing;
  if (!listing) return res.status(400).json({ success: false, message: 'No listing data' });
  var token = process.env.EBAY_USER_TOKEN;
  var appId = process.env.EBAY_APP_ID;
  var postal = process.env.POSTAL_CODE || '90001';
  if (!token) return res.status(500).json({ success: false, message: 'EBAY_USER_TOKEN not set' });
  var xml = '<?xml version="1.0" encoding="utf-8"?><AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials><Item><Title>' + esc(listing.title) + '</Title><Description><![CDATA[' + (listing.description || '') + ']]></Description><PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory><StartPrice>' + listing.price + '</StartPrice><Country>US</Country><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><PostalCode>' + postal + '</PostalCode><Quantity>1</Quantity><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>USPSMedia</ShippingService><ShippingServiceCost>3.99</ShippingServiceCost></ShippingServiceOptions></ShippingDetails><ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy><ConditionID>3000</ConditionID><Site>US</Site></Item></AddItemRequest>';
  try {
    var r = await fetch('https://api.ebay.com/ws/api.dll', { method: 'POST', headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'AddItem', 'X-EBAY-API-APP-NAME': appId || '' }, body: xml });
    var text = await r.text();
    if (text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>')) {
      var match = text.match(/<ItemID>(\d+)<\/ItemID>/);
      var itemId = match ? match[1] : 'unknown';
      res.json({ success: true, itemId: itemId, url: 'https://www.ebay.com/itm/' + itemId });
    } else {
      var err = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
      res.status(400).json({ success: false, message: err ? err[1] : 'eBay rejected listing' });
    }
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

app.get('/', function(req, res) {
  res.setHeader('Content-Type', 'text/html');
  var h = '';
  h += '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI</title>';
  h += '<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0f;color:#f0f0ff;font-family:monospace;padding:24px;max-width:1100px;margin:0 auto}';
  h += 'h1{font-size:1.8rem;font-weight:800;color:#00e5a0;margin-bottom:24px}';
  h += '.section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;padding:20px;margin-bottom:20px}';
  h += '.section h2{font-size:0.75rem;color:#00e5a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}';
  h += 'label{display:block;font-size:0.7rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:5px}';
  h += 'input{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px;color:#f0f0ff;font-family:monospace;margin-bottom:12px;font-size:0.85rem}';
  h += '.btn{background:#00e5a0;color:#0a0a0f;border:none;border-radius:8px;padding:11px 22px;font-weight:bold;font-size:0.85rem;cursor:pointer;margin-right:8px;margin-bottom:8px}';
  h += '.btn:hover{filter:brightness(1.1)}.btn:disabled{opacity:.4;cursor:not-allowed}';
  h += '.btn-purple{background:#7c6bff;color:white}.btn-outline{background:transparent;color:#00e5a0;border:1px solid #00e5a0}';
  h += '.status{font-size:0.8rem;margin-top:8px;color:#00e5a0;min-height:18px}.status.err{color:#ff6b35}';
  h += '.drop{border:2px dashed #2a2a3d;border-radius:12px;padding:40px;text-align:center;cursor:pointer;position:relative;background:#12121a;transition:border-color .2s}';
  h += '.drop:hover,.drop.over{border-color:#00e5a0}.drop input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}';
  h += '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:20px}';
  h += '.card{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;overflow:hidden}';
  h += '.card.done{border-color:#00e5a0}.card.error{border-color:#ff6b35}.card.processing{border-color:#7c6bff}';
  h += '.card img{width:100%;height:170px;object-fit:cover;display:block}';
  h += '.card-body{padding:14px}.card-title{font-weight:bold;font-size:0.9rem;margin-bottom:10px;line-height:1.3}';
  h += '.price-box{background:#12121a;border-radius:8px;padding:10px;margin-bottom:10px;font-size:0.78rem}';
  h += '.price-big{color:#ffb800;font-size:1rem;font-weight:bold}';
  h += '.ef{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:6px;padding:8px;color:#f0f0ff;font-family:monospace;font-size:0.78rem;margin-bottom:8px}';
  h += '.actions{display:flex;gap:8px;flex-wrap:wrap}.actions .btn{flex:1;padding:8px;font-size:0.78rem;margin:0}';
  h += '.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px}';
  h += '.toast{background:#1a1a26;border:1px solid #00e5a0;border-radius:8px;padding:12px 16px;font-size:0.82rem;max-width:280px}';
  h += '.toast.err{border-color:#ff6b35}.prog{background:#12121a;border-radius:100px;height:4px;margin:10px 0;overflow:hidden}';
  h += '.prog-bar{height:100%;background:linear-gradient(90deg,#00e5a0,#7c6bff);border-radius:100px;transition:width .3s}';
  h += '</style></head><body>';
  h += '<h1>FlipAI - Bookslayer Edition</h1>';
  h += '<div class="section"><h2>Step 1 - Enter Keys</h2>';
  h += '<label>Claude API Key</label><input type="password" id="apiKey" placeholder="sk-ant-api03-...">';
  h += '<label>eBay App ID</label><input type="text" id="ebayKey" placeholder="ARLOWES-Bookslay-PRD-...">';
  h += '<button class="btn" onclick="verify()">Verify Keys</button>';
  h += '<div class="status" id="keyStatus"></div></div>';
  h += '<div class="drop" id="drop"><input type="file" accept="image/*" multiple onchange="handleFiles(this.files)">';
  h += '<div style="font-size:2rem">📦</div><div style="margin-top:10px;font-size:1.1rem;font-weight:bold">Drop book photos here or click to browse</div>';
  h += '<div style="font-size:0.8rem;color:#6b6b8a;margin-top:6px">Supports unlimited photos - JPG, PNG, HEIC</div></div>';
  h += '<div id="controls" style="display:none;margin-top:16px">';
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
  h += 'function verify(){';
  h += 'var k=document.getElementById("apiKey").value.trim();';
  h += 'var e=document.getElementById("ebayKey").value.trim();';
  h += 'if(!k){setStatus("Enter your Claude API key","err");return}';
  h += 'setStatus("Testing...","");';
  h += 'fetch("/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k})})';
  h += '.then(function(r){return r.json()}).then(function(d){';
  h += 'if(d.error){setStatus("Error: "+d.error,"err");return}';
  h += 'localStorage.setItem("fa_ck",k);if(e)localStorage.setItem("fa_ek",e);';
  h += 'setStatus("Claude API working! Ready to analyze books","")})';
  h += '.catch(function(err){setStatus("Failed: "+err.message,"err")})}';
  h += 'function handleFiles(files){';
  h += 'var imgs=Array.from(files).filter(function(f){return f.type.startsWith("image/")||/\\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});';
  h += 'if(!imgs.length){toast("No image files found","err");return}';
  h += 'imgs.forEach(function(f){items.push({id:Date.now()+Math.random(),file:f,url:URL.createObjectURL(f),status:"idle",title:"",desc:"",price:10,min:5,max:20,avg:12})});';
  h += 'render();document.getElementById("controls").style.display="block";toast(imgs.length+" photos loaded!","")}';
  h += 'function render(){var g=document.getElementById("grid");g.innerHTML="";items.forEach(function(item){var d=document.createElement("div");d.className="card "+item.status;d.id="c"+item.id;d.innerHTML=cardHTML(item);g.appendChild(d)})}';
  h += 'function cardHTML(item){';
  h += 'var b="<img src=\'"+item.url+"\' loading=\'lazy\'><div class=\'card-body\'>";';
  h += 'if(item.status==="processing")b+="<div style=\'color:#7c6bff;padding:10px 0\'>Analyzing...</div>";';
  h += 'else if(item.status==="done"){';
  h += 'b+="<div class=\'card-title\'>"+esc(item.title)+"</div>";';
  h += 'b+="<div class=\'price-box\'>Avg $"+item.avg+" | Range $"+item.min+"-$"+item.max+"<br><span class=\'price-big\'>List at: $"+item.price+"</span></div>";';
  h += 'b+="<input class=\'ef\' value=\'"+esc(item.title)+"\' onchange=\'upd("+item.id+",\\\"title\\\",this.value)\'>";';
  h += 'b+="<textarea class=\'ef\' style=\'height:55px\' onchange=\'upd("+item.id+",\\\"desc\\\",this.value)\'>"+esc(item.desc)+"</textarea>";';
  h += 'b+="<input class=\'ef\' type=\'number\' value=\'"+item.price+"\' onchange=\'upd("+item.id+",\\\"price\\\",this.value)\'>";';
  h += 'if(item.ebayId)b+="<a href=\'"+item.ebayUrl+"\' target=\'_blank\' class=\'btn\' style=\'display:block;text-align:center;text-decoration:none;margin-top:8px\'>View on eBay</a>";';
  h += 'else b+="<div class=\'actions\'><button class=\'btn btn-purple\' onclick=\'postOne("+item.id+")\'>Post to eBay</button></div>";}';
  h += 'else if(item.status==="error")b+="<div style=\'color:#ff6b35;margin-top:10px;font-size:.8rem\'>Failed</div><div class=\'actions\'><button class=\'btn\' onclick=\'analyzeOne("+item.id+")\'>Retry</button></div>";';
  h += 'else b+="<div style=\'color:#6b6b8a;font-size:.8rem;margin-top:10px\'>"+item.file.name+"</div><div class=\'actions\'><button class=\'btn\' onclick=\'analyzeOne("+item.id+")\'>Analyze</button></div>";';
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
  h += 'document.getElementById("progLbl").textContent="Analyzing "+item.file.name+" ("+idx+"/"+q.length+")";';
  h += 'doAnalyze(item).then(function(){refresh(item);idx++;next()})}next()}';
  h += 'function doAnalyze(item){var k=localStorage.getItem("fa_ck");if(!k){item.status="error";return Promise.resolve()}';
  h += 'item.status="processing";refresh(item);';
  h += 'return new Promise(function(resolve){';
  h += 'var reader=new FileReader();reader.onload=function(){';
  h += 'var b64=reader.result.split(",")[1];';
  h += 'fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:k,imageData:b64,mimeType:item.file.type||"image/jpeg"})})';
  h += '.then(function(r){return r.json()}).then(function(d){';
  h += 'if(d.error)throw new Error(d.error);';
  h += 'var t=(d.content||[]).map(function(c){return c.text||""}).join("");';
  h += 'var s=t.indexOf("{"),e=t.lastIndexOf("}");var p=JSON.parse(t.slice(s,e+1));';
  h += 'item.title=p.title||"Book";item.desc=p.description||"";item.min=p.minPrice||5;item.max=p.maxPrice||20;item.avg=p.avgPrice||12;item.price=p.suggestedPrice||12;item.status="done"})';
  h += '.catch(function(err){item.status="error";toast(err.message.substring(0,60),"err")}).then(resolve)};';
  h += 'reader.readAsDataURL(item.file)})}';
  h += 'function refresh(item){var c=document.getElementById("c"+item.id);if(c){c.className="card "+item.status;c.innerHTML=cardHTML(item)}}';
  h += 'function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;toast("Posting to eBay...","");';
  h += 'fetch("/post-listing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({listing:{title:item.title,description:item.desc,price:item.price}})})';
  h += '.then(function(r){return r.json()}).then(function(d){if(d.success){item.ebayId=d.itemId;item.ebayUrl=d.url;toast("Posted! eBay #"+d.itemId,"");refresh(item)}else{toast("eBay: "+(d.message||"error"),"err")}})';
  h += '.catch(function(err){toast("Error: "+err.message,"err")})}';
  h += 'function postAll(){var ready=items.filter(function(i){return i.status==="done"&&!i.ebayId});if(!ready.length){toast("Analyze items first","err");return}';
  h += 'toast("Posting "+ready.length+" items...","");var i=0;function next(){if(i>=ready.length)return;postOne(ready[i].id);i++;setTimeout(next,2000)}next()}';
  h += 'function toast(msg,type){var w=document.getElementById("toasts"),t=document.createElement("div");t.className="toast"+(type?" "+type:"");t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},4000)}';
  h += '<\/script></body></html>';
  res.send(h);
});

app.listen(PORT, function() { console.log('FlipAI running on port ' + PORT); });
