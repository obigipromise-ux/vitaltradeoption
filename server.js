/**
 * VitalTradeOption — Professional Broker Platform v4.0
 * Persistent GitHub-backed database + Email + All admin features
 */
const express    = require('express');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const multer     = require('multer');
const os         = require('os');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 10000;

// ── Config ──────────────────────────────────────────────────────
const ADMIN_USER   = process.env.ADMIN_USERNAME    || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD    || 'Admin2025!';
const JWT_SECRET   = process.env.JWT_SECRET        || 'vto_secret_2025_fixed_key_do_not_change';
const GMAIL_USER   = process.env.GMAIL_USER        || 'vitaltradesoption@gmail.com';
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD || '';
const BROKER_NAME  = process.env.BROKER_NAME       || 'VitalTradeOption';
const BROKER_URL   = process.env.BROKER_URL        || 'https://vitaltradeoption.onrender.com';
const WHATSAPP_NO  = process.env.WHATSAPP_NUMBER   || '+12158924891';

const GH_OWNER     = 'obigipromise-ux';
const GH_REPO      = 'vitaltradeoption';
const GH_DB_FILE   = 'data/vto_data.json';
const LOCAL_DB     = path.join(__dirname, 'vto_data.json');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: os.tmpdir(), limits:{ fileSize: 12*1024*1024 } });

// ══════════════════════════════════════════════════════════════
//  GITHUB-BACKED PERSISTENT DATABASE
//  Data survives ALL Render restarts, redeployments and wipes
// ══════════════════════════════════════════════════════════════
let ghSha = null;  // cached GitHub file SHA for updates

function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
        'User-Agent':    'VitalTradeOption-Bot',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loadFromGitHub() {
  try {
    const r = await ghRequest('GET', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_DB_FILE}`);
    if (r.status === 200 && r.body.content) {
      ghSha = r.body.sha;
      const json = Buffer.from(r.body.content, 'base64').toString('utf8');
      return JSON.parse(json);
    }
  } catch (e) { console.error('[DB] GitHub load error:', e.message); }
  return null;
}

async function saveToGitHub(db) {
  if (!GH_TOKEN) return;
  try {
    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64');
    const payload = { message: 'DB update ' + new Date().toISOString(), content };
    if (ghSha) payload.sha = ghSha;
    const r = await ghRequest('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_DB_FILE}`, payload);
    if (r.status === 200 || r.status === 201) {
      ghSha = r.body.content?.sha || ghSha;
    }
  } catch (e) { console.error('[DB] GitHub save error:', e.message); }
}

function loadDB() {
  try {
    if (fs.existsSync(LOCAL_DB)) {
      const raw = fs.readFileSync(LOCAL_DB, 'utf8');
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (e) {}
  return { users:[], deposits:[], withdrawals:[], trades:[], messages:[], nextId:1 };
}

function saveDB(db) {
  try { fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 2)); } catch(e) {}
  saveToGitHub(db).catch(() => {});  // async — don't block response
}

function newId(db) { const id = db.nextId || 1; db.nextId = id + 1; return id; }
const now = () => new Date().toISOString();
const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } catch { return ''; } };

// ── Seed default demo data ────────────────────────────────────
function seed() {
  const db = loadDB();
  db.trades      = db.trades      || [];
  db.messages    = db.messages    || [];
  db.deposits    = db.deposits    || [];
  db.withdrawals = db.withdrawals || [];
  if (db.users.length > 0) { saveDB(db); return; }

  const h = p => bcrypt.hashSync(p, 10);
  const cG = [180,240,310,280,390,420,360,480,520,460,580,510,490,342];
  const cP = [600,820,780,950,1020,880,1100,1200,980,1150,1300,1080,1220,960];

  db.users = [
    { id:1,name:'Adebayo Okafor',  email:'adebayo@email.com',  password:h('client123'), plan:'Growth',   balance:12845.60, invested:8000,  profit:4845.60, withdrawn:1200,  today_earned:342,  roi:12,duration:14,days_left:9, cycle_day:5, trades_wins:32, trades_losses:15,trades_volume:24800, refs:8, ref_earned:240,ref_pending:60, ref_code:'ADE2024XYZ',status:'active',  kyc_status:'verified',  country:'Nigeria',phone:'+234 801 234 5678',joined:'Jan 12, 2024',initials:'A',chart_data:cG },
    { id:2,name:'Chidinma Eze',    email:'chidinma@email.com', password:h('client123'), plan:'Premium',  balance:28400,    invested:15000, profit:13400,   withdrawn:3200,  today_earned:960,  roi:20,duration:21,days_left:14,cycle_day:7, trades_wins:58, trades_losses:22,trades_volume:64000, refs:5, ref_earned:480,ref_pending:120,ref_code:'CHI2024ABC',status:'active',  kyc_status:'verified',  country:'Nigeria',phone:'+234 802 345 6789',joined:'Feb 3, 2024', initials:'C',chart_data:cP },
    { id:3,name:'Emmanuel Nwosu',  email:'emmanuel@email.com', password:h('client123'), plan:'VIP Elite',balance:92000,    invested:50000, profit:42000,   withdrawn:15000, today_earned:4200, roi:30,duration:30,days_left:22,cycle_day:8, trades_wins:120,trades_losses:38,trades_volume:210000,refs:14,ref_earned:1800,ref_pending:400,ref_code:'EMM2024VIP',status:'active',  kyc_status:'verified',  country:'Nigeria',phone:'+234 803 456 7890',joined:'Dec 20, 2023',initials:'E',chart_data:cP },
    { id:4,name:'Kwame Mensah',    email:'kwame@email.com',    password:h('client123'), plan:'Starter',  balance:1200,     invested:500,   profit:700,     withdrawn:0,     today_earned:25,   roi:5, duration:7, days_left:2, cycle_day:5, trades_wins:12, trades_losses:8, trades_volume:2400,  refs:3, ref_earned:45, ref_pending:15, ref_code:'KWA2024GH', status:'active',  kyc_status:'verified',  country:'Ghana',  phone:'+233 24 123 4567', joined:'Mar 8, 2024', initials:'K',chart_data:cG },
  ];
  db.trades = [
    { id:newId(db),user_id:1,instrument:'BTC/USD',direction:'UP',  amount:500, pnl:460, result:'win', duration:'5m', date:now() },
    { id:newId(db),user_id:1,instrument:'ETH/USD',direction:'DOWN',amount:300, pnl:300, result:'loss',duration:'1m', date:now() },
    { id:newId(db),user_id:2,instrument:'BTC/USD',direction:'UP',  amount:1000,pnl:920, result:'win', duration:'10m',date:now() },
  ];
  db.nextId = 20;
  saveDB(db);
  console.log('✅ Demo database seeded with', db.users.length, 'clients');
}

