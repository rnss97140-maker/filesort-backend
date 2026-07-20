'use strict';

const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const router   = express.Router();
const db       = require('../utils/db');
const { sendProWelcome } = require('../utils/mailer');
const { authMiddleware } = require('../middleware/auth');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
});

const PRO_AMOUNT   = 49900;
const PRO_CURRENCY = 'INR';

// CREATE ORDER
router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    if (user.plan === 'pro') return res.status(400).json({ error: 'Already on Pro plan' });

    const order = await razorpay.orders.create({
      amount:   PRO_AMOUNT,
      currency: PRO_CURRENCY,
      receipt:  'rcpt_' + Date.now().toString(36),
      notes:    { userId: user.id, email: user.email },
    });

    await db.run(
      `INSERT INTO orders (order_id, user_id, email, amount, currency, status) VALUES ($1,$2,$3,$4,$5,'created')`,
      [order.id, user.id, user.email, PRO_AMOUNT, PRO_CURRENCY]
    );

    res.json({
      orderId: order.id, amount: PRO_AMOUNT, currency: PRO_CURRENCY,
      keyId: process.env.RAZORPAY_KEY_ID,
      prefill: { name: user.name, email: user.email, contact: user.phone || '' },
    });
  } catch (err) {
    console.error('[PAYMENT] create-order error:', err);
    res.status(500).json({ error: 'Failed to create order', detail: err.message });
  }
});

// VERIFY PAYMENT
router.post('/verify', authMiddleware, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: 'Missing payment fields' });

  try {
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature)
      return res.status(400).json({ error: 'Payment verification failed' });

    const user  = req.user;
    const subId = 'sub_' + Date.now();
    const now   = new Date();
    const next  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.transaction(async (client) => {
      await client.query(`UPDATE orders SET status='paid', payment_id=$1, paid_at=NOW() WHERE order_id=$2`, [razorpay_payment_id, razorpay_order_id]);
      await client.query(
        `INSERT INTO subscriptions (sub_id,user_id,email,plan,status,start_date,next_billing,order_id,payment_id) VALUES ($1,$2,$3,'pro_monthly','active',$4,$5,$6,$7)`,
        [subId, user.id, user.email, now, next, razorpay_order_id, razorpay_payment_id]
      );
      await client.query(`UPDATE users SET plan='pro', sub_id=$1, updated_at=NOW() WHERE id=$2`, [subId, user.id]);
    });

    sendProWelcome({ name: user.name, email: user.email, amount: 499, orderId: razorpay_order_id })
      .catch(e => console.warn('[MAILER]', e.message));

    res.json({ success: true, message: 'Pro plan activated!', plan: 'pro' });
  } catch (err) {
    console.error('[PAYMENT] verify error:', err);
    res.status(500).json({ error: 'Verification failed', detail: err.message });
  }
});

// SUBSCRIPTION STATUS
router.get('/subscription', authMiddleware, async (req, res) => {
  const user = req.user;
  const sub  = user.sub_id ? await db.get('SELECT * FROM subscriptions WHERE sub_id=$1', [user.sub_id]) : null;
  res.json({
    plan: user.plan, subscription: sub || null,
    features: { maxFiles: user.plan === 'pro' ? null : 50, teamCollaboration: user.plan === 'pro', cloudStorageGB: user.plan === 'pro' ? 10 : 0 },
  });
});

// CANCEL
router.post('/cancel', authMiddleware, async (req, res) => {
  const user = req.user;
  if (user.plan !== 'pro') return res.status(400).json({ error: 'No active Pro subscription' });
  if (user.sub_id) await db.run(`UPDATE subscriptions SET status='cancelled', cancelled_at=NOW() WHERE sub_id=$1`, [user.sub_id]);
  await db.run(`UPDATE users SET plan='free', updated_at=NOW() WHERE id=$1`, [user.id]);
  res.json({ success: true, message: 'Subscription cancelled.', plan: 'free' });
});

// ORDER HISTORY
router.get('/orders', authMiddleware, async (req, res) => {
  const orders = await db.all('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ orders });
});

module.exports = router;
