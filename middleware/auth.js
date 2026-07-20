'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user    = await db.get('SELECT * FROM users WHERE id=$1', [decoded.userId]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requirePro(req, res, next) {
  if (req.user?.plan !== 'pro') return res.status(403).json({ error: 'Pro plan required' });
  next();
}

module.exports = { authMiddleware, requirePro };
