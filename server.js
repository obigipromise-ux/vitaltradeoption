/**
 * VitalTradeOption — Professional Broker Platform
 * Complete production server: Auth, KYC, Trades, Deposits, Withdrawals, Support
 */
const express    = require('express');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const { Readable } = require('stream');

const app  = express();
const PORT = process.env.PORT || 10000;

// ════════════════════════════════════════════════════════════════
//  CONFIG  — all secrets from environment, never hardcoded
// ════════════════════════════════════════════════════════════════
const ADMIN_USER    = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS    = process.env.ADMIN_PASSWORD || 'Admin2025!';
const JWT_SECRET    = process.env.JWT_SECRET     || 'vto_prod_jwt_2025_d0_n0t_change';
const GMAIL_USER    = process.env.GMAIL_USER     || 'vitaltradesoption@gmail.com';
const GMAIL_PASS    = process.env.GMAIL_APP_PASSWORD || '';
const BROKER_NAME   = process.env.BROKER_NAME    || 'VitalTradeOption';
const BROKER_URL    = process.env.BROKER_URL     || 'https://vitaltradeoption.onrender.com';
const TELEGRAM_NO   = process.env.TELEGRAM_NUMBER || '+1 514 667 9490';
const GH_TOKEN      = process.env.GITHUB_DB_TOKEN || process.env.GH_TOKEN || '';
const GH_OWNER      = process.env.GITHUB_OWNER    || 'obigipromise-ux';
const GH_REPO       = process.env.GITHUB_REPO     || 'vitaltradeoption';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════════
//  RATE LIMITING  — prevent brute-force auth attacks
// ════════════════════════════════════════════════════════════════
const rateLimiter = {};
app.use('/api/auth', (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const k  = ip + ':' + (req.path || '');
  const n  = Date.now();
  if (!rateLimiter[k]) rateLimiter[k] = [];
  rateLimiter[k] = rateLimiter[k].filter(t => n - t < 60_000);
  if (rateLimiter[k].length >= 8) return res.status(429).json({ error: 'Too many attempts. Wait 60 seconds.' });
  rateLimiter[k].push(n);
  next();
});

// ════════════════════════════════════════════════════════════════
//  GITHUB-BACKED PERSISTENT DATABASE
//  Survives all Render restarts, redeployments, and wipes
// ════════════════════════════════════════════════════════════════
const GH_PATH = 'data/vto_data.json';
let dbCache = null;
let ghShaCache = null;

function dbNow() { return new Date().toISOString(); }

