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
app.listen(PORT, () => {
  console.log(`\n  Sleeper Dynasty Analyzer`);
  console.log(`  → http://localhost:${PORT}\n`);
});
