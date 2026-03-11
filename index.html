const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// FORCE CORS ON EVERYTHING
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  next();
});

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'FlipAI Server Running' });
});

app.post('/post-listing', async (req, res) => {
  const { listing } = req.body;
  if (!listing) return res.status(400).json({ success: false, message: 'No listing data' });

  const token = process.env.EBAY_USER_TOKEN;
  const appId = process.env.EBAY_APP_ID;
  const postal = process.env.POSTAL_CODE || '90001';

  if (!token) return res.status(500).json({ success: false, message: 'EBAY_USER_TOKEN not set on server' });

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <Title>${esc(listing.title)}</Title>
    <Description><![CDATA[${listing.description || listing.title}]]></Description>
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

  try {
    const r = await fetch('https://api.ebay.com/ws/api.dll', {
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

    const text = await r.text();
    console.log('eBay response:', text.substring(0, 500));

    if (text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>')) {
      const match = text.match(/<ItemID>(\d+)<\/ItemID>/);
      const itemId = match ? match[1] : 'unknown';
      res.json({ success: true, itemId, url: 'https://www.ebay.com/itm/' + itemId });
    } else {
      const err = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
      res.status(400).json({ success: false, message: err ? err[1] : 'eBay rejected listing', raw: text.substring(0, 300) });
    }
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

app.listen(PORT, () => console.log('FlipAI running on port ' + PORT));
