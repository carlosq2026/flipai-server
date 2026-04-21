const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting server initialization...');
console.log('GEMINI_API_KEY present:', !!process.env.GEMINI_API_KEY);

let ai;
try {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  console.log('GoogleGenerativeAI module loaded');
  ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  console.log('GoogleGenerativeAI client initialized');
} catch (e) {
  console.error('Failed to initialize GoogleGenerativeAI:', e.message);
  process.exit(1);
}

app.use(express.json({ limit: '100mb' }));

// CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'FlipAI Bookslayer' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 1. GEMINI ANALYSIS ROUTE
app.post('/analyze', async function (req, res) {
  const { photos } = req.body; 
  if (!photos || photos.length === 0) return res.status(400).json({ error: "No photos provided" });

  try {
    const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const response = await model.generateContent([
      "Analyze these book photos. Return ONLY a JSON object: { \"title\": \"\", \"author\": \"\", \"isbn\": \"\", \"suggestedPrice\": 0.00, \"condition\": \"\" }",
      ...photos.map(base64 => ({
        inlineData: {
          data: base64.split(',')[1],
          mimeType: 'image/jpeg'
        }
      }))
    ]);

    const cleanJson = response.response.text().replace(/```json|```/g, "").trim();
    res.json(JSON.parse(cleanJson));
  } catch (e) {
    console.error("Gemini Error:", e);
    res.status(500).json({ error: "Analysis failed: " + e.message });
  }
});

// 2. EBAY POSTING ROUTE
app.post('/post-listing', async function (req, res) {
  const { title, price, isbn, photos, condition } = req.body;
  
  try {
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-CALL-NAME': 'AddItem',
        'X-EBAY-API-VERSION': '1191'
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
             <AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
               <Item>
                 <Title>${title}</Title>
                 <StartPrice>${price}</StartPrice>
                 <ConditionID>3000</ConditionID>
                 <PrimaryCategory><CategoryID>267</CategoryID></PrimaryCategory>
               </Item>
               <RequesterCredentials><eBayAuthToken>${process.env.EBAY_USER_TOKEN}</eBayAuthToken></RequesterCredentials>
             </AddItemRequest>`
    });
    
    const result = await response.text();
    res.json({ status: "success", detail: "Book posted to eBay" });
  } catch (e) {
    res.status(500).json({ error: "eBay Post Failed: " + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`FlipAI Bookslayer (Gemini Edition) running on port ${PORT}`);
});
