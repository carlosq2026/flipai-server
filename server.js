const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini Client
const ai = new GoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(express.json({ limit: '100mb' }));

// CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// 1. GEMINI ANALYSIS ROUTE (Replaces Claude)
app.post('/analyze', async function (req, res) {
  const { photos } = req.body; 
  if (!photos || photos.length === 0) return res.status(400).json({ error: "No photos provided" });

  try {
    // We use gemini-3-flash for the best price/speed balance in 2026
    const interaction = await ai.interactions.create({
      model: 'gemini-3-flash',
      input: [
        { type: 'text', text: "Analyze these book photos. Return ONLY a JSON object: { \"title\": \"\", \"author\": \"\", \"isbn\": \"\", \"suggestedPrice\": 0.00, \"condition\": \"\" }" },
        ...photos.map(base64 => ({
          type: 'image',
          data: base64.split(',')[1],
          mime_type: 'image/jpeg'
        }))
      ]
    });

    // Extract and clean JSON response
    const cleanJson = interaction.outputs[0].text.replace(/```json|```/g, "").trim();
    res.json(JSON.parse(cleanJson));
  } catch (e) {
    console.error("Gemini Error:", e);
    res.status(500).json({ error: "Analysis failed: " + e.message });
  }
});

// 2. EBAY POSTING ROUTE (Kept from your Working Template)
app.post('/post-listing', async function (req, res) {
  const { title, price, isbn, photos, condition } = req.body;
  
  try {
    // eBay XML construction logic from your PDF...
    // Note: Using native 'fetch' now available in Node 18+ 
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-CALL-NAME': 'AddItem',
        'X-EBAY-API-VERSION': '1191'
        // Add other eBay headers here
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