// ── Load from GitHub on startup, then seed if empty ─────────────
async function initDB() {
  console.log('[DB] Loading persistent database from GitHub…');
  const ghData = await loadFromGitHub();
  if (ghData && ghData.users) {
    fs.writeFileSync(LOCAL_DB, JSON.stringify(ghData, null, 2));
    console.log(`[DB] ✅ Loaded ${ghData.users.length} users from GitHub (persistent)`);
  } else {
    console.log('[DB] No GitHub data found — starting fresh');
  }
  seed();
}

// ══════════════════════════════════════════════════════════════
//  EMAIL SYSTEM
// ══════════════════════════════════════════════════════════════
let mailer = null;

function getMailer() {
  if (!GMAIL_PASS) {
    console.log('[EMAIL] ⚠️  GMAIL_APP_PASSWORD not set — emails will not send');
    return null;
  }
  if (!mailer) {
    // Try explicit SMTP settings for better Gmail compatibility
    mailer = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS.replace(/\s/g,''), // strip spaces from App Password
      },
      tls: { rejectUnauthorized: false },
    });
  }
  return mailer;
}

async function sendEmail(to, toName, subject, html) {
  const m = getMailer();
  if (!m) return false;
  const msg = {
    from:    `"${BROKER_NAME}" <${GMAIL_USER}>`,
    to:      `"${toName}" <${to}>`,
    subject,
    html,
  };
  try {
    const info = await m.sendMail(msg);
    console.log(`[EMAIL] ✅ Sent to ${to} | MessageId: ${info.messageId}`);
    return true;
  } catch(e) {
    console.error(`[EMAIL] ❌ Error to ${to}: ${e.message}`);
    mailer = null; // reset so it retries next time
    return false;
  }
}


// ── Email HTML builder ────────────────────────────────────────
const emailShell = content => `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
 body{margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;}
 .wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);}
 .hdr{background:linear-gradient(135deg,#0a0e1a,#111827);padding:26px 36px;text-align:center;}
 .logo{display:inline-flex;align-items:center;gap:10px;}
 .lic{width:40px;height:40px;background:linear-gradient(135deg,#f0b429,#c48f0a);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#000;}
 .ltn{font-size:1.15rem;font-weight:800;color:#fff;} .ltn span{color:#f0b429;}
 .tag{font-size:.72rem;color:#8492a6;margin-top:4px;}
 .body{padding:34px 36px 26px;}
 .hero{border-radius:11px;padding:22px;text-align:center;margin-bottom:22px;}
 .hero.gold{background:linear-gradient(135deg,#fefce8,#fef3c7);}
 .hero.green{background:linear-gradient(135deg,#f0fdf4,#dcfce7);}
 .hero.blue{background:linear-gradient(135deg,#eff6ff,#dbeafe);}
 .hero h2{font-size:1.2rem;font-weight:900;color:#111827;margin:10px 0 4px;}
 .hero p{font-size:.82rem;color:#6b7280;margin:0;}
 .btn{display:inline-block;padding:13px 32px;border-radius:9px;color:#000;font-weight:800;font-size:.92rem;text-decoration:none;margin:18px 0;}
 .btn.gold{background:linear-gradient(135deg,#f0b429,#c48f0a);}
 .btn.green{background:linear-gradient(135deg,#00d084,#00a86b);color:#fff;}
 .infobox{background:#f9fafb;border-radius:9px;padding:16px;margin:16px 0;}
 .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e5e7eb;font-size:.83rem;}
 .row:last-child{border-bottom:none;}
 .row span:first-child{color:#6b7280;} .row span:last-child{font-weight:600;color:#111827;}
 .warn{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;font-size:.78rem;color:#92400e;line-height:1.65;margin:16px 0;}
 p.bt{font-size:.84rem;color:#374151;line-height:1.75;margin-bottom:12px;}
 .wa{display:inline-flex;align-items:center;gap:7px;padding:10px 20px;background:#25D366;border-radius:8px;color:#fff;font-weight:700;font-size:.83rem;text-decoration:none;margin-top:10px;}
 .ftr{background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center;}
 .ftr p{font-size:.72rem;color:#9ca3af;line-height:1.7;margin:0;}
 .ftr a{color:#f0b429;text-decoration:none;}
 .step{display:flex;align-items:center;gap:12px;background:#f9fafb;border-radius:8px;padding:11px;margin-bottom:9px;}
 .sn{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#f0b429,#c48f0a);display:flex;align-items:center;justify-content:center;font-weight:900;color:#000;font-size:.82rem;flex-shrink:0;}
 .st h5{font-size:.83rem;font-weight:700;color:#111827;margin:0 0 2px;} .st p{font-size:.75rem;color:#6b7280;margin:0;}
</style></head><body><div class="wrap">
<div class="hdr"><div class="logo"><div class="lic">V</div><div class="ltn">Vital<span>Trade</span>Option</div></div><div class="tag">Professional Trading & Investment Platform</div></div>
<div class="body">${content}</div>
<div class="ftr"><p>© 2025 VitalTradeOption Ltd · All Rights Reserved<br/>
<a href="${BROKER_URL}">${BROKER_URL.replace('https://','')}</a> · 
<a href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">WhatsApp Support</a></p></div>
</div></body></html>`;

