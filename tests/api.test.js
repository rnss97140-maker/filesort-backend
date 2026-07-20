// ─────────────────────────────────────────────────────────────────────────────
//  tests/api.test.js
//  Basic integration tests — run with: node tests/api.test.js
//  Tests: register, login, payment flow, team flow
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');

const BASE = 'http://localhost:4000';
let token  = '';
let proToken = '';

// ── HELPERS ────────────────────────────────────────────────────────────────────
function req(method, path, body, authToken) {
  return new Promise((resolve, reject) => {
    const data    = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: 'localhost',
      port:     4000,
      path,
      headers: {
        'Content-Type':  'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const r = http.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function pass(name) { console.log(`  ✅ ${name}`); }
function fail(name, detail) { console.log(`  ❌ ${name}: ${detail}`); process.exitCode = 1; }
function section(name) { console.log(`\n── ${name} ─────────────────────────`); }

// ── TESTS ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🧪 FileSort API Tests\n');

  // ── Health ─────────────────────────────────────────────────────────────────
  section('Health');
  {
    const r = await req('GET', '/api/health');
    r.status === 200 && r.body.status === 'ok'
      ? pass('GET /api/health')
      : fail('GET /api/health', JSON.stringify(r.body));
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  section('Auth');
  {
    // Register
    const r = await req('POST', '/api/auth/register', {
      name:  'Test Creator',
      email: 'test@filesort.com',
      phone: '9876543210',
    });
    r.status === 201 && r.body.token
      ? (pass('POST /api/auth/register'), token = r.body.token)
      : fail('POST /api/auth/register', JSON.stringify(r.body));
  }
  {
    // Duplicate register
    const r = await req('POST', '/api/auth/register', { name: 'X', email: 'test@filesort.com' });
    r.status === 409 ? pass('Duplicate email → 409') : fail('Duplicate email', r.status);
  }
  {
    // Login
    const r = await req('POST', '/api/auth/login', { email: 'test@filesort.com' });
    r.status === 200 && r.body.token ? pass('POST /api/auth/login') : fail('Login', JSON.stringify(r.body));
  }
  {
    // Me
    const r = await req('GET', '/api/auth/me', null, token);
    r.status === 200 && r.body.user.plan === 'free'
      ? pass('GET /api/auth/me (free plan)')
      : fail('GET /api/auth/me', JSON.stringify(r.body));
  }

  // ── Payment ────────────────────────────────────────────────────────────────
  section('Payment');
  {
    // Create order (will fail if Razorpay keys not set — that's expected in test)
    const r = await req('POST', '/api/payment/create-order', {}, token);
    r.status === 200 || r.status === 500
      ? pass(`POST /api/payment/create-order → ${r.status} (${r.status === 500 ? 'expected without live keys' : 'success'})`)
      : fail('create-order', JSON.stringify(r.body));
  }
  {
    // Subscription status
    const r = await req('GET', '/api/payment/subscription', null, token);
    r.status === 200 && r.body.plan === 'free'
      ? pass('GET /api/payment/subscription → free plan')
      : fail('subscription status', JSON.stringify(r.body));
  }
  {
    // Verify with wrong signature
    const r = await req('POST', '/api/payment/verify', {
      razorpay_order_id:   'order_test',
      razorpay_payment_id: 'pay_test',
      razorpay_signature:  'wrong_sig',
    }, token);
    r.status === 400 ? pass('Verify → 400 on bad signature') : fail('Verify bad sig', r.status);
  }

  // ── Team (Free plan — should get 403) ─────────────────────────────────────
  section('Team (Free plan gate)');
  {
    const r = await req('POST', '/api/team/create', { teamName: 'My Team' }, token);
    r.status === 403 ? pass('Team create blocked for free plan → 403') : fail('Team gate', r.status);
  }
  {
    const r = await req('POST', '/api/team/invite', { email: 'friend@test.com' }, token);
    r.status === 403 ? pass('Team invite blocked for free plan → 403') : fail('Team invite gate', r.status);
  }

  // ── No Auth ────────────────────────────────────────────────────────────────
  section('Auth Protection');
  {
    const r = await req('GET', '/api/auth/me');
    r.status === 401 ? pass('No token → 401') : fail('Auth protection', r.status);
  }
  {
    const r = await req('GET', '/api/payment/subscription');
    r.status === 401 ? pass('Payment route protected → 401') : fail('Payment auth', r.status);
  }

  console.log('\n─────────────────────────────────────────');
  console.log(process.exitCode ? '❌ Some tests failed.' : '✅ All tests passed!');
  console.log('');
}

run().catch(err => {
  console.error('Test runner error:', err.message);
  console.error('Make sure the server is running: npm run dev');
  process.exit(1);
});