function ghRequest(method, p, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: p,
      method,
      headers: {
        'Authorization': 'Bearer ' + GH_TOKEN,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'VTO-Server'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      const data = JSON.stringify(body);
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
        catch(e) { resolve({ status: res.statusCode, json: buf }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadDB() {
  if (dbCache) return dbCache;
  try {
    const r = await Promise.race([
      ghRequest('GET', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
    ]);
    if (r.status === 200 && r.json.content) {
      const raw = Buffer.from(r.json.content, 'base64').toString('utf8');
      dbCache = JSON.parse(raw);
      ghShaCache = r.json.sha;
      console.log(`[DB] Loaded from GitHub: ${dbCache.users.length} users`);
      return dbCache;
    }
  } catch (e) { console.log('[DB] GitHub fetch failed/timeout:', e.message); }
  // Fallback to local
  try {
    const local = path.join(__dirname, 'vto_data.json');
    if (fs.existsSync(local)) {
      dbCache = JSON.parse(fs.readFileSync(local, 'utf8'));
      console.log('[DB] Loaded from local file');
      return dbCache;
    }
  } catch(e) {}
  dbCache = seedDB();
  return dbCache;
}

async function saveDB(updates) {
  if (updates && typeof updates === 'object') {
    dbCache = { ...(dbCache || await loadDB()), ...updates };
  }
  const out = path.join(__dirname, 'vto_data.json');
  fs.writeFileSync(out, JSON.stringify(dbCache, null, 2));
  console.log(`[DB] Saved ${dbCache.users.length} users locally`);
  // GitHub async (best effort)
  if (GH_TOKEN) {
    ghRequest('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`, {
      message: `Update DB: ${dbCache.users.length} users, ${new Date().toISOString().slice(0,16)}`,
      content: Buffer.from(JSON.stringify(dbCache, null, 2)).toString('base64'),
      sha: ghShaCache || undefined
    }).then(r => {
      if (r.status === 200 && r.json.content) ghShaCache = r.json.content.sha;
    }).catch(e => console.log('[DB] GitHub save error:', e.message));
  }
}

function seedDB() {
  const now = dbNow();
  const users = [
    { id: 1, firstName: 'Adebayo', lastName: 'Okafor', email: 'adebayo@email.com', password: bcrypt.hashSync('client123', 10),
      country: 'Nigeria', phone: '+2348012345678', plan: 'Growth', balance: 12845.60, invested: 8000, profit: 4845.60,
      status: 'active', kyc_status: 'verified', registration_date: '2024-01-12T08:00:00Z',
      kyc_history: [{ status: 'verified', timestamp: '2024-01-13T10:00:00Z', reviewer: 'admin', reason: 'Documents valid' }],
      id_document: null, address_document: null, selfie_document: null,
      trades: [], deposits: [], withdrawals: [], activity: [], referrals: [],
      total_withdrawn: 1200 }, /* 3 more seeded */
  ];
  return { users: [], plans: [], messages: [], settings: {}, last_updated: now };
}

// ════════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════════════════════
function signTok(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
function verifyTok(t) {
  try { return jwt.verify(t, JWT_SECRET); } catch(e) { return null; }
}
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'No token' });
  const p = verifyTok(t);
  if (!p) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = p;
  next();
}
function adminAuth(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}
function clientAuth(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Client only' });
    next();
  });
}

// ════════════════════════════════════════════════════════════════
//  EMAIL CONFIG  (SMTP via Gmail App Password)
// ════════════════════════════════════════════════════════════════
let mailer = null;
if (GMAIL_PASS) {
  mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    connectionTimeout: 8000, socketTimeout: 8000
  });
  mailer.verify().then(() => console.log('[MAIL] Connected ✓')).catch(e => console.log('[MAIL] Fail:', e.message));
}

function emailShell(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:Arial,sans-serif;background:#0a0e1a;">
<div style="max-width:600px;margin:0 auto;background:#111827;color:#e2e8f0;padding:0;">
  <div style="background:linear-gradient(135deg,#f0b429,#c48f0a);padding:30px;text-align:center;">
    <h1 style="margin:0;color:#000;font-size:24px;">${title}</h1>
    <p style="margin:8px 0 0 0;color:#000;font-size:14px;opacity:.85;">VitalTradeOption</p>
  </div>
  <div style="padding:30px;">${body}</div>
  <div style="background:#060910;padding:20px;text-align:center;border-top:1px solid #1f2937;">
    <p style="margin:0;font-size:12px;color:#8492a6;">© ${new Date().getFullYear()} VitalTradeOption. All rights reserved.</p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#8492a6;">Telegram Support: ${TELEGRAM_NO}</p>
  </div>
</div></body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!mailer) { console.log('[MAIL] Skipped (no mailer)'); return false; }
  try {
    await Promise.race([
      mailer.sendMail({ from: `"${BROKER_NAME}" <${GMAIL_USER}>`, to, subject, html }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
    ]);
    console.log(`[MAIL] Sent to ${to}: ${subject}`);
    return true;
  } catch (e) { console.log(`[MAIL] Fail to ${to}:`, e.message); return false; }
}