const emailVerify = (name, link) => emailShell(`
<div class="hero gold"><div style="font-size:2.5rem">📧</div><h2>Verify Your Email</h2><p>One click to activate your account</p></div>
<p class="bt">Dear <strong>${name}</strong>,</p>
<p class="bt">Welcome to <strong>VitalTradeOption</strong>! Please verify your email address to complete registration.</p>
<div style="text-align:center"><a class="btn gold" href="${link}">✅ Verify My Email Address</a></div>
<div class="infobox"><p style="font-size:.78rem;color:#6b7280;margin:0">Or copy this link into your browser:<br/><span style="color:#f0b429;word-break:break-all;font-size:.74rem">${link}</span></p></div>
<div class="warn">⏰ This link expires in 48 hours. Do not share it with anyone.</div>
<div style="text-align:center"><a class="wa" href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">💬 WhatsApp Support</a></div>`);

const emailApproved = name => emailShell(`
<div class="hero green"><div style="font-size:2.5rem">🎉</div><h2>Account Approved!</h2><p>You can now login and start trading</p></div>
<p class="bt">Dear <strong>${name}</strong>,</p>
<p class="bt">Your VitalTradeOption account has been reviewed and <strong style="color:#059669">approved</strong>. You can now login and start trading.</p>
<div style="text-align:center"><a class="btn gold" href="${BROKER_URL}/client">🚀 Login & Start Trading</a></div>
<div style="text-align:center"><a class="wa" href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">💬 WhatsApp Support</a></div>`);

const emailDepositOk = (name, amount, plan, daily) => emailShell(`
<div class="hero gold"><div style="font-size:2.5rem">✅</div><h2>Deposit Confirmed!</h2><p>Your funds are active and earning</p></div>
<p class="bt">Dear <strong>${name}</strong>,</p>
<p class="bt">Your deposit has been confirmed and your <strong>${plan}</strong> is now active.</p>
<div class="infobox">
  <div class="row"><span>Amount Deposited</span><span style="color:#d97706;font-weight:800">$${parseFloat(amount).toLocaleString()}</span></div>
  <div class="row"><span>Plan Activated</span><span>${plan}</span></div>
  <div class="row"><span>Daily Earnings</span><span style="color:#059669">+$${daily}/day</span></div>
  <div class="row"><span>Status</span><span style="color:#059669">✅ Active</span></div>
</div>
<div style="text-align:center"><a class="btn gold" href="${BROKER_URL}/client">📊 View My Dashboard</a></div>
<div style="text-align:center"><a class="wa" href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">💬 WhatsApp Support</a></div>`);

const emailUpgradeMsg = (name, msg, plan, amount) => emailShell(`
<div class="hero blue"><div style="font-size:2.5rem">🚀</div><h2>Account Upgrade Available!</h2><p>Unlock higher daily returns</p></div>
<p class="bt">Dear <strong>${name}</strong>,</p>
<p class="bt">${msg}</p>
${plan ? `<div class="infobox"><div class="row"><span>Upgrade Plan</span><span style="color:#2563eb;font-weight:800">${plan}</span></div>${amount ? `<div class="row"><span>Deposit Required</span><span style="color:#d97706;font-weight:800">$${parseFloat(amount).toLocaleString()}</span></div>` : ''}</div>` : ''}
<div style="text-align:center"><a class="btn gold" href="${BROKER_URL}/client">💰 Make Upgrade Deposit</a></div>
<div class="warn">⏰ Login → Dashboard → Deposit tab → Send the required amount.</div>
<div style="text-align:center"><a class="wa" href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">💬 WhatsApp Support</a></div>`);

const emailWithdrawMsg = (name, msg, balance) => emailShell(`
<div class="hero green"><div style="font-size:2.5rem">💸</div><h2>Your Profits Are Ready!</h2><p>Proceed to withdraw your earnings now</p></div>
<p class="bt">Dear <strong>${name}</strong>,</p>
<p class="bt">${msg}</p>
${balance ? `<div class="infobox"><div class="row"><span>Available Balance</span><span style="color:#059669;font-weight:800">$${parseFloat(balance).toLocaleString()}</span></div></div>` : ''}
<div style="text-align:center"><a class="btn green" href="${BROKER_URL}/client">💸 Withdraw Now</a></div>
<div class="warn">⏰ Please submit your withdrawal within 7 days. Go to Dashboard → Withdraw tab.</div>
<div style="text-align:center"><a class="wa" href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">💬 WhatsApp Support</a></div>`);

// ══════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ══════════════════════════════════════════════════════════════
const signTok  = p  => jwt.sign(p, JWT_SECRET, { expiresIn:'24h' });
const readTok  = req => { try { const t=(req.headers.authorization||'').replace('Bearer ','').trim(); return t?jwt.verify(t,JWT_SECRET):null; } catch{ return null; } };
const needC    = (req,res,next) => { const p=readTok(req); if(!p||p.role!=='client') return res.status(401).json({error:'Unauthorized'}); req.user=p; next(); };
const needA    = (req,res,next) => { const p=readTok(req); if(!p||p.role!=='admin')  return res.status(401).json({error:'Unauthorized'}); next(); };
const safe     = u  => { const {password,...s}=u; return s; };

