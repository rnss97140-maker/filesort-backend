// ─────────────────────────────────────────────────────────────────────────────
//  FileSort Backend v2 — server.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { helmetMiddleware, generalLimiter, authLimiter, uploadLimiter } = require('./middleware/security');
const authRoutes    = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const teamRoutes    = require('./routes/team');
const fileRoutes    = require('./routes/files');
const webhookRoutes = require('./routes/webhook');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── SECURITY HEADERS ──────────────────────────────────────────────────────────
app.use(helmetMiddleware);

// ── WEBHOOK (needs raw body — mount BEFORE express.json) ─────────────────────
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRoutes);

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    // Allow if in allowed list, or if no list set (dev mode)
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS blocked: ${origin}`));
  },
  methods:      ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── BODY PARSERS ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));       // JSON bodies capped at 1 MB
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── GLOBAL RATE LIMIT ─────────────────────────────────────────────────────────
app.use('/api/', generalLimiter);

// ── REQUEST LOGGER ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth',           authLimiter, authRoutes);    // tighter auth limit
app.use('/api/files/upload',   uploadLimiter);              // upload-specific limit
app.use('/api/files',          fileRoutes);
app.use('/api/payment',        paymentRoutes);
app.use('/api/team',           teamRoutes);

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:   'ok',
    service:  'FileSort API v2',
    time:     new Date().toISOString(),
    node:     process.version,
    razorpay: !!process.env.RAZORPAY_KEY_ID,
    email:    !!process.env.RESEND_API_KEY,
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const { initSchema } = require('./utils/db');

// ── START ─────────────────────────────────────────────────────────────────────
initSchema().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 FileSort API v2 running on http://localhost:${PORT}`);
    console.log(`   DB       : PostgreSQL`);
    console.log(`   Razorpay : ${process.env.RAZORPAY_KEY_ID  || '⚠  NOT SET'}`);
    console.log(`   SMTP     : ${process.env.SMTP_USER        || '⚠  NOT SET'}`);
    console.log(`   Env      : ${process.env.NODE_ENV         || 'development'}\n`);
  });
}).catch(err => {
  console.error('❌ Failed to connect to database:', err.message);
  process.exit(1);
});

module.exports = app;