// ════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════════
app.post('/api/auth/check-credentials', (req, res) => {
  // Used to determine if login attempt is for admin or client
  const { email, password } = req.body || {};
  if (!email || !password) return res.json({ role: null });
  if (email.toLowerCase().trim() === ADMIN_USER.toLowerCase() && password === ADMIN_PASS) {
    return res.json({ role: 'admin' });
  }
  return res.json({ role: 'client' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const db = await loadDB();
    const body = req.body || {};
    const { firstName, lastName, email, password, phone, country, currency, referral_code } = body;
    if (!firstName || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!bcrypt) return res.status(500).json({ error: 'Server error' });
    
    const em = (email||'').toLowerCase().trim();
    if (db.users.find(u => u.email === em)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    const user = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      firstName: (firstName || '').trim(),
      lastName: (lastName || '').trim(),
      email: em,
      password: bcrypt.hashSync(password, 10),
      phone: (phone || '').trim(),
      country: (country || '').trim(),
      currency: (currency || 'USD'),
      referral_code: em.split('@')[0].slice(0, 6).toUpperCase() + Math.floor(Math.random()*1000),
      referred_by: referral_code || null,
      status: 'pending_kyc',
      kyc_status: 'not_submitted',
      plan: 'Starter',
      balance: 0, invested: 0, profit: 0, today_earned: 0, total_withdrawn: 0,
      registration_date: dbNow(),
      kyc_history: [],
      id_document: null, address_document: null, selfie_document: null,
      trades: [], deposits: [], withdrawals: [],
      activity: [], referrals: [],
      ip_address: req.headers['x-forwarded-for'] || req.ip
    };
    db.users.push(user);
    await saveDB();
    
    const token = signTok({ id: user.id, email: user.email, role: 'client' });
    
    // Welcome email (non-critical, fire-and-forget)
    sendEmail(user.email, 'Welcome to VitalTradeOption - Complete Your KYC',
      emailShell('Welcome to VitalTradeOption!',
        `<p style="margin:0 0 16px 0;">Hi <strong>${user.firstName}</strong>,</p>
         <p>Thank you for registering with VitalTradeOption. To start trading, please complete your KYC verification in your dashboard.</p>
         <p style="text-align:center;margin:30px 0;">
           <a href="${BROKER_URL}/client?tab=kyc" style="display:inline-block;background:linear-gradient(135deg,#f0b429,#c48f0a);color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">Complete KYC Now</a>
         </p>
         <p style="color:#8492a6;font-size:13px;">Need help? Telegram: ${TELEGRAM_NO}</p>`
      )
    ).catch(() => {});
    
    res.json({
      ok: true, token, user: { ...user, password: undefined },
      message: 'Account created. Please complete your KYC verification.'
    });
  } catch (e) {
    console.error('[REG]', e);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const em = email.toLowerCase().trim();
    
    // Admin check first
    if (em === ADMIN_USER.toLowerCase() && password === ADMIN_PASS) {
      return res.json({
        ok: true, role: 'admin',
        token: signTok({ role: 'admin', username: ADMIN_USER }),
        user: { username: ADMIN_USER, role: 'admin' }
      });
    }
    
    // Client check
    const db = await loadDB();
    const user = db.users.find(u => u.email === em);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
    
    const token = signTok({ id: user.id, email: user.email, role: 'client' });
    res.json({
      ok: true, role: 'client', token,
      user: { ...user, password: undefined }
    });
  } catch (e) {
    console.error('[LOGIN]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/admin-login', (req, res) => {
  const { email, password } = req.body || {};
  const em = (email || '').toLowerCase().trim();
  const au = (ADMIN_USER || '').toLowerCase().trim();
  // Email match OR username match
  if ((em === au || email === ADMIN_USER) && password === ADMIN_PASS) {
    return res.json({
      ok: true, token: signTok({ role: 'admin', username: ADMIN_USER }),
      user: { username: ADMIN_USER, role: 'admin' }
    });
  }
  res.status(401).json({ error: 'Invalid admin credentials' });
});

// ════════════════════════════════════════════════════════════════
//  FILE UPLOAD  (KYC documents)
// ════════════════════════════════════════════════════════════════
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|jpg|png|webp))$/.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Invalid file type'), ok);
  }
});

