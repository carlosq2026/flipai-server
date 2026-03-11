const express = require(‘express’);
const cors = require(‘cors’);
const fetch = require(‘node-fetch’);
const app = express();

app.use((req, res, next) => {
res.header(‘Access-Control-Allow-Origin’, ‘*’);
res.header(‘Access-Control-Allow-Methods’, ‘GET, POST, OPTIONS’);
res.header(‘Access-Control-Allow-Headers’, ‘Content-Type, Authorization’);
if (req.method === ‘OPTIONS’) return res.sendStatus(200);
next();
});
app.use(cors({ origin: ’*’ }));
app.use(express.json({ limit: ‘50mb’ }));

const PORT = process.env.PORT || 3000;

// Health check
app.get(’/’, (req, res) => {
res.json({ status: ‘FlipAI eBay Server Running ✅’, version: ‘1.0’ });
});

// Post listing to eBay
app.post(’/post-listing’, async (req, res) => {
const { userToken, appId, listing } = req.body;

if (!userToken || !appId || !listing) {
return res.status(400).json({ error: ‘Missing userToken, appId, or listing data’ });
}

try {
// Step 1: Create inventory item
const sku = ‘BOOK-’ + Date.now();

```
const inventoryItem = {
  availability: {
    shipToLocationAvailability: {
      quantity: 1
    }
  },
  condition: listing.condition === 'Like New' ? 'LIKE_NEW' :
             listing.condition === 'Good' ? 'GOOD' :
             listing.condition === 'Acceptable' ? 'ACCEPTABLE' : 'USED_GOOD',
  product: {
    title: listing.title,
    description: listing.description,
    aspects: {
      'Format': ['Paperback'],
      'Language': ['English']
    },
    imageUrls: listing.imageUrls || []
  }
};

const invRes = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`, {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer ' + userToken,
    'Content-Type': 'application/json',
    'Content-Language': 'en-US'
  },
  body: JSON.stringify(inventoryItem)
});

if (!invRes.ok && invRes.status !== 204) {
  const errData = await invRes.json();
  throw new Error('Inventory error: ' + JSON.stringify(errData));
}

// Step 2: Create offer
const offer = {
  sku: sku,
  marketplaceId: 'EBAY_US',
  format: 'FIXED_PRICE',
  availableQuantity: 1,
  categoryId: '261186', // Books category
  listingDescription: listing.description,
  listingPolicies: {
    fulfillmentPolicyId: process.env.FULFILLMENT_POLICY_ID || '',
    paymentPolicyId: process.env.PAYMENT_POLICY_ID || '',
    returnPolicyId: process.env.RETURN_POLICY_ID || ''
  },
  pricingSummary: {
    price: {
      value: String(listing.price),
      currency: 'USD'
    }
  },
  merchantLocationKey: process.env.MERCHANT_LOCATION_KEY || 'default'
};

const offerRes = await fetch('https://api.ebay.com/sell/inventory/v1/offer', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userToken,
    'Content-Type': 'application/json',
    'Content-Language': 'en-US'
  },
  body: JSON.stringify(offer)
});

const offerData = await offerRes.json();
if (!offerRes.ok) throw new Error('Offer error: ' + JSON.stringify(offerData));

const offerId = offerData.offerId;

