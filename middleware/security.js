// ─────────────────────────────────────────────────────────────────────────────
//  middleware/security.js — Helmet, rate limiting, request size limits
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

// ── HELMET ────────────────────────────────────────────────────────────────────
// Sets 11 security-relevant HTTP headers (XSS, clickjacking, MIME sniffing etc.)
const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow file downloads
});

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────
// General API — 100 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});

// Auth routes (login/register) — tighter: 10 per 15 min to prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts — please wait 15 minutes.' },
  skipSuccessfulRequests: true, // don't count successful logins against the limit
});

// Upload — 30 per minute (multer handles individual file size limits)
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many uploads — please wait a moment.' },
});

module.exports = { helmetMiddleware, generalLimiter, authLimiter, uploadLimiter };