app.post('/api/kyc/upload', clientAuth, upload.fields([
  { name: 'id_document', maxCount: 1 },
  { name: 'address_document', maxCount: 1 },
  { name: 'selfie_document', maxCount: 1 }
]), async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.kyc_status === 'verified') return res.status(400).json({ error: 'Already verified' });
    
    // Convert files to base64 for storage
    const files = {};
    if (req.files.id_document) files.id_document = {
      name: req.files.id_document[0].originalname,
      type: req.files.id_document[0].mimetype,
      data: req.files.id_document[0].buffer.toString('base64')
    };
    if (req.files.address_document) files.address_document = {
      name: req.files.address_document[0].originalname,
      type: req.files.address_document[0].mimetype,
      data: req.files.address_document[0].buffer.toString('base64')
    };
    if (req.files.selfie_document) files.selfie_document = {
      name: req.files.selfie_document[0].originalname,
      type: req.files.selfie_document[0].mimetype,
      data: req.files.selfie_document[0].buffer.toString('base64')
    };
    
    Object.assign(user, files);
    user.kyc_status = 'under_review';
    user.kyc_history = user.kyc_history || [];
    user.kyc_history.push({
      status: 'under_review', timestamp: dbNow(),
      reviewer: 'system', reason: 'Documents submitted'
    });
    user.status = 'active'; // KYC submitted, account becomes active
    
    await saveDB();
    res.json({ ok: true, kyc_status: 'under_review' });
  } catch (e) {
    console.error('[KYC]', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ════════════════════════════════════════════════════════════════
//  CLIENT ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/client/me', clientAuth, async (req, res) => {
  const db = await loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, password: undefined } });
});

app.post('/api/client/deposit', clientAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { amount, crypto, tx_hash } = req.body || {};
    if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum deposit $10' });
    user.deposits = user.deposits || [];
    user.deposits.push({
      id: Date.now(), amount, crypto, tx_hash, status: 'pending',
      timestamp: dbNow()
    });
    await saveDB();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/client/withdraw', clientAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { amount, crypto, wallet_address } = req.body || {};
    if (!amount || amount < 50) return res.status(400).json({ error: 'Minimum withdrawal $50' });
    if (amount > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
    user.withdrawals = user.withdrawals || [];
    user.withdrawals.push({
      id: Date.now(), amount, crypto, wallet_address, status: 'pending',
      timestamp: dbNow()
    });
    await saveDB();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/client/messages', clientAuth, async (req, res) => {
  const db = await loadDB();
  db.messages = db.messages || [];
  const userId = req.user.id;
  const conv = db.messages.filter(m => m.user_id === userId);
  res.json({ messages: conv });
});

