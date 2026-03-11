const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const EBAY_USER_TOKEN = process.env.EBAY_USER_TOKEN;
const POSTAL_CODE = process.env.POSTAL_CODE || '90210';

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'FlipAI eBay Server Running' });
});

app.post('/post-listing', async (req, res) => {
  const { listing } = req.body;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${listing.title}</Title>
    <Description>${listing.description}</Description>
    <PrimaryCategory><CategoryID>${listing.categoryId || 261186}</CategoryID></PrimaryCategory>
    <StartPrice>${listing.price}</StartPrice>
    <ConditionID>${listing.conditionId || 3000}</ConditionID>
    <Country>US</Country>
    <Currency>USD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <PostalCode>${POSTAL_CODE}</PostalCode>
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
  </Item>
</AddItemRequest>`;

  try {
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'AddItem',
        'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID
      },
      body: xml
    });
    const text = await response.text();
    const result = await xml2js.parseStringPromise(text);
    const ack = result?.AddItemResponse?.Ack?.[0];
    const itemId = result?.AddItemResponse?.ItemID?.[0];
    if (ack === 'Success' || ack === 'Warning') {
      res.json({ success: true, itemId, url: `https://www.ebay.com/itm/${itemId}` });
    } else {
      const errors = result?.AddItemResponse?.Errors;
      res.status(400).json({ success: false, errors });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
