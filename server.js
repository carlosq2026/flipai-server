const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

// Serve HTML at GET /
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>FlipAI - eBay Listing</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; color: #f0f0ff; font-family: monospace; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .logo { font-size: 2rem; font-weight: bold; color: #00e5a0; margin-bottom: 20px; }
        .section { background: #1a1a26; border: 1px solid #2a2a3d; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        label { display: block; font-size: 0.75rem; color: #6b6b8a; text-transform: uppercase; margin-bottom: 6px; }
        input, textarea { width: 100%; background: #12121a; border: 1px solid #2a2a3d; border-radius: 8px; padding: 10px; color: #f0f0ff; font-family: monospace; margin-bottom: 12px; font-size: 0.85rem; }
        .btn { background: #00e5a0; color: #0a0a0f; border: none; border-radius: 8px; padding: 12px 24px; font-weight: bold; font-size: 0.9rem; cursor: pointer; }
        .btn:hover { background: #00d490; }
        .status { font-size: 0.8rem; margin-top: 8px; color: #00e5a0; }
        .status.err { color: #ff6b35; }
        .result { background: #12121a; border: 1px solid #2a2a3d; border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">FlipAI - eBay Listing</div>
        <div class="section">
          <label>Title</label>
          <input type="text" id="title" placeholder="Book title">
          
          <label>Description</label>
          <textarea id="description" rows="4" placeholder="Book description"></textarea>
          
          <label>Price</label>
          <input type="number" id="price" step="0.01" value="10.00" placeholder="10.00">
          
          <button class="btn" onclick="postListing()">Post to eBay</button>
          <div class="status" id="status"></div>
          <div class="result" id="result"></div>
        </div>
      </div>
      
      <script>
        function setStatus(msg, isError) {
          const el = document.getElementById('status');
          el.textContent = msg;
          el.className = 'status' + (isError ? ' err' : '');
        }
        
        function postListing() {
          const title = document.getElementById('title').value.trim();
          const description = document.getElementById('description').value.trim();
          const price = parseFloat(document.getElementById('price').value);
          
          if (!title) {
            setStatus('Enter a title', true);
            return;
          }
          if (!price || price <= 0) {
            setStatus('Enter a valid price', true);
            return;
          }
          
          setStatus('Posting to eBay...', false);
          
          fetch('/post-listing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              listing: {
                title: title,
                description: description,
                price: price
              }
            })
          })
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              setStatus('Success! Item ID: ' + data.itemId, false);
              document.getElementById('result').textContent = JSON.stringify(data, null, 2);
            } else {
              setStatus('Error: ' + (data.message || 'Unknown error'), true);
              document.getElementById('result').textContent = JSON.stringify(data, null, 2);
            }
          })
          .catch(err => {
            setStatus('Error: ' + err.message, true);
            document.getElementById('result').textContent = err.message;
          });
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// POST endpoint for eBay Trading API
app.post('/post-listing', async (req, res) => {
  try {
    const listing = req.body.listing;
    if (!listing) {
      return res.status(400).json({ success: false, message: 'No listing data' });
    }

    const token = process.env.EBAY_USER_TOKEN;
    const appId = process.env.EBAY_APP_ID;
    const postal = process.env.POSTAL_CODE || '90001';

    if (!token) {
      return res.status(500).json({ success: false, message: 'EBAY_USER_TOKEN not set' });
    }

    // Build XML request for eBay Trading API
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${escapeXml(listing.title)}</Title>
    <Description><![CDATA[${listing.description || ''}]]></Description>
    <PrimaryCategory><CategoryID>261186</CategoryID></PrimaryCategory>
    <StartPrice>${listing.price}</StartPrice>
    <Country>US</Country>
    <Currency>USD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <PostalCode>${postal}</PostalCode>
    <Quantity>1</Quantity>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSMedia</ShippingService>
        <ShippingServiceCost>3.99</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption>
    </ReturnPolicy>
    <ConditionID>3000</ConditionID>
    <Site>US</Site>
  </Item>
</AddItemRequest>`;

    const response = await fetch('https://api.ebay.com/ws/api.dll', {
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

    const text = await response.text();

    if (text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>')) {
      const match = text.match(/<ItemID>(\d+)<\/ItemID>/);
      const itemId = match ? match[1] : 'unknown';
      res.json({
        success: true,
        itemId: itemId,
        url: `https://www.ebay.com/itm/${itemId}`
      });
    } else {
      const errMatch = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
      const errMsg = errMatch ? errMatch[1] : 'eBay rejected listing';
      res.status(400).json({ success: false, message: errMsg });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

function escapeXml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

app.listen(PORT, () => {
  console.log(`FlipAI server running on port ${PORT}`);
