// ─────────────────────────────────────────────────────────────────────────────
//  routes/webhook.js
//  POST /api/webhook — Razorpay webhook handler
//  Handles: payment.captured, subscription.charged, subscription.cancelled
//  IMPORTANT: This route uses raw body (set in server.js) for signature verification
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../utils/db');
const { sendProWelcome } = require('../utils/mailer');

// ── SIGNATURE VERIFICATION ────────────────────────────────────────────────────
function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

// ── WEBHOOK HANDLER ───────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

  if (!signature) {
    console.warn('[WEBHOOK] Missing signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  // Verify signature using raw body
  const rawBody = req.body; // raw Buffer (express.raw middleware set in server.js)
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.warn('[WEBHOOK] Signature verification failed');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  console.log(`[WEBHOOK] Event received: ${event.event}`);

  // ── HANDLE EVENTS ──────────────────────────────────────────────────────────
  switch (event.event) {

    // Payment captured (one-time)
    case 'payment.captured': {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      const order   = db.orders[orderId];

      if (order) {
        order.status    = 'paid';
        order.paymentId = payment.id;
        order.paidAt    = new Date().toISOString();

        // Activate Pro for user
        const user = Object.values(db.users).find(u => u.id === order.userId);
        if (user && user.plan !== 'pro') {
          user.plan = 'pro';
          console.log(`[WEBHOOK] Pro activated for ${user.email} via webhook`);
        }
      }
      break;
    }

    // Subscription auto-renewal charged successfully
    case 'subscription.charged': {
      const sub  = event.payload.subscription.entity;
      const email = sub.notes?.email;

      if (email) {
        const user = db.users[email];
        if (user) {
          user.plan = 'pro';
          // Update next billing date
          if (user.subscriptionId && db.subscriptions[user.subscriptionId]) {
            db.subscriptions[user.subscriptionId].nextBilling = new Date(
              sub.current_end * 1000
            ).toISOString();
            db.subscriptions[user.subscriptionId].status = 'active';
          }
          console.log(`[WEBHOOK] Subscription renewed for ${email}`);
        }
      }
      break;
    }

    // Subscription cancelled (from Razorpay dashboard or API)
    case 'subscription.cancelled': {
      const sub   = event.payload.subscription.entity;
      const email = sub.notes?.email;

      if (email) {
        const user = db.users[email];
        if (user) {
          user.plan = 'free';
          if (user.subscriptionId && db.subscriptions[user.subscriptionId]) {
            db.subscriptions[user.subscriptionId].status      = 'cancelled';
            db.subscriptions[user.subscriptionId].cancelledAt = new Date().toISOString();
          }
          console.log(`[WEBHOOK] Subscription cancelled for ${email}`);
        }
      }
      break;
    }

    // Payment failed
    case 'payment.failed': {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      if (db.orders[orderId]) {
        db.orders[orderId].status = 'failed';
        db.orders[orderId].failedAt = new Date().toISOString();
      }
      console.log(`[WEBHOOK] Payment failed for order ${orderId}`);
      break;
    }

    default:
      console.log(`[WEBHOOK] Unhandled event: ${event.event}`);
  }

  // Always respond 200 quickly to acknowledge receipt
  res.json({ received: true });
});

module.exports = router;