// ══════════════════════════════════════════════════════════════
//  TEST EMAIL ENDPOINT (placed here so needA is already defined)
// ══════════════════════════════════════════════════════════════
app.post('/api/admin/test-email', needA, async (req,res) => {
  const {to} = req.body;
  const dest = to || GMAIL_USER;
  const html = `<div style="font-family:sans-serif;padding:20px;max-width:500px;margin:0 auto;background:#f9fafb;border-radius:12px;">
    <h2 style="color:#059669;">✅ Email is working!</h2>
    <p>This test email was sent by <strong>${BROKER_NAME}</strong>.</p>
    <p>SMTP: smtp.gmail.com:587 | From: ${GMAIL_USER}</p>
    <p style="color:#6b7280;font-size:.85rem;">If you see this, email delivery is correctly configured.</p>
  </div>`;
  const ok = await sendEmail(dest, 'Admin', `Test — ${BROKER_NAME} email system`, html);
  res.json({ ok, message: ok ? 'Test email sent to ' + dest : 'Email failed — check GMAIL_APP_PASSWORD in Render env vars' });
});

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// ADMIN LOGIN
app.post('/api/auth/admin', (req,res) => {
  const {username,password} = req.body||{};
  if (!username||!password) return res.status(400).json({error:'Username and password required'});
  if (username.trim().toLowerCase()!==ADMIN_USER.toLowerCase()||password!==ADMIN_PASS)
    return res.status(401).json({error:'Invalid admin credentials'});
  res.json({ok:true, token: signTok({role:'admin',username:ADMIN_USER})});
});

// CLIENT REGISTER
app.post('/api/auth/register', (req,res) => {
  const {name,email,password,phone,country} = req.body||{};
  if (!name||!email||!password) return res.status(400).json({error:'Name, email and password are required'});
  if (password.length<6) return res.status(400).json({error:'Password must be at least 6 characters'});
  const em = email.toLowerCase().trim();
  const db = loadDB();
  if (db.users.find(u=>u.email===em)) return res.status(409).json({error:'An account with this email already exists'});

  const token = crypto.randomBytes(32).toString('hex');
  const user  = {
    id: newId(db), name:name.trim(), email:em,
    password: bcrypt.hashSync(password,10),
    plan:'Starter', balance:0, invested:0, profit:0, withdrawn:0, today_earned:0,
    roi:5, duration:7, days_left:7, cycle_day:0,
    trades_wins:0, trades_losses:0, trades_volume:0,
    refs:0, ref_earned:0, ref_pending:0,
    ref_code: name.replace(/\s/g,'').toUpperCase().slice(0,3)+Math.floor(Math.random()*9000+1000),
    status:'pending_verification', verification_token:token, verified_email:false,
    kyc_status:'not_submitted', kyc_docs:[],
    upgrade_message:null, withdrawal_ready:false, withdrawal_message:null,
    country:country||'', phone:phone||'',
    joined: fmtDate(now()), initials:name.trim()[0].toUpperCase(),
    chart_data:[0,0,0,0,0,0,0,0,0,0,0,0,0,0], created_at:now()
  };
  db.users.push(user);
  saveDB(db);

  const verifyLink = `${BROKER_URL}/verify/${token}`;
  sendEmail(em, name.trim(), `Verify your email — ${BROKER_NAME}`, emailVerify(name.trim(),verifyLink)).catch(()=>{});

  res.json({ ok:true, verify_link:verifyLink,
    message:`Account created! A verification email has been sent to ${em}. Please click the link to verify your account.` });
});

