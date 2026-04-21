const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('Server starting on port', PORT);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