// Step 3: Publish offer
const publishRes = await fetch(`https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userToken,
    'Content-Type': 'application/json'
  }
});

const publishData = await publishRes.json();
if (!publishRes.ok) throw new Error('Publish error: ' + JSON.stringify(publishData));

res.json({
  success: true,
  listingId: publishData.listingId,
  message: 'Listed on eBay! ✅',
  ebayUrl: `https://www.ebay.com/itm/${publishData.listingId}`
});
```

} catch (err) {
console.error(‘eBay posting error:’, err);
res.status(500).json({ error: err.message });
}
});

// Simple listing via Trading API (easier, uses Auth’n’Auth token)
app.post(’/post-trading’, async (req, res) => {
const { userToken, listing } = req.body;

if (!userToken || !listing) {
return res.status(400).json({ error: ‘Missing userToken or listing’ });
}

const xmlBody = `<?xml version="1.0" encoding="utf-8"?> <AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"> <RequesterCredentials> <eBayAuthToken>${userToken}</eBayAuthToken> </RequesterCredentials> <ErrorLanguage>en_US</ErrorLanguage> <WarningLevel>High</WarningLevel> <Item> <Title>${escXml(listing.title)}</Title> <Description><![CDATA[${listing.description}]]></Description> <PrimaryCategory> <CategoryID>261186</CategoryID> </PrimaryCategory> <StartPrice>${listing.price}</StartPrice> <CategoryMappingAllowed>true</CategoryMappingAllowed> <Country>US</Country> <Currency>USD</Currency> <DispatchTimeMax>3</DispatchTimeMax> <ListingDuration>GTC</ListingDuration> <ListingType>FixedPriceItem</ListingType> <PaymentMethods>PayPal</PaymentMethods> <PayPalEmailAddress>${process.env.PAYPAL_EMAIL || ''}</PayPalEmailAddress> <PictureDetails> ${(listing.imageUrls || []).map(url => `<PictureURL>${url}</PictureURL>`).join('\n      ')} </PictureDetails> <PostalCode>${process.env.POSTAL_CODE || '90001'}</PostalCode> <Quantity>1</Quantity> <ReturnPolicy> <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption> <RefundOption>MoneyBack</RefundOption> <ReturnsWithinOption>Days_30</ReturnsWithinOption> <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption> </ReturnPolicy> <ShippingDetails> <ShippingType>Flat</ShippingType> <ShippingServiceOptions> <ShippingServicePriority>1</ShippingServicePriority> <ShippingService>USPSMedia</ShippingService> <ShippingServiceCost>3.99</ShippingServiceCost> </ShippingServiceOptions> </ShippingDetails> <Site>US</Site> <ConditionID>3000</ConditionID> </Item> </AddItemRequest>`;

try {
const tradingRes = await fetch(‘https://api.ebay.com/ws/api.dll’, {
method: ‘POST’,
headers: {
‘X-EBAY-API-SITEID’: ‘0’,
‘X-EBAY-API-COMPATIBILITY-LEVEL’: ‘967’,
‘X-EBAY-API-CALL-NAME’: ‘AddItem’,
‘X-EBAY-API-APP-NAME’: process.env.EBAY_APP_ID || ‘’,
‘X-EBAY-API-DEV-NAME’: process.env.EBAY_DEV_ID || ‘’,
‘X-EBAY-API-CERT-NAME’: process.env.EBAY_CERT_ID || ‘’,
‘Content-Type’: ‘text/xml’
},
body: xmlBody
});

```
const responseText = await tradingRes.text();

if (responseText.includes('<Ack>Success</Ack>') || responseText.includes('<Ack>Warning</Ack>')) {
  const itemIdMatch = responseText.match(/<ItemID>(\d+)<\/ItemID>/);
  const itemId = itemIdMatch ? itemIdMatch[1] : 'unknown';
  res.json({
    success: true,
    listingId: itemId,
    message: 'Listed on eBay! ✅',
    ebayUrl: `https://www.ebay.com/itm/${itemId}`
  });
} else {
  const errorMatch = responseText.match(/<LongMessage>(.*?)<\/LongMessage>/);
  throw new Error(errorMatch ? errorMatch[1] : 'eBay listing failed');
}
```

} catch(err) {
console.error(‘Trading API error:’, err);
res.status(500).json({ error: err.message });
}
});

function escXml(str) {
return (str || ‘’).replace(/&/g,’&’).replace(/</g,’<’).replace(/>/g,’>’);
}

app.listen(PORT, () => console.log(`FlipAI Server running on port ${PORT}`));