// CLIENT LOGIN
app.post('/api/auth/login', (req,res) => {
  const {email,password} = req.body||{};
  if (!email||!password) return res.status(400).json({error:'Email and password required'});
  const db   = loadDB();
  const user = db.users.find(u=>u.email===email.toLowerCase().trim());
  if (!user) return res.status(401).json({error:'Invalid email or password'});
  if (user.status==='pending_verification') return res.status(403).json({error:'verify_email', message:'Please verify your email first. Check your inbox for the verification link.'});
  if (user.status==='pending')    return res.status(403).json({error:'pending',   message:'Your account is pending admin approval. You will be notified once activated.'});
  if (user.status==='suspended')  return res.status(403).json({error:'suspended', message:'Your account has been suspended. Contact support.'});
  if (user.status==='rejected')   return res.status(403).json({error:'rejected',  message:'Your registration was not approved. Contact support.'});
  if (!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Invalid email or password'});
  const token = signTok({id:user.id, email:user.email, role:'client'});
  res.json({ok:true, token, user:safe(user)});
});

// EMAIL VERIFICATION CLICK — auto-activates account + redirects to main page
app.get('/verify/:token', (req,res) => {
  const db = loadDB();
  const i  = db.users.findIndex(u=>u.verification_token===req.params.token);
  if (i<0) {
    // Redirect to main page with error param
    return res.redirect(BROKER_URL + '?verify_error=1');
  }
  const name = db.users[i].name.split(' ')[0];
  db.users[i].status             = 'active';   // auto-approve on email verify
  db.users[i].verified_email     = true;
  db.users[i].verification_token = null;
  db.users[i].approved_at        = now();
  saveDB(db);
  // Send welcome email
  sendEmail(db.users[i].email, db.users[i].name,
    `Welcome to ${BROKER_NAME} — Your account is active!`,
    emailApproved(db.users[i].name)).catch(()=>{});
  // Redirect directly to main page with success param
  res.redirect(BROKER_URL + '?verified=1&name=' + encodeURIComponent(name));
});

function verifyPage(success, nameOrMsg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${BROKER_NAME}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',sans-serif;background:#060910;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
  .card{background:#111827;border:2px solid ${success?'rgba(0,208,132,.3)':'rgba(255,69,96,.3)'};border-radius:18px;padding:42px 36px;max-width:440px;text-align:center;animation:up .4s ease;}
  @keyframes up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  .ico{font-size:3.5rem;margin-bottom:14px;}
  h2{font-size:1.3rem;font-weight:900;color:${success?'#00d084':'#ff4560'};margin-bottom:10px;}
  p{font-size:.875rem;color:#8492a6;line-height:1.75;margin-bottom:18px;}
  .badge{background:rgba(240,180,41,.1);border:1px solid rgba(240,180,41,.25);border-radius:9px;padding:12px 16px;font-size:.82rem;color:#f0b429;margin-bottom:22px;line-height:1.6;}
  a.btn{display:inline-block;padding:13px 30px;background:linear-gradient(135deg,#f0b429,#c48f0a);border-radius:9px;color:#000;font-weight:800;text-decoration:none;font-size:.92rem;}
  a.wa{display:inline-flex;align-items:center;gap:7px;padding:10px 20px;background:#25D366;border-radius:8px;color:#fff;font-weight:700;font-size:.82rem;text-decoration:none;margin-top:12px;}</style></head>
  <body><div class="card">
  <div class="ico">${success?'✅':'❌'}</div>
  <h2>${success?`Email Verified, ${nameOrMsg}!`:'Verification Failed'}</h2>
  ${success
    ? `<p>Your email has been confirmed successfully.</p>
       <div class="badge">⏳ Your account is now <strong>pending admin review</strong>. Our team will activate your account shortly — you will be notified by email once approved.</div>
       <a class="btn" href="${BROKER_URL}">Go to VitalTradeOption</a><br/>
       <a class="wa" href="https://wa.me/${WHATSAPP_NO.replace(/[^0-9]/g,'')}">💬 WhatsApp Support</a>`
    : `<p>${nameOrMsg}</p><a class="btn" href="${BROKER_URL}">Back to Homepage</a>`}
  </div></body></html>`;
}

// RESEND VERIFICATION LINK
app.post('/api/auth/resend-verify', (req,res) => {
  const {email} = req.body||{};
  const db   = loadDB();
  const i    = db.users.findIndex(u=>u.email===email?.toLowerCase().trim());
  if (i<0) return res.status(404).json({error:'Email not found'});
  if (db.users[i].verified_email) return res.json({ok:true, message:'Email already verified'});
  const token = crypto.randomBytes(32).toString('hex');
  db.users[i].verification_token = token;
  saveDB(db);
  const link = `${BROKER_URL}/verify/${token}`;
  sendEmail(email, db.users[i].name, `Verify your email — ${BROKER_NAME}`, emailVerify(db.users[i].name,link)).catch(()=>{});
  res.json({ok:true, link, message:'Verification link sent'});
});

// ADMIN: Resend verification email
app.post('/api/admin/resend-verify/:id', needA, async (req,res) => {
  const db  = loadDB();
  const i   = db.users.findIndex(u=>u.id===parseInt(req.params.id));
  if (i<0) return res.status(404).json({error:'Not found'});
  const token = crypto.randomBytes(32).toString('hex');
  db.users[i].verification_token = token;
  saveDB(db);
  const link = BROKER_URL + '/verify/' + token;
  const sent = await sendEmail(db.users[i].email, db.users[i].name,
    `Verify your email — ${BROKER_NAME}`, emailVerify(db.users[i].name, link));
  res.json({ ok:true, sent, link, email: db.users[i].email });
});

// GET VERIFY LINK (admin only)
app.get('/api/admin/verify-link/:id', needA, (req,res) => {
  const db   = loadDB();
  const user = db.users.find(u=>u.id===parseInt(req.params.id));
  if (!user) return res.status(404).json({error:'Not found'});
  if (!user.verification_token) return res.json({link:null, verified:true});
  const link = `${BROKER_URL}/verify/${user.verification_token}`;
  res.json({link, email:user.email, name:user.name});
});

// ══════════════════════════════════════════════════════════════
//  CLIENT ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/client/me', needC, (req,res) => {
  const db=loadDB(); const u=db.users.find(x=>x.id===req.user.id);
  if(!u) return res.status(404).json({error:'Not found'});
  res.json(safe(u));
});

app.put('/api/client/profile', needC, (req,res) => {
  const db=loadDB(); const i=db.users.findIndex(x=>x.id===req.user.id); if(i<0) return res.status(404).json({error:'Not found'});
  ['name','phone','country'].forEach(f=>{ if(req.body[f]) db.users[i][f]=req.body[f]; });
  saveDB(db); res.json({ok:true});
});

app.put('/api/client/password', needC, (req,res) => {
  const {currentPassword,newPassword}=req.body;
  const db=loadDB(); const i=db.users.findIndex(x=>x.id===req.user.id); if(i<0) return res.status(404).json({error:'Not found'});
  if(!bcrypt.compareSync(currentPassword,db.users[i].password)) return res.status(401).json({error:'Current password is incorrect'});
  if(!newPassword||newPassword.length<6) return res.status(400).json({error:'New password must be at least 6 characters'});
  db.users[i].password=bcrypt.hashSync(newPassword,10); saveDB(db); res.json({ok:true});
});

app.get('/api/client/trades', needC, (req,res) => {
  const db=loadDB();
  res.json((db.trades||[]).filter(t=>t.user_id===req.user.id).sort((a,b)=>new Date(b.date)-new Date(a.date)));
});

app.post('/api/client/deposits', needC, (req,res) => {
  const {amount,method,tx_hash,plan,notes}=req.body;
  if(!amount||amount<50) return res.status(400).json({error:'Minimum deposit is $50'});
  const db=loadDB(); const user=db.users.find(x=>x.id===req.user.id);
  const dep={id:newId(db),user_id:user.id,user_email:user.email,user_name:user.name,amount,method,tx_hash,plan,notes,status:'pending',date:now()};
  db.deposits=db.deposits||[]; db.deposits.unshift(dep); saveDB(db); res.json({ok:true,id:dep.id});
});

app.get('/api/client/deposits', needC, (req,res) => {
  const db=loadDB(); res.json((db.deposits||[]).filter(d=>d.user_id===req.user.id));
});

app.post('/api/client/withdrawals', needC, (req,res) => {
  const {amount,method,wallet}=req.body;
  if(!amount||amount<20) return res.status(400).json({error:'Minimum withdrawal is $20'});
  const db=loadDB(); const user=db.users.find(x=>x.id===req.user.id);
  if(amount>user.balance) return res.status(400).json({error:'Insufficient balance'});
  const wd={id:newId(db),user_id:user.id,user_email:user.email,user_name:user.name,amount,method,wallet,status:'pending',date:now()};
  db.withdrawals=db.withdrawals||[]; db.withdrawals.unshift(wd); saveDB(db); res.json({ok:true,id:wd.id});
});

app.get('/api/client/withdrawals', needC, (req,res) => {
  const db=loadDB(); res.json((db.withdrawals||[]).filter(w=>w.user_id===req.user.id));
});

app.post('/api/client/kyc',
  (req,res,next)=>{ const p=readTok(req); if(!p||p.role!=='client') return res.status(401).json({error:'Unauthorized'}); req.user=p; next(); },
  upload.fields([{name:'kyc_id',maxCount:1},{name:'kyc_addr',maxCount:1},{name:'kyc_selfie',maxCount:1}]),
  (req,res)=>{
    const db=loadDB(); const i=db.users.findIndex(u=>u.id===req.user.id); if(i<0) return res.status(404).json({error:'Not found'});
    db.users[i].kyc_status     = 'pending';
    db.users[i].kyc_id_type    = req.body.kyc_id_type||'';
    db.users[i].kyc_id_number  = req.body.kyc_id_number||'';
    db.users[i].kyc_docs       = Object.values(req.files||{}).flat().map(f=>({name:f.originalname,size:f.size}));
    db.users[i].kyc_submitted_at = now();
    saveDB(db); res.json({ok:true});
  }
);

// Support chat
app.post('/api/client/support', needC, (req,res) => {
  const {message}=req.body; if(!message?.trim()) return res.status(400).json({error:'Message required'});
  const db=loadDB(); const user=db.users.find(x=>x.id===req.user.id);
  const msg={id:newId(db),user_id:user.id,user_email:user.email,user_name:user.name,sender:'client',message:message.trim(),read_admin:false,read_client:true,date:now()};
  db.messages=db.messages||[]; db.messages.push(msg); saveDB(db); res.json({ok:true});
});

app.get('/api/client/support', needC, (req,res) => {
  const db=loadDB();
  const msgs=(db.messages||[]).filter(m=>m.user_id===req.user.id).sort((a,b)=>new Date(a.date)-new Date(b.date));
  let changed=false; msgs.forEach(m=>{ if(m.sender==='admin'&&!m.read_client){m.read_client=true;changed=true;} }); if(changed)saveDB(db);
  res.json(msgs);
});

app.get('/api/client/support/unread', needC, (req,res) => {
  const db=loadDB(); res.json({count:(db.messages||[]).filter(m=>m.user_id===req.user.id&&m.sender==='admin'&&!m.read_client).length});
});

app.post('/api/client/dismiss-upgrade', needC, (req,res) => {
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===req.user.id);
  if(i>=0){db.users[i].upgrade_message=null; saveDB(db);} res.json({ok:true});
});

app.post('/api/client/dismiss-withdrawal', needC, (req,res) => {
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===req.user.id);
  if(i>=0){db.users[i].withdrawal_ready=false;db.users[i].withdrawal_message=null; saveDB(db);} res.json({ok:true});
});

// ══════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/stats', needA, (req,res) => {
  const db=loadDB();
  res.json({
    totalUsers:  db.users.length,
    active:      db.users.filter(u=>u.status==='active').length,
    pending:     db.users.filter(u=>u.status==='pending'||u.status==='pending_verification').length,
    pending_verification: db.users.filter(u=>u.status==='pending_verification').length,
    suspended:   db.users.filter(u=>u.status==='suspended').length,
    totalBal:    db.users.reduce((s,u)=>s+(u.balance||0),0),
    totalInvest: db.users.reduce((s,u)=>s+(u.invested||0),0),
    totalProfit: db.users.reduce((s,u)=>s+(u.profit||0),0),
    pendingDeps: (db.deposits||[]).filter(d=>d.status==='pending').length,
    pendingWds:  (db.withdrawals||[]).filter(w=>w.status==='pending').length,
    unreadMsgs:  (db.messages||[]).filter(m=>m.sender==='client'&&!m.read_admin).length,
  });
});

app.get('/api/admin/users', needA, (req,res) => { const db=loadDB(); res.json(db.users.map(safe)); });

app.post('/api/admin/users', needA, (req,res) => {
  const {name,email,password,plan,balance,country,phone}=req.body;
  if(!name||!email) return res.status(400).json({error:'Name and email required'});
  const db=loadDB();
  if(db.users.find(u=>u.email===email.toLowerCase())) return res.status(409).json({error:'Email already exists'});
  const planRoi={Starter:5,Growth:12,Premium:20,'VIP Elite':30};
  const planDur={Starter:7,Growth:14,Premium:21,'VIP Elite':30};
  const p=plan||'Starter';
  const user={
    id:newId(db),name:name.trim(),email:email.toLowerCase().trim(),
    password:bcrypt.hashSync(password||'client123',10),plan:p,
    balance:parseFloat(balance)||0,invested:parseFloat(balance)||0,
    profit:0,withdrawn:0,today_earned:0,
    roi:planRoi[p]||5,duration:planDur[p]||7,days_left:planDur[p]||7,cycle_day:0,
    trades_wins:0,trades_losses:0,trades_volume:0,
    refs:0,ref_earned:0,ref_pending:0,
    ref_code:name.replace(/\s/g,'').toUpperCase().slice(0,3)+Math.floor(Math.random()*9000+1000),
    status:'active',verified_email:true,verification_token:null,
    kyc_status:'verified',kyc_docs:[],upgrade_message:null,withdrawal_ready:false,withdrawal_message:null,
    country:country||'Nigeria',phone:phone||'',
    joined:fmtDate(now()),initials:name.trim()[0].toUpperCase(),
    chart_data:[0,0,0,0,0,0,0,0,0,0,0,0,0,0],created_at:now()
  };
  db.users.push(user); saveDB(db); res.json({ok:true,id:user.id});
});

app.put('/api/admin/users/:id', needA, (req,res) => {
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id));
  if(i<0) return res.status(404).json({error:'Not found'});
  const nums=['balance','invested','profit','withdrawn','today_earned','roi'];
  const strs=['name','plan','status','country','phone','kyc_status'];
  nums.forEach(f=>{ if(req.body[f]!==undefined) db.users[i][f]=parseFloat(req.body[f])||0; });
  strs.forEach(f=>{ if(req.body[f]!==undefined) db.users[i][f]=req.body[f]; });
  if(req.body.password) db.users[i].password=bcrypt.hashSync(req.body.password,10);
  saveDB(db); res.json({ok:true});
});

app.post('/api/admin/users/:id/approve', needA, (req,res) => {
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id));
  if(i<0) return res.status(404).json({error:'Not found'});
  db.users[i].status='active'; db.users[i].approved_at=now();
  const u=db.users[i]; saveDB(db);
  sendEmail(u.email,u.name,`Your ${BROKER_NAME} account is now active!`,emailApproved(u.name)).catch(()=>{});
  res.json({ok:true});
});

app.post('/api/admin/users/:id/credit', needA, (req,res) => {
  const {amount}=req.body; if(!amount||amount<=0) return res.status(400).json({error:'Invalid amount'});
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.users[i].balance=(db.users[i].balance||0)+parseFloat(amount);
  db.users[i].profit =(db.users[i].profit ||0)+parseFloat(amount);
  saveDB(db); res.json({ok:true,newBalance:db.users[i].balance});
});

app.delete('/api/admin/users/:id', needA, (req,res) => {
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.users.splice(i,1); saveDB(db); res.json({ok:true});
});

// Trades (admin)
app.get('/api/admin/trades', needA, (req,res) => {
  const db=loadDB();
  res.json((db.trades||[]).map(t=>{ const u=db.users.find(x=>x.id===t.user_id); return {...t,user_name:u?.name||'?',user_email:u?.email||''}; }).sort((a,b)=>new Date(b.date)-new Date(a.date)));
});

app.post('/api/admin/trades', needA, (req,res) => {
  const {user_id,instrument,direction,amount,pnl,result,duration}=req.body;
  if(!user_id||!instrument||!direction) return res.status(400).json({error:'user_id, instrument and direction required'});
  const db=loadDB(); const user=db.users.find(u=>u.id===parseInt(user_id)); if(!user) return res.status(404).json({error:'User not found'});
  const trade={id:newId(db),user_id:parseInt(user_id),instrument,direction,amount:parseFloat(amount)||0,pnl:parseFloat(pnl)||0,result:result||'open',duration:duration||'—',date:now()};
  db.trades=db.trades||[]; db.trades.unshift(trade);
  const ui=db.users.findIndex(u=>u.id===parseInt(user_id));
  if(result==='win'){db.users[ui].trades_wins=(db.users[ui].trades_wins||0)+1;db.users[ui].balance=(db.users[ui].balance||0)+Math.abs(parseFloat(pnl)||0);db.users[ui].profit=(db.users[ui].profit||0)+Math.abs(parseFloat(pnl)||0);}
  else if(result==='loss'){db.users[ui].trades_losses=(db.users[ui].trades_losses||0)+1;db.users[ui].balance=Math.max(0,(db.users[ui].balance||0)-Math.abs(parseFloat(pnl)||0));}
  db.users[ui].trades_volume=(db.users[ui].trades_volume||0)+(parseFloat(amount)||0);
  saveDB(db); res.json({ok:true,id:trade.id});
});

app.delete('/api/admin/trades/:id', needA, (req,res) => {
  const db=loadDB(); const i=(db.trades||[]).findIndex(t=>t.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.trades.splice(i,1); saveDB(db); res.json({ok:true});
});

// Deposits (admin)
app.get('/api/admin/deposits', needA, (req,res) => { const db=loadDB(); res.json(db.deposits||[]); });
app.put('/api/admin/deposits/:id', needA, (req,res) => {
  const {status,credit}=req.body;
  const db=loadDB(); const i=(db.deposits||[]).findIndex(d=>d.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.deposits[i].status=status;
  if(status==='approved'&&credit){
    const ui=db.users.findIndex(u=>u.id===db.deposits[i].user_id);
    if(ui>=0){
      db.users[ui].balance=(db.users[ui].balance||0)+db.deposits[i].amount;
      db.users[ui].invested=(db.users[ui].invested||0)+db.deposits[i].amount;
      if(db.deposits[i].plan) db.users[ui].plan=db.deposits[i].plan;
      const u=db.users[ui]; const planRoi={Starter:5,Growth:12,Premium:20,'VIP Elite':30};
      const daily=Math.round(db.deposits[i].amount*(planRoi[db.deposits[i].plan]||5)/100);
      sendEmail(u.email,u.name,`Deposit confirmed — ${BROKER_NAME}`,emailDepositOk(u.name,db.deposits[i].amount,db.deposits[i].plan||u.plan,daily)).catch(()=>{});
    }
  }
  saveDB(db); res.json({ok:true});
});

// Withdrawals (admin)
app.get('/api/admin/withdrawals', needA, (req,res) => { const db=loadDB(); res.json(db.withdrawals||[]); });
app.put('/api/admin/withdrawals/:id', needA, (req,res) => {
  const {status,deduct}=req.body;
  const db=loadDB(); const i=(db.withdrawals||[]).findIndex(w=>w.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.withdrawals[i].status=status;
  if(status==='approved'&&deduct){
    const ui=db.users.findIndex(u=>u.id===db.withdrawals[i].user_id);
    if(ui>=0){db.users[ui].balance=Math.max(0,(db.users[ui].balance||0)-db.withdrawals[i].amount);db.users[ui].withdrawn=(db.users[ui].withdrawn||0)+db.withdrawals[i].amount;}
  }
  saveDB(db); res.json({ok:true});
});

// Upgrade message
app.post('/api/admin/users/:id/upgrade-message', needA, (req,res) => {
  const {message,new_plan,new_balance}=req.body;
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.users[i].upgrade_message={message,new_plan,new_balance,date:now(),seen:false};
  if(new_plan)    db.users[i].plan   =new_plan;
  if(new_balance) db.users[i].balance=parseFloat(new_balance);
  const u=db.users[i]; saveDB(db);
  sendEmail(u.email,u.name,`Account upgrade available — ${BROKER_NAME}`,emailUpgradeMsg(u.name,message,new_plan,new_balance)).catch(()=>{});
  res.json({ok:true});
});

// Withdrawal ready
app.post('/api/admin/users/:id/withdrawal-ready', needA, (req,res) => {
  const {message}=req.body;
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.users[i].withdrawal_ready  =true;
  db.users[i].withdrawal_message=message||'Your trading cycle is complete! You can now withdraw your profits.';
  const u=db.users[i]; saveDB(db);
  sendEmail(u.email,u.name,`Your profits are ready to withdraw — ${BROKER_NAME}`,emailWithdrawMsg(u.name,u.withdrawal_message,u.balance)).catch(()=>{});
  res.json({ok:true});
});

// KYC approve/reject
app.put('/api/admin/kyc/:id', needA, (req,res) => {
  const {status,reason}=req.body;
  const db=loadDB(); const i=db.users.findIndex(u=>u.id===parseInt(req.params.id)); if(i<0) return res.status(404).json({error:'Not found'});
  db.users[i].kyc_status=status;
  if(reason) db.users[i].kyc_reject_reason=reason;
  if(status==='verified') db.users[i].kyc_reject_reason=null;
  saveDB(db); res.json({ok:true});
});

// Support chat (admin)
app.get('/api/admin/support', needA, (req,res) => {
  const db=loadDB(); const msgs=db.messages||[];
  const map={};
  msgs.forEach(m=>{ if(!map[m.user_id])map[m.user_id]={user_id:m.user_id,user_name:m.user_name,user_email:m.user_email,messages:[],unread:0}; map[m.user_id].messages.push(m); if(m.sender==='client'&&!m.read_admin)map[m.user_id].unread++; });
  const result=Object.values(map).map(c=>{ c.messages.sort((a,b)=>new Date(a.date)-new Date(b.date)); c.last=c.messages[c.messages.length-1]; return c; }).sort((a,b)=>new Date(b.last?.date||0)-new Date(a.last?.date||0));
  res.json(result);
});

app.get('/api/admin/support/:uid', needA, (req,res) => {
  const db=loadDB();
  const msgs=(db.messages||[]).filter(m=>m.user_id===parseInt(req.params.uid)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  let changed=false; (db.messages||[]).forEach(m=>{ if(m.user_id===parseInt(req.params.uid)&&m.sender==='client'&&!m.read_admin){m.read_admin=true;changed=true;} }); if(changed)saveDB(db);
  res.json(msgs);
});

app.post('/api/admin/support/:uid', needA, (req,res) => {
  const {message}=req.body; if(!message?.trim()) return res.status(400).json({error:'Message required'});
  const db=loadDB(); const user=db.users.find(u=>u.id===parseInt(req.params.uid)); if(!user) return res.status(404).json({error:'Not found'});
  const msg={id:newId(db),user_id:user.id,user_email:user.email,user_name:user.name,sender:'admin',message:message.trim(),read_admin:true,read_client:false,date:now()};
  db.messages=db.messages||[]; db.messages.push(msg); saveDB(db); res.json({ok:true});
});

// ── Pages ─────────────────────────────────────────────────────
app.get('/',       (_,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/client', (_,res)=>res.sendFile(path.join(__dirname,'public','client.html')));
app.get('/admin',  (_,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/email-templates.html', (_,res)=>res.sendFile(path.join(__dirname,'public','email-templates.html')));
app.get('/ping',   (_,res)=>res.json({ok:true, time:now(), users: loadDB().users.length}));

// ── Start ─────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ ${BROKER_NAME} running on port ${PORT}`);
    console.log(`   Admin: ${ADMIN_USER} / [password hidden]`);
    console.log(`   Email: ${BROKER_NAME} <${GMAIL_USER}>`);
    console.log(`   Email active: ${GMAIL_PASS ? 'YES ✅' : 'NO — set GMAIL_APP_PASSWORD'}`);
    console.log(`   Database: GitHub-backed (persistent across deploys) ✅\n`);
  });
});
