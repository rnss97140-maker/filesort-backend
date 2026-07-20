'use strict';

const https = require('https');

const FROM = process.env.EMAIL_FROM || 'FileSortz <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[MAILER] RESEND_API_KEY not set — skipping email');
    return;
  }

  const body = JSON.stringify({ from: FROM, to, subject, html });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 400) {
          console.error('[MAILER] Resend error:', parsed);
          reject(new Error(parsed.message || 'Email send failed'));
        } else {
          console.log('[MAILER] Email sent to', to);
          resolve(parsed);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendProWelcome({ name, email, amount, orderId }) {
  return sendEmail({
    to: email,
    subject: '🎉 Welcome to FileSortz Pro!',
    html: `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#07070A;padding:32px;text-align:center;border-radius:12px 12px 0 0">
        <h1 style="color:#6EFF8A;margin:0;font-size:28px">FileSortz ✨</h1>
        <p style="color:#8888AA;margin:8px 0 0;font-size:14px">Pro Plan Activated</p>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
        <p style="font-size:16px">Hi <strong>${name}</strong> 👋</p>
        <p>Welcome to <strong>FileSortz Pro</strong>! Your payment of ₹${amount} was successful.</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin:20px 0">
          <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase">Invoice Summary</p>
          <p style="margin:4px 0;font-size:14px">Order ID: <strong>${orderId}</strong></p>
          <p style="margin:4px 0;font-size:14px">Amount: <strong>₹${amount}</strong></p>
          <p style="margin:4px 0;font-size:14px">Plan: <strong>Pro Monthly</strong></p>
        </div>
        <p style="font-size:14px;color:#555">You now have unlimited file sorting, team collaboration and priority support.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${process.env.FRONTEND_URL || 'https://filesortz.netlify.app'}" style="background:#6EFF8A;color:#07070A;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Go to FileSortz →</a>
        </div>
      </div>
    </div>`
  });
}

async function sendTeamInvite({ toEmail, inviterName, teamName, inviteLink }) {
  return sendEmail({
    to: toEmail,
    subject: `${inviterName} invited you to join ${teamName} on FileSortz`,
    html: `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#07070A;padding:32px;text-align:center;border-radius:12px 12px 0 0">
        <h1 style="color:#6EFF8A;margin:0;font-size:28px">FileSortz</h1>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
        <h2>You've been invited! 🎉</h2>
        <p><strong>${inviterName}</strong> has invited you to join <strong>${teamName}</strong> on FileSortz.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${inviteLink}" style="background:#6EFF8A;color:#07070A;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Accept Invitation →</a>
        </div>
        <p style="font-size:12px;color:#999">This invite expires in 7 days.</p>
      </div>
    </div>`
  });
}

async function sendPasswordReset({ name, email, resetLink }) {
  return sendEmail({
    to: email,
    subject: 'Reset your FileSortz password',
    html: `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#07070A;padding:32px;text-align:center;border-radius:12px 12px 0 0">
        <h1 style="color:#6EFF8A;margin:0;font-size:28px">FileSortz</h1>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
        <h2>Reset Your Password</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>We received a request to reset your FileSortz password. Click below to set a new password.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${resetLink}" style="background:#6EFF8A;color:#07070A;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Reset Password →</a>
        </div>
        <p style="font-size:12px;color:#999">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    </div>`
  });
}

module.exports = { sendProWelcome, sendTeamInvite, sendPasswordReset };
