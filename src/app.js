require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');

const app = express();

// Trust nginx reverse proxy so express-rate-limit reads the correct client IP
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10kb' }));

if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

// Uploaded avatars. Served from the same origin the app already talks to.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    maxAge: '7d',
    // Avatars are public images; helmet's same-origin default would block them.
    setHeaders: (res) =>
      res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
  }),
);

app.use('/api', routes);

// Public privacy policy — required by the Play Console store listing.
app.get('/privacy', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/privacy.html')),
);

// Public account-deletion instructions — required by Play's Data safety form.
app.get('/delete-account', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/delete-account.html')),
);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
