'use strict';

const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const router   = express.Router();
const db       = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const JWT_SECRET  = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
const JWT_EXPIRES = '30d';
const SALT_ROUNDS = 10;

function makeToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function validationErrors(req, res) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    res.status(422).json({ error: 'Validation failed', details: errs.array() });
    return true;
  }
  return false;
}

// REGISTER
router.post('/register',
  body('name').trim().notEmpty().isLength({ max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('phone').optional().trim(),
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { name, email, password, phone = '' } = req.body;
    try {
      const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const hashed = await bcrypt.hash(password, SALT_ROUNDS);
      const userId = 'usr_' + Date.now() + Math.random().toString(36).slice(2, 7);

      await db.run(
        `INSERT INTO users (id, name, email, phone, password, plan) VALUES ($1,$2,$3,$4,$5,'free')`,
        [userId, name, email, phone, hashed]
      );

      const user = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
      res.status(201).json({ message: 'Account created', token: makeToken(userId), user: sanitize(user) });
    } catch (err) {
      console.error('[AUTH] register error:', err);
      res.status(500).json({ error: 'Registration failed', detail: err.message });
    }
  }
);

// LOGIN
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { email, password } = req.body;
    try {
      const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      res.json({ message: 'Logged in', token: makeToken(user.id), user: sanitize(user) });
    } catch (err) {
      console.error('[AUTH] login error:', err);
      res.status(500).json({ error: 'Login failed', detail: err.message });
    }
  }
);

// ME
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: sanitize(req.user) });
});

// UPDATE PROFILE
router.put('/me', authMiddleware,
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('phone').optional().trim(),
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { name, phone } = req.body;
    try {
      await db.run(
        `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone), updated_at=NOW() WHERE id=$3`,
        [name || null, phone || null, req.user.id]
      );
      const updated = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
      res.json({ message: 'Profile updated', user: sanitize(updated) });
    } catch (err) {
      res.status(500).json({ error: 'Update failed', detail: err.message });
    }
  }
);

// CHANGE PASSWORD
router.post('/change-password', authMiddleware,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { currentPassword, newPassword } = req.body;
    try {
      const user  = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

      const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await db.run('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashed, user.id]);
      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to change password', detail: err.message });
    }
  }
);

function sanitize(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, plan: u.plan, teamId: u.team_id, createdAt: u.created_at };
}

module.exports = router;

// FORGOT PASSWORD
router.post('/forgot-password',
  body('email').isEmail().normalizeEmail(),
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { email } = req.body;
    try {
      const user = await db.get('SELECT * FROM users WHERE email=$1', [email]);
      // Always return success even if email not found (security best practice)
      if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

      const token   = require('crypto').randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.run(
        `INSERT INTO password_resets (token, user_id, email, expires_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET token=$1, expires_at=$4, used=FALSE`,
        [token, user.id, email, expires]
      );

      const resetLink = `${process.env.FRONTEND_URL || 'https://filesortz.netlify.app'}?reset_token=${token}`;
      const { sendPasswordReset } = require('../utils/mailer');
      await sendPasswordReset({ name: user.name, email, resetLink });

      console.log(`[AUTH] Password reset sent to ${email}`);
      res.json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (err) {
      console.error('[AUTH] forgot-password error:', err);
      res.status(500).json({ error: 'Failed to send reset email', detail: err.message });
    }
  }
);

// RESET PASSWORD
router.post('/reset-password',
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { token, newPassword } = req.body;
    try {
      const reset = await db.get(
        'SELECT * FROM password_resets WHERE token=$1 AND used=FALSE AND expires_at > NOW()',
        [token]
      );
      if (!reset) return res.status(400).json({ error: 'Reset link is invalid or has expired.' });

      const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await db.run('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashed, reset.user_id]);
      await db.run('UPDATE password_resets SET used=TRUE WHERE token=$1', [token]);

      console.log(`[AUTH] Password reset successful for ${reset.email}`);
      res.json({ message: 'Password reset successfully. You can now log in.' });
    } catch (err) {
      console.error('[AUTH] reset-password error:', err);
      res.status(500).json({ error: 'Failed to reset password', detail: err.message });
    }
  }
);
