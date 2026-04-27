'use strict';
const express = require('express');
const path    = require('path');
const { initDb } = require('./data/db');
const apiRouter  = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

// Catch-all → SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb();

// Local dev: start the server directly.
// Vercel: export the app as a serverless handler — don't call listen().
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Sleeper Dynasty Analyzer`);
    console.log(`  → http://localhost:${PORT}\n`);
  });
}

module.exports = app;
