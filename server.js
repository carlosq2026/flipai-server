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

// Root endpoint - serve HTML UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>FlipAI Bookslayer</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50">
      <div class="min-h-screen py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-4xl mx-auto">
          <div class="text-center mb-12">
            <h1 class="text-4xl font-bold text-gray-900 mb-2">FlipAI Bookslayer</h1>
            <p class="text-xl text-gray-600">Analyze books with AI and post to eBay</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <!-- Analyze Section -->
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-2xl font-bold text-gray-900 mb-4">📸 Analyze Book</h2>
              <form id="analyzeForm" class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Upload Book Photos</label>
                  <input type="file" id="photos" multiple accept="image/*" class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
                </div>
                <button type="submit" class="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700">Analyze with Gemini</button>
              </form>
              <div id="analyzeResult" class="mt-6 hidden">
                <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 class="font-bold text-green-900 mb-2">Analysis Result:</h3>
                  <pre id="analyzeOutput" class="text-sm text-gray-700 overflow-auto max-h-64"></pre>
                </div>
              </div>
              <div id="analyzeError" class="mt-6 hidden">
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 class="font-bold text-red-900 mb-2">Error:</h3>
                  <p id="analyzeErrorMsg" class="text-sm text-red-700"></p>
                </div>
              </div>
            </div>

            <!-- Post Listing Section -->
            <div class="bg-white rounded-lg shadow-md p-6">
              <h2 class="text-2xl font-bold text-gray-900 mb-4">📦 Post to eBay</h2>
              <form id="postForm" class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input type="text" id="title" placeholder="Book title" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Price</label>
                  <input type="number" id="price" placeholder="0.00" step="0.01" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">ISBN</label>
                  <input type="text" id="isbn" placeholder="ISBN" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Condition</label>
                  <select id="condition" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>New</option>
                    <option>Like New</option>
                    <option>Good</option>
                    <option>Fair</option>
                    <option>Poor</option>
                  </select>
                </div>
                <button type="submit" class="w-full bg-green-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-green-700">Post to eBay</button>
              </form>
              <div id="postResult" class="mt-6 hidden">
                <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 class="font-bold text-green-900 mb-2">Success:</h3>
                  <p id="postOutput" class="text-sm text-gray-700"></p>
                </div>
              </div>
              <div id="postError" class="mt-6 hidden">
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 class="font-bold text-red-900 mb-2">Error:</h3>
                  <p id="postErrorMsg" class="text-sm text-red-700"></p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        // Analyze form
        document.getElementById('analyzeForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const files = document.getElementById('photos').files;
          if (!files.length) {
            alert('Please select photos');
            return;
          }

          const photos = [];
          for (let file of files) {
            const reader = new FileReader();
            reader.onload = (event) => {
              photos.push(event.target.result);
              if (photos.length === files.length) {
                submitAnalyze(photos);
              }
            };
            reader.readAsDataURL(file);
          }
        });

        async function submitAnalyze(photos) {
          try {
            const response = await fetch('/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ photos })
            });
            const data = await response.json();
            if (response.ok) {
              document.getElementById('analyzeError').classList.add('hidden');
              document.getElementById('analyzeResult').classList.remove('hidden');
              document.getElementById('analyzeOutput').textContent = JSON.stringify(data, null, 2);
            } else {
              throw new Error(data.error);
            }
          } catch (error) {
            document.getElementById('analyzeResult').classList.add('hidden');
            document.getElementById('analyzeError').classList.remove('hidden');
            document.getElementById('analyzeErrorMsg').textContent = error.message;
          }
        }

        // Post form
        document.getElementById('postForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = document.getElementById('title').value;
          const price = document.getElementById('price').value;
          const isbn = document.getElementById('isbn').value;
          const condition = document.getElementById('condition').value;

          try {
            const response = await fetch('/post-listing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, price, isbn, condition })
            });
            const data = await response.json();
            if (response.ok) {
              document.getElementById('postError').classList.add('hidden');
              document.getElementById('postResult').classList.remove('hidden');
              document.getElementById('postOutput').textContent = data.detail || 'Listing posted successfully';
            } else {
              throw new Error(data.error);
            }
          } catch (error) {
            document.getElementById('postResult').classList.add('hidden');
            document.getElementById('postError').classList.remove('hidden');
            document.getElementById('postErrorMsg').textContent = error.message;
          }
        });
      </script>
    </body>
    </html>
  `);
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
