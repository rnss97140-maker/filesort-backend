# 🗂 FileSort — Backend API

Node.js + Express backend for FileSort. Handles Razorpay payments, JWT auth, Pro subscriptions and team collaboration.

---

## 📁 Project Structure

```
filesort-backend/
├── server.js               ← Entry point
├── .env.example            ← Copy to .env and fill values
├── routes/
│   ├── auth.js             ← Register, Login, /me
│   ├── payment.js          ← Create order, Verify, Subscription
│   ├── team.js             ← Invite, Accept, Members, Remove
│   └── webhook.js          ← Razorpay webhook handler
├── middleware/
│   └── auth.js             ← JWT + requirePro middleware
├── utils/
│   ├── db.js               ← In-memory store (swap for MongoDB/PostgreSQL)
│   └── mailer.js           ← Invoice + invite emails via Nodemailer
└── tests/
    └── api.test.js         ← Integration test suite
```

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your Razorpay keys, JWT secret, SMTP credentials
```

### 3. Run in development
```bash
npm run dev        # uses nodemon — auto-restarts on changes
```

### 4. Run in production
```bash
npm start
```

### 5. Run tests (server must be running)
```bash
npm test
```

---

## 🔑 Environment Variables

| Variable | Description | Required |
|---|---|---|
| `PORT` | Server port (default: 4000) | No |
| `RAZORPAY_KEY_ID` | Razorpay Key ID from dashboard | ✅ Yes |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret | ✅ Yes |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signing secret (set in Razorpay dashboard) | ✅ Yes |
| `JWT_SECRET` | Strong random string for signing JWTs | ✅ Yes |
| `FRONTEND_URL` | Frontend URL for CORS (e.g. https://filesort.com) | Yes |
| `SMTP_HOST` | SMTP server host | For emails |
| `SMTP_USER` | SMTP username/email | For emails |
| `SMTP_PASS` | SMTP password or app password | For emails |

---

## 💳 Razorpay Setup (Step by Step)

### Step 1 — Create Razorpay Account
1. Go to [https://dashboard.razorpay.com](https://dashboard.razorpay.com)
2. Sign up with your business details
3. Complete KYC verification

### Step 2 — Get API Keys
1. Dashboard → Settings → API Keys
2. Generate Test keys first (for development)
3. Copy `Key ID` → `RAZORPAY_KEY_ID` in `.env`
4. Copy `Key Secret` → `RAZORPAY_KEY_SECRET` in `.env`

### Step 3 — Set Up Webhook
1. Dashboard → Settings → Webhooks → Add New Webhook
2. URL: `https://your-domain.com/api/webhook`
3. Secret: create a strong secret → `RAZORPAY_WEBHOOK_SECRET` in `.env`
4. Events to subscribe:
   - ✅ `payment.captured`
   - ✅ `payment.failed`
   - ✅ `subscription.charged`
   - ✅ `subscription.cancelled`

### Step 4 — Frontend Integration
Update your frontend HTML to use the backend:

```javascript
// 1. Create order from backend
const { orderId, keyId, prefill } = await fetch('/api/payment/create-order', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}` 
  },
}).then(r => r.json());

// 2. Open Razorpay checkout
const rzp = new Razorpay({
  key: keyId,
  order_id: orderId,
  amount: 49900,
  currency: 'INR',
  name: 'FileSort',
  description: 'Pro Monthly Subscription',
  prefill,
  theme: { color: '#6EFF8A' },
  handler: async function(response) {
    // 3. Verify payment on backend
    const result = await fetch('/api/payment/verify', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}` 
      },
      body: JSON.stringify(response),
    }).then(r => r.json());

    if (result.success) {
      // Update UI — user is now Pro
      activatePro();
    }
  }
});
rzp.open();
```

---

## 🛣 API Reference

### Auth
| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Get JWT token |
| GET | `/api/auth/me` | JWT | Get profile + plan |

### Payment
| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/payment/create-order` | JWT | Create Razorpay order |
| POST | `/api/payment/verify` | JWT | Verify payment + activate Pro |
| GET | `/api/payment/subscription` | JWT | Get subscription status |
| POST | `/api/payment/cancel` | JWT | Cancel subscription |
| GET | `/api/payment/orders` | JWT | Order history |

### Team (Pro only)
| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/team/create` | JWT + Pro | Create team workspace |
| POST | `/api/team/invite` | JWT + Pro | Invite member by email |
| GET | `/api/team/members` | JWT + Pro | List team members |
| DELETE | `/api/team/member/:email` | JWT + Pro | Remove member |
| POST | `/api/team/accept/:token` | JWT | Accept invite |

### Webhook
| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/webhook` | Razorpay signature | Handle Razorpay events |

---

## 🚀 Deployment

### Deploy to Railway (easiest)
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
# Set env vars in Railway dashboard
```

### Deploy to Render
1. Push code to GitHub
2. New Web Service → connect repo
3. Build: `npm install`, Start: `npm start`
4. Add environment variables in Render dashboard

### Deploy to VPS (Ubuntu)
```bash
# Install Node
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and install
git clone your-repo && cd filesort-backend
npm install --production
cp .env.example .env && nano .env

# Run with PM2
npm install -g pm2
pm2 start server.js --name filesort-api
pm2 startup && pm2 save

# Nginx reverse proxy
# Add to /etc/nginx/sites-available/filesort:
# location /api { proxy_pass http://localhost:4000; }
```

---

## 🔒 Production Checklist

- [ ] Use live Razorpay keys (not test keys)
- [ ] Set a strong `JWT_SECRET` (32+ random characters)
- [ ] Configure `RAZORPAY_WEBHOOK_SECRET`
- [ ] Replace in-memory `db.js` with MongoDB or PostgreSQL
- [ ] Add rate limiting: `npm install express-rate-limit`
- [ ] Add password hashing: `npm install bcrypt`
- [ ] Enable HTTPS on your domain
- [ ] Set `FRONTEND_URL` to your actual domain for CORS
- [ ] Set up log monitoring (e.g. PM2 logs, Logtail)

---

## 🗄 Moving to a Real Database

The `utils/db.js` is an in-memory store — data resets on server restart. For production, replace it with:

**MongoDB (recommended)**
```bash
npm install mongoose
```

**PostgreSQL**
```bash
npm install pg sequelize
```

Each route uses `db.users[email]`, `db.orders[id]` etc. — replace these with your ORM queries.

---

Built for FileSort 🗂 | Node.js + Express + Razorpay
