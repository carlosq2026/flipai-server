const express = require('express');
const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Required for Gemini
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini (Ensure GEMINI_API_KEY is in your Railway Variables)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  next();
});

app.use(express.json({ limit: '100mb' }));

// ─── VERIFY KEYS ─────────────────────────────────────────────────────────────
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

// ─── ANALYZE OPTION 1: CLAUDE (Your Original Logic) ──────────────────────────
app.post('/analyze', async function(req, res) {
  var apiKey = req.body.apiKey;
  var images = req.body.images;
  if (!apiKey || !images || !images.length) return res.status(400).json({ error: 'Missing apiKey or images' });
  try {
    var imgContent = images.map(img => ({ 
        type: 'image', 
        source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data } 
    }));
    imgContent.push({ type: 'text', text: 'You are a professional book reseller... [Include your full prompt here] ...Reply ONLY with raw JSON.' });

    var r1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: imgContent }] })
    });
    const data = await r1.json();
    res.json({ content: data.content }); 
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ANALYZE OPTION 2: GEMINI (Cheaper Engine) ────────────────────────────────
app.post('/analyze-gemini', async function(req, res) {
  const { images } = req.body;
  if (!images || !images.length) return res.status(400).json({ error: 'Missing images' });
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = "Analyze these book photos for an eBay listing. Return ONLY raw JSON matching the format: {\"title\":\"...\",\"author\":\"...\",\"isbn\":\"...\",\"suggestedPrice\":10,\"condition\":\"Good\"}";
    const imageParts = images.map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType || "image/jpeg" }
    }));
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text().replace(/```json|```/g, "").trim();
    res.json({ content: [{ type: 'text', text: text }] });
  } catch (e) { res.status(500).json({ error: "Gemini Failed: " + e.message }); }
});

// ─── EBAY UPLOAD & LISTING LOGIC (Your Working Template) ──────────────────────
async function uploadPhotoToEbay(base64Data, mimeType, appId, token) {
  var boundary = 'FLIPAI_' + Date.now();
  var imgBuffer = Buffer.from(base64Data, 'base64');
  var ext = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  var xmlPayload = '<?xml version="1.0" encoding="utf-8"?><UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>' + token + '</eBayAuthToken></RequesterCredentials><PictureName>flipai_book</PictureName><PictureSet>Supersize</PictureSet></UploadSiteHostedPicturesRequest>';
  // ... [Keep your boundary/buffer logic exactly as provided in your original file]
}

app.post('/post-listing', async function(req, res) {
  // ... [Paste your existing /post-listing logic here]
});

app.listen(PORT, function() {
  console.log('FlipAI Bookslayer (Claude + Gemini) running on port ' + PORT);
});
