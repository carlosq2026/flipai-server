const express = require(‘express’);
const fetch = require(‘node-fetch’);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(function(req, res, next) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET,POST,OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);
if (req.method === ‘OPTIONS’) { res.status(200).end(); return; }
next();
});

app.use(express.json());

app.get(’/’, function(req, res) {
res.setHeader(‘Content-Type’, ‘text/html’);
var html = ‘<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlipAI</title>’;
html += ‘<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0f;color:#f0f0ff;font-family:monospace;padding:20px}’;
html += ‘.logo{font-size:2rem;font-weight:bold;color:#00e5a0;margin-bottom:20px}.section{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;padding:20px;margin-bottom:20px}’;
html += ‘label{display:block;font-size:0.75rem;color:#6b6b8a;text-transform:uppercase;margin-bottom:6px}’;
html += ‘input{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:8px;padding:10px;color:#f0f0ff;font-family:monospace;margin-bottom:12px;font-size:0.85rem}’;
html += ‘.btn{background:#00e5a0;color:#0a0a0f;border:none;border-radius:8px;padding:12px 24px;font-weight:bold;font-size:0.9rem;cursor:pointer;margin-right:10px;margin-bottom:10px}’;
html += ‘.btn-purple{background:#7c6bff;color:white}.btn-outline{background:transparent;color:#00e5a0;border:1px solid #00e5a0}’;
html += ‘.status{font-size:0.8rem;margin-top:8px;color:#00e5a0}.status.err{color:#ff6b35}’;
html += ‘.drop{border:2px dashed #2a2a3d;border-radius:12px;padding:40px;text-align:center;cursor:pointer;margin-bottom:20px;position:relative}’;
html += ‘.drop:hover{border-color:#00e5a0}.drop input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}’;
html += ‘.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}’;
html += ‘.card{background:#1a1a26;border:1px solid #2a2a3d;border-radius:12px;overflow:hidden}’;
html += ‘.card.done{border-color:#00e5a0}.card.error{border-color:#ff6b35}.card.processing{border-color:#7c6bff}’;
html += ‘.card img{width:100%;height:180px;object-fit:cover}.card-body{padding:14px}’;
html += ‘.price{background:#12121a;border-radius:8px;padding:10px;margin:10px 0;font-size:0.8rem}’;
html += ‘.price-big{color:#ffb800;font-size:1.1rem;font-weight:bold}’;
html += ‘.edit-field{width:100%;background:#12121a;border:1px solid #2a2a3d;border-radius:6px;padding:8px;color:#f0f0ff;font-family:monospace;font-size:0.8rem;margin-bottom:8px}’;
html += ‘.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9999}’;
html += ‘.toast{background:#1a1a26;border:1px solid #00e5a0;border-radius:8px;padding:12px 16px;margin-top:8px;font-size:0.85rem;max-width:280px}’;
html += ‘.toast.err{border-color:#ff6b35}</style></head><body>’;
html += ‘<div class="logo">FlipAI - Bookslayer Edition</div>’;
html += ‘<div class="section"><div style="font-size:0.8rem;color:#00e5a0;text-transform:uppercase;margin-bottom:14px">Step 1 - Enter Keys</div>’;
html += ‘<label>Claude API Key</label><input type="password" id="apiKey" placeholder="sk-ant-api03-...">’;
html += ‘<label>eBay App ID</label><input type="text" id="ebayKey" placeholder="ARLOWES-Bookslay-PRD-...">’;
html += ‘<button class="btn" onclick="verify()">Verify Keys</button>’;
html += ‘<div class="status" id="keyStatus"></div></div>’;
html += ‘<div class="drop" id="drop"><input type="file" accept="image/*" multiple onchange="handleFiles(this.files)">’;
html += ‘<div style="font-size:2rem">📦</div><div style="margin-top:10px;font-weight:bold">Drop photos here or tap to browse</div>’;
html += ‘<div style="font-size:0.8rem;color:#6b6b8a;margin-top:6px">Unlimited photos supported</div></div>’;
html += ‘<div id="controls" style="display:none;margin-bottom:20px">’;
html += ‘<button class="btn" onclick="analyzeAll()">Analyze All</button>’;
html += ‘<button class="btn btn-purple" onclick="postAll()">Post All to eBay</button>’;
html += ‘<button class="btn btn-outline" onclick="clearAll()">Clear</button></div>’;
html += ‘<div class="grid" id="grid"></div>’;
html += ‘<div class="toast-wrap" id="toasts"></div>’;
html += ‘<script>’;
html += ‘var items=[],busy=false;’;
html += ‘document.getElementById(“drop”).addEventListener(“dragover”,function(e){e.preventDefault()});’;
html += ‘document.getElementById(“drop”).addEventListener(“drop”,function(e){e.preventDefault();handleFiles(e.dataTransfer.files)});’;
html += ‘window.onload=function(){var k=localStorage.getItem(“fa_ck”),e=localStorage.getItem(“fa_ek”);if(k)document.getElementById(“apiKey”).value=k;if(e)document.getElementById(“ebayKey”).value=e;if(k)setStatus(“Keys loaded”,””)};’;
html += ‘function setStatus(m,t){var s=document.getElementById(“keyStatus”);s.textContent=m;s.className=“status”+(t?” “+t:””)}’;
html += ‘function verify(){var k=document.getElementById(“apiKey”).value.trim(),e=document.getElementById(“ebayKey”).value.trim();’;
html += ‘if(!k){setStatus(“Enter API key”,“err”);return}if(!k.startsWith(“sk-ant-”)){setStatus(“Key must start with sk-ant-”,“err”);return}’;
html += ‘setStatus(“Testing…”,””);’;
html += ‘fetch(“https://api.anthropic.com/v1/messages”,{method:“POST”,headers:{“Content-Type”:“application/json”,“x-api-key”:k,“anthropic-version”:“2023-06-01”},body:JSON.stringify({model:“claude-sonnet-4-20250514”,max_tokens:10,messages:[{role:“user”,content:“hi”}]})})’;
html += ‘.then(function(r){return r.json()}).then(function(d){if(d.error){setStatus(“Error: “+d.error.message,“err”);return}localStorage.setItem(“fa_ck”,k);if(e)localStorage.setItem(“fa_ek”,e);setStatus(“Claude API working! Server: “+window.location.origin,””)})’;
html += ‘.catch(function(err){setStatus(“Failed: “+err.message,“err”)})}’;
html += ‘function handleFiles(files){var imgs=Array.from(files).filter(function(f){return f.type.startsWith(“image/”)||/\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)});’;
html += ‘if(!imgs.length){toast(“No images found”,“err”);return}’;
html += ‘imgs.forEach(function(f){items.push({id:Date.now()+Math.random(),file:f,url:URL.createObjectURL(f),status:“idle”,title:””,desc:””,price:10,min:5,max:20,avg:12})});’;
html += ‘render();document.getElementById(“controls”).style.display=“block”}’;
html += ‘function render(){var g=document.getElementById(“grid”);g.innerHTML=””;items.forEach(function(item){var d=document.createElement(“div”);d.className=“card “+item.status;d.id=“c”+item.id;d.innerHTML=cardHTML(item);g.appendChild(d)})}’;
html += ‘function cardHTML(item){’;
html += ‘var body=”<img src=\””+item.url+”\” loading=\“lazy\”>”;’;
html += ‘body+=”<div class=\“card-body\”>”;’;
html += ‘if(item.status===“done”){body+=”<div class=\“price\”>Avg: $”+item.avg+” | Range: $”+item.min+”-$”+item.max+”<br><span class=\“price-big\”>Suggested: $”+item.price+”</span></div>”;’;
html += ‘body+=”<input class=\“edit-field\” value=\””+esc(item.title)+”\” onchange=\“upd(”+item.id+”,'title',this.value)\”>”;’;
html += ‘body+=”<textarea class=\“edit-field\” style=\“height:60px\” onchange=\“upd(”+item.id+”,'desc',this.value)\”>”+esc(item.desc)+”</textarea>”;’;
html += ‘body+=”<input class=\“edit-field\” type=\“number\” value=\””+item.price+”\” onchange=\“upd(”+item.id+”,'price',this.value)\”>”;’;
html += ‘if(item.ebayId){body+=”<a href=\””+item.ebayUrl+”\” target=\”_blank\” class=\“btn\” style=\“display:block;text-align:center;text-decoration:none;margin-top:8px\”>View on eBay</a>”;}’;
html += ‘else{body+=”<button class=\“btn btn-purple\” style=\“width:100%;margin-top:8px\” onclick=\“postOne(”+item.id+”)\”>Post to eBay</button>”;}}’;
html += ‘else if(item.status===“idle”){body+=”<div style=\“margin-top:10px\”><button class=\“btn\” onclick=\“analyzeOne(”+item.id+”)\”>Analyze</button></div>”;}’;
html += ‘else if(item.status===“processing”){body+=”<div style=\“margin-top:10px;color:#7c6bff\”>Analyzing…</div>”;}’;
html += ‘else if(item.status===“error”){body+=”<div style=\“margin-top:10px\”><button class=\“btn\” onclick=\“analyzeOne(”+item.id+”)\”>Retry</button></div>”;}’;
html += ‘body+=”</div>”;return body}’;
html += ‘function esc(s){return(s||””).replace(/&/g,”&”).replace(/</g,”<”).replace(/>/g,”>”).replace(/”/g,”"”)}’;
html += ‘function upd(id,f,v){var item=items.find(function(i){return i.id==id});if(item)item[f]=v}’;
html += ‘function clearAll(){items=[];render();document.getElementById(“controls”).style.display=“none”}’;
html += ‘function analyzeOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;doAnalyze(item).then(function(){refresh(item)})}’;
html += ‘function analyzeAll(){if(busy)return;var k=localStorage.getItem(“fa_ck”);if(!k){toast(“Verify API key first”,“err”);return}’;
html += ‘busy=true;var q=items.filter(function(i){return i.status===“idle”||i.status===“error”});var idx=0;’;
html += ‘function next(){if(idx>=q.length){busy=false;toast(“Done! “+q.length+” analyzed”,””);return}doAnalyze(q[idx]).then(function(){refresh(q[idx]);idx++;next()})}next()}’;
html += ‘function doAnalyze(item){var k=document.getElementById(“apiKey”).value.trim()||localStorage.getItem(“fa_ck”);’;
html += ‘if(!k){item.status=“error”;return Promise.resolve()}item.status=“processing”;refresh(item);’;
html += ‘return new Promise(function(resolve){new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result.split(”,”)[1])};r.onerror=rej;r.readAsDataURL(item.file)})’;
html += ‘.then(function(b64){return fetch(“https://api.anthropic.com/v1/messages”,{method:“POST”,headers:{“Content-Type”:“application/json”,“x-api-key”:k,“anthropic-version”:“2023-06-01”},body:JSON.stringify({model:“claude-sonnet-4-20250514”,max_tokens:500,messages:[{role:“user”,content:[{type:“image”,source:{type:“base64”,media_type:item.file.type||“image/jpeg”,data:b64}},{type:“text”,text:“Analyze this book for eBay. Reply ONLY with JSON: {title,description,minPrice,maxPrice,avgPrice,suggestedPrice}”}]}]})})})’;
html += ‘.then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error.message);var t=(d.content||[]).map(function(c){return c.text||””}).join(””);var s=t.indexOf(”{”),e=t.lastIndexOf(”}”);var p=JSON.parse(t.slice(s,e+1));item.title=p.title||“Book”;item.desc=p.description||””;item.min=p.minPrice||5;item.max=p.maxPrice||20;item.avg=p.avgPrice||12;item.price=p.suggestedPrice||12;item.status=“done”})’;
html += ‘.catch(function(err){item.status=“error”;toast(err.message.substring(0,60),“err”)}).then(resolve)})}’;
html += ‘function refresh(item){var c=document.getElementById(“c”+item.id);if(c){c.className=“card “+item.status;c.innerHTML=cardHTML(item)}}’;
html += ‘function postOne(id){var item=items.find(function(i){return i.id==id});if(!item)return;toast(“Posting to eBay…”,””);’;
html += ‘fetch(”/post-listing”,{method:“POST”,headers:{“Content-Type”:“application/json”},body:JSON.stringify({listing:{title:item.title,description:item.desc,price:item.price}})})’;
html += ‘.then(function(r){return r.json()}).then(function(d){if(d.success){item.ebayId=d.itemId;item.ebayUrl=d.url;toast(“Posted! #”+d.itemId,””);refresh(item)}else{toast(“eBay error: “+(d.message||“unknown”),“err”)}})’;
html += ‘.catch(function(err){toast(“Error: “+err.message,“err”)})}’;
html += ‘function postAll(){var ready=items.filter(function(i){return i.status===“done”&&!i.ebayId});if(!ready.length){toast(“Analyze items first”,“err”);return}var i=0;function next(){if(i>=ready.length)return;postOne(ready[i].id);i++;setTimeout(next,2000)}next()}’;
html += ‘function toast(msg,type){var w=document.getElementById(“toasts”),t=document.createElement(“div”);t.className=“toast”+(type?” “+type:””);t.textContent=msg;w.appendChild(t);setTimeout(function(){t.remove()},4000)}’;
html += ‘</script></body></html>’;
res.send(html);
});

app.post(’/post-listing’, async function(req, res) {
var listing = req.body.listing;
if (!listing) return res.status(400).json({ success: false, message: ‘No listing data’ });
var token = process.env.EBAY_USER_TOKEN;
var appId = process.env.EBAY_APP_ID;
var postal = process.env.POSTAL_CODE || ‘90001’;
if (!token) return res.status(500).json({ success: false, message: ‘EBAY_USER_TOKEN not set’ });
var xml = ‘<?xml version="1.0" encoding="utf-8"?><AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>’ + token + ‘</eBayAuthToken></RequesterCredentials><Item><Title>’ + esc(listing.title) + ‘</Title><Description><![CDATA[' + (listing.description || '') + ']]></Description><PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory><StartPrice>’ + listing.price + ‘</StartPrice><Country>US</Country><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><PostalCode>’ + postal + ‘</PostalCode><Quantity>1</Quantity><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>USPSMedia</ShippingService><ShippingServiceCost>3.99</ShippingServiceCost></ShippingServiceOptions></ShippingDetails><ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy><ConditionID>3000</ConditionID><Site>US</Site></Item></AddItemRequest>’;
try {
var r = await fetch(‘https://api.ebay.com/ws/api.dll’, { method: ‘POST’, headers: { ‘Content-Type’: ‘text/xml’, ‘X-EBAY-API-SITEID’: ‘0’, ‘X-EBAY-API-COMPATIBILITY-LEVEL’: ‘967’, ‘X-EBAY-API-CALL-NAME’: ‘AddItem’, ‘X-EBAY-API-APP-NAME’: appId || ‘’ }, body: xml });
var text = await r.text();
if (text.includes(’<Ack>Success</Ack>’) || text.includes(’<Ack>Warning</Ack>’)) {
var match = text.match(/<ItemID>(\d+)</ItemID>/);
var itemId = match ? match[1] : ‘unknown’;
res.json({ success: true, itemId: itemId, url: ‘https://www.ebay.com/itm/’ + itemId });
} else {
var err = text.match(/<LongMessage>(.*?)</LongMessage>/);
res.status(400).json({ success: false, message: err ? err[1] : ‘eBay rejected listing’ });
}
} catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

function esc(s) { return (s || ‘’).replace(/&/g, ‘&’).replace(/</g, ‘<’).replace(/>/g, ‘>’); }
app.listen(PORT, function() { console.log(’FlipAI running on port ’ + PORT); });