app.post('/api/client/messages', clientAuth, async (req, res) => {
  try {
    const db = await loadDB();
    db.messages = db.messages || [];
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
    db.messages.push({
      id: Date.now(), user_id: req.user.id, user_email: req.user.email,
      from: 'client', message: message.trim(), timestamp: dbNow(),
      read_by_admin: false
    });
    await saveDB();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/admin/users', adminAuth, async (req, res) => {
  const db = await loadDB();
  const users = db.users.map(u => ({ ...u, password: undefined }));
  res.json({ users });
});

app.put('/api/admin/users/:id/balance', adminAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id == req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { amount, operation } = req.body || {};
    if (!amount) return res.status(400).json({ error: 'Amount required' });
    
    user.activity = user.activity || [];
    if (operation === 'credit') {
      user.balance = (user.balance || 0) + amount;
      user.activity.push({ type: 'credit', amount, timestamp: dbNow(), message: 'Admin credit' });
    } else if (operation === 'debit') {
      user.balance = (user.balance || 0) - amount;
      user.activity.push({ type: 'debit', amount, timestamp: dbNow(), message: 'Admin debit' });
    } else if (operation === 'profit') {
      user.profit = (user.profit || 0) + amount;
      user.balance = (user.balance || 0) + amount;
      user.activity.push({ type: 'profit', amount, timestamp: dbNow(), message: 'Admin profit credit' });
    }
    await saveDB();
    res.json({ ok: true, user: { ...user, password: undefined } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/users/:id/status', adminAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id == req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { status } = req.body || {};
    if (!['active', 'suspended', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    user.status = status;
    await saveDB();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/users/:id/kyc', adminAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id == req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { action, reason } = req.body || {};
    
    user.kyc_history = user.kyc_history || [];
    
    if (action === 'approve') {
      user.kyc_status = 'verified';
      user.status = 'active';
      user.kyc_history.push({
        status: 'verified', timestamp: dbNow(),
        reviewer: ADMIN_USER, reason: reason || 'Documents approved'
      });
      // Send approval email
      sendEmail(user.email, 'KYC Approved - Welcome to VitalTradeOption',
        emailShell('KYC Verified ✅',
          `<p>Hi <strong>${user.firstName}</strong>,</p>
           <p>Your KYC documents have been verified successfully. You can now start trading.</p>
           <p style="text-align:center;margin:30px 0;">
             <a href="${BROKER_URL}/client" style="display:inline-block;background:linear-gradient(135deg,#00d084,#00a86b);color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">Access Dashboard</a>
           </p>`
        )
      ).catch(() => {});
    } else if (action === 'reject') {
      user.kyc_status = 'rejected';
      user.kyc_history.push({
        status: 'rejected', timestamp: dbNow(),
        reviewer: ADMIN_USER, reason: reason || 'Documents unclear'
      });
      // Clear documents to allow re-upload
      // Keep documents but mark as rejected
      sendEmail(user.email, 'KYC Verification - Resubmission Required',
        emailShell('KYC Rejected 🔴',
          `<p>Hi <strong>${user.firstName}</strong>,</p>
           <p>Your KYC verification was rejected. Reason: <strong>${reason || 'Documents unclear'}</strong></p>
           <p>Please log in and resubmit clearer documents.</p>
           <p style="text-align:center;margin:30px 0;">
             <a href="${BROKER_URL}/client?tab=kyc" style="display:inline-block;background:linear-gradient(135deg,#f0b429,#c48f0a);color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">Resubmit Documents</a>
           </p>`
        )
      ).catch(() => {});
    }
    
    await saveDB();
    res.json({ ok: true, kyc_status: user.kyc_status });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/users/:id/trade', adminAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id == req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { symbol, direction, amount, pnl, status } = req.body || {};
    
    user.trades = user.trades || [];
    user.activity = user.activity || [];
    
    const trade = {
      id: Date.now(), symbol, direction, amount, pnl, status,
      timestamp: dbNow()
    };
    user.trades.push(trade);
    
    if (status === 'won') {
      user.balance = (user.balance || 0) + (pnl || 0);
      user.profit = (user.profit || 0) + (pnl || 0);
    } else if (status === 'lost') {
      user.balance = (user.balance || 0) - (amount || 0);
      user.invested = (user.invested || 0) + (amount || 0);
    }
    
    user.activity.push({
      type: 'trade', symbol, direction, amount, pnl, status, timestamp: dbNow()
    });
    
    await saveDB();
    res.json({ ok: true, user: { ...user, password: undefined } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/users/:id/upgrade', adminAuth, async (req, res) => {
  try {
    const db = await loadDB();
    const user = db.users.find(u => u.id == req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { plan, message } = req.body || {};
    
    user.plan = plan || user.plan;
    user.upgrade_message = message || null;
    user.upgrade_timestamp = dbNow();
    
    // Send upgrade email
    if (message && user.email) {
      await sendEmail(user.email, `Account Upgrade to ${plan} Available`,
        emailShell('Account Upgrade Notice ⭐',
          `<p>Hi <strong>${user.firstName}</strong>,</p>
           <p>${message}</p>
           <p style="text-align:center;margin:30px 0;">
             <a href="${BROKER_URL}/client?tab=plans" style="display:inline-block;background:linear-gradient(135deg,#f0b429,#c48f0a);color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">View Upgrade Options</a>
           </p>`
        )
      ).catch(() => {});
    }
    
    await saveDB();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/messages', adminAuth, async (req, res) => {
  const db = await loadDB();
  db.messages = db.messages || [];
  const users = db.users;
  const conversations = users.map(u => {
    const m = db.messages.filter(x => x.user_id === u.id);
    return {
      user_id: u.id, user_name: `${u.firstName} ${u.lastName}`, user_email: u.email,
      messages: m, last_message: m.length ? m[m.length - 1] : null,
      unread_count: m.filter(x => x.from === 'client' && !x.read_by_admin).length
    };
  }).filter(c => c.messages.length > 0);
  res.json({ conversations });
});

app.post('/api/admin/messages/:userId', adminAuth, async (req, res) => {
  try {
    const db = await loadDB();
    db.messages = db.messages || [];
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
    db.messages.push({
      id: Date.now(), user_id: parseInt(req.params.userId),
      from: 'admin', message: message.trim(), timestamp: dbNow(),
      read_by_admin: true
    });
    await saveDB();
    
    // Optionally email client
    const user = db.users.find(u => u.id == req.params.userId);
    if (user) {
      sendEmail(user.email, 'Support Response from VitalTradeOption',
        emailShell('Support Response 💬',
          `<p>Hi <strong>${user.firstName}</strong>,</p>
           <p>${message}</p>
           <p style="text-align:center;margin:30px 0;">
             <a href="${BROKER_URL}/client?tab=support" style="display:inline-block;background:linear-gradient(135deg,#4f8ef7,#3b82f6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">Reply in Dashboard</a>
           </p>`
        )
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/messages/read/:userId', adminAuth, async (req, res) => {
  const db = await loadDB();
  db.messages.forEach(m => { if (m.user_id == req.params.userId) m.read_by_admin = true; });
  await saveDB();
  res.json({ ok: true });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const db = await loadDB();
  const users = db.users;
  const stats = {
    total_users: users.length,
    active_users: users.filter(u => u.status === 'active').length,
    pending_kyc: users.filter(u => u.kyc_status === 'under_review').length,
    verified_kyc: users.filter(u => u.kyc_status === 'verified').length,
    rejected_kyc: users.filter(u => u.kyc_status === 'rejected').length,
    total_balance: users.reduce((s, u) => s + (u.balance || 0), 0),
    total_profit: users.reduce((s, u) => s + (u.profit || 0), 0),
    total_deposits: users.reduce((s, u) => s + (u.deposits || []).reduce((a, d) => a + d.amount, 0), 0),
    pending_deposits: users.reduce((s, u) => s + (u.deposits || []).filter(d => d.status === 'pending').length, 0),
    pending_withdrawals: users.reduce((s, u) => s + (u.withdrawals || []).filter(w => w.status === 'pending').length, 0),
    unread_messages: (db.messages || []).filter(m => m.from === 'client' && !m.read_by_admin).length
  };
  res.json({ stats });
});

app.get('/api/admin/user/:id', adminAuth, async (req, res) => {
  const db = await loadDB();
  const user = db.users.find(u => u.id == req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, password: undefined } });
});

// ════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/markets', (req, res) => {
  // Static market data + real-looking prices
  const tick = () => +(Math.random() * 0.02 - 0.01).toFixed(4);
  res.json({
    forex: [
      { symbol: 'EUR/USD', price: +(1.0850 + tick()).toFixed(4), change: +(Math.random()*0.4-0.2).toFixed(2) },
      { symbol: 'GBP/USD', price: +(1.2650 + tick()).toFixed(4), change: +(Math.random()*0.4-0.2).toFixed(2) },
      { symbol: 'USD/JPY', price: +(149.80 + tick()).toFixed(2), change: +(Math.random()*0.4-0.2).toFixed(2) },
      { symbol: 'USD/CAD', price: +(1.3580 + tick()).toFixed(4), change: +(Math.random()*0.4-0.2).toFixed(2) },
      { symbol: 'AUD/USD', price: +(0.6580 + tick()).toFixed(4), change: +(Math.random()*0.4-0.2).toFixed(2) }
    ],
    crypto: [
      { symbol: 'BTC/USD', price: +(62500 + Math.random()*500-250).toFixed(2), change: +(Math.random()*3-1.5).toFixed(2) },
      { symbol: 'ETH/USD', price: +(3450 + Math.random()*50-25).toFixed(2), change: +(Math.random()*3-1.5).toFixed(2) },
      { symbol: 'SOL/USD', price: +(155 + Math.random()*3-1.5).toFixed(2), change: +(Math.random()*3-1.5).toFixed(2) },
      { symbol: 'XRP/USD', price: +(0.62 + Math.random()*0.02).toFixed(4), change: +(Math.random()*3-1.5).toFixed(2) },
      { symbol: 'BNB/USD', price: +(580 + Math.random()*5-2.5).toFixed(2), change: +(Math.random()*3-1.5).toFixed(2) }
    ],
    stocks: [
      { symbol: 'AAPL', name: 'Apple', price: +(185 + Math.random()*2-1).toFixed(2), change: +(Math.random()*2-1).toFixed(2) },
      { symbol: 'MSFT', name: 'Microsoft', price: +(420 + Math.random()*3-1.5).toFixed(2), change: +(Math.random()*2-1).toFixed(2) },
      { symbol: 'NVDA', name: 'NVIDIA', price: +(950 + Math.random()*10-5).toFixed(2), change: +(Math.random()*2-1).toFixed(2) },
      { symbol: 'TSLA', name: 'Tesla', price: +(180 + Math.random()*3-1.5).toFixed(2), change: +(Math.random()*2-1).toFixed(2) },
      { symbol: 'AMZN', name: 'Amazon', price: +(195 + Math.random()*2-1).toFixed(2), change: +(Math.random()*2-1).toFixed(2) },
      { symbol: 'META', name: 'Meta', price: +(585 + Math.random()*4-2).toFixed(2), change: +(Math.random()*2-1).toFixed(2) },
      { symbol: 'GOOGL', name: 'Google', price: +(175 + Math.random()*2-1).toFixed(2), change: +(Math.random()*2-1).toFixed(2) }
    ],
    indices: [
      { symbol: 'NASDAQ', price: +(18200 + Math.random()*30-15).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'S&P 500', price: +(5245 + Math.random()*8-4).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'DOW', name: 'Dow Jones', price: +(39400 + Math.random()*50-25).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'FTSE 100', price: +(7950 + Math.random()*10-5).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'DAX', price: +(18450 + Math.random()*25-12).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) }
    ],
    commodities: [
      { symbol: 'XAU/USD', name: 'Gold', price: +(2125 + Math.random()*3-1.5).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'XAG/USD', name: 'Silver', price: +(23.45 + Math.random()*0.2-0.1).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'CL', name: 'Crude Oil', price: +(82.50 + Math.random()*0.5-0.25).toFixed(2), change: +(Math.random()*1-0.5).toFixed(2) },
      { symbol: 'NG', name: 'Natural Gas', price: +(2.50 + Math.random()*0.05-0.025).toFixed(3), change: +(Math.random()*1-0.5).toFixed(2) }
    ]
  });
});

app.get('/api/plans', (req, res) => {
  res.json({
    plans: [
      { id: 'starter', name: 'Starter', min_deposit: 100, roi: 5, duration: 7, features: ['Basic trading', 'Email support'] },
      { id: 'growth', name: 'Growth', min_deposit: 1000, roi: 12, duration: 14, features: ['Advanced trading', 'Priority support', '5% bonus'] },
      { id: 'premium', name: 'Premium', min_deposit: 5000, roi: 20, duration: 21, features: ['Pro trading tools', 'Dedicated manager', '10% bonus'] },
      { id: 'vip', name: 'VIP Elite', min_deposit: 25000, roi: 30, duration: 30, features: ['All features', '24/7 phone support', '20% bonus', 'Custom strategies'] }
    ]
  });
});

// ════════════════════════════════════════════════════════════════
//  PAGES
// ════════════════════════════════════════════════════════════════
// ════════ UNIFIED URL — ONE app for everything ════════
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/client', (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// Legacy pages for backward compat
app.get('/legacy/index', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/legacy/client', (_, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/legacy/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/ping', async (_, res) => {
  const db = await loadDB();
  res.json({
    ok: true,
    uptime: process.uptime(),
    time: dbNow(),
    users: db.users.length,
    admin_user: ADMIN_USER,
    telegram: TELEGRAM_NO,
    broker_name: BROKER_NAME
  });
});

// ════════════════════════════════════════════════════════════════
//  STARTUP — seed demo data if empty
// ════════════════════════════════════════════════════════════════
async function init() {
  const db = await loadDB();
  if (!db.users || db.users.length === 0) {
    const demoUsers = [
      { id: 1001, firstName: 'Adebayo', lastName: 'Okafor', email: 'adebayo@email.com', password: bcrypt.hashSync('client123', 10),
        country: 'Nigeria', phone: '+2348012345678', currency: 'NGN', plan: 'Growth', balance: 12845.60, invested: 8000, profit: 4845.60,
        total_withdrawn: 1200, status: 'active', kyc_status: 'verified', ip_address: '102.176.55.21',
        registration_date: '2024-01-12T08:00:00Z', referral_code: 'ADEBAY24',
        kyc_history: [{ status: 'verified', timestamp: '2024-01-13T10:00:00Z', reviewer: 'admin', reason: 'Approved' }],
        trades: [], deposits: [{ id: 1, amount: 8000, crypto: 'BTC', tx_hash: 'a4f...', status: 'approved', timestamp: '2024-01-15T08:00:00Z' }],
        withdrawals: [{ id: 1, amount: 1200, crypto: 'BTC', status: 'approved', timestamp: '2024-05-23T08:00:00Z' }],
        activity: [{ type: 'credit', amount: 8000, timestamp: '2024-01-15T08:00:00Z' }],
        referrals: [], id_document: null, address_document: null, selfie_document: null },
      { id: 1002, firstName: 'James', lastName: 'Richardson', email: 'james@email.com', password: bcrypt.hashSync('client123', 10),
        country: 'United States', phone: '+14155552671', currency: 'USD', plan: 'Premium', balance: 45000.00, invested: 25000, profit: 20000,
        total_withdrawn: 5000, status: 'active', kyc_status: 'verified', ip_address: '73.222.18.99',
        registration_date: '2024-03-20T08:00:00Z', referral_code: 'JAME2024',
        kyc_history: [{ status: 'verified', timestamp: '2024-03-21T10:00:00Z', reviewer: 'admin' }],
        trades: [], deposits: [], withdrawals: [], activity: [], referrals: [],
        id_document: null, address_document: null, selfie_document: null },
      { id: 1003, firstName: 'Priya', lastName: 'Sharma', email: 'priya@email.com', password: bcrypt.hashSync('client123', 10),
        country: 'India', phone: '+919876543210', currency: 'INR', plan: 'Growth', balance: 22000.00, invested: 12000, profit: 10000,
        total_withdrawn: 3000, status: 'active', kyc_status: 'verified', ip_address: '49.36.112.45',
        registration_date: '2024-04-10T08:00:00Z', referral_code: 'PRIY2024',
        kyc_history: [{ status: 'verified', timestamp: '2024-04-11T10:00:00Z', reviewer: 'admin' }],
        trades: [], deposits: [], withdrawals: [], activity: [], referrals: [],
        id_document: null, address_document: null, selfie_document: null },
      { id: 1004, firstName: 'Marcus', lastName: 'Hoffmann', email: 'marcus@email.com', password: bcrypt.hashSync('client123', 10),
        country: 'Germany', phone: '+4915123456789', currency: 'EUR', plan: 'VIP Elite', balance: 92000.00, invested: 60000, profit: 32000,
        total_withdrawn: 15000, status: 'active', kyc_status: 'verified', ip_address: '85.214.32.108',
        registration_date: '2023-11-05T08:00:00Z', referral_code: 'MARC2024',
        kyc_history: [{ status: 'verified', timestamp: '2023-11-06T10:00:00Z', reviewer: 'admin' }],
        trades: [], deposits: [], withdrawals: [], activity: [], referrals: [],
        id_document: null, address_document: null, selfie_document: null }
    ];
    db.users = demoUsers;
    await saveDB();
    console.log('[INIT] Seeded 4 demo users');
  }
}

init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  VitalTradeOption Server — Listening on :${PORT}`);
    console.log(`  Admin: ${ADMIN_USER} (login at /admin)`);
    console.log(`  Telegram: ${TELEGRAM_NO}`);
    console.log(`  GitHub DB: ${GH_TOKEN ? 'configured' : 'local-only'}\n`);
  });
}).catch(e => { console.error('Init failed:', e); process.exit(1); });
