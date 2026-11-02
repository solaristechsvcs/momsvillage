import express from 'express';
import { createServer } from 'node:http';
import { createLiveChat } from './live-chat.js';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile,access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { text, id, price } from './validation.js';
import { authColumns, updatePassword, sameAuthVersion } from './passwords.js';
import {announcementsRouter} from './announcements.js';
import {childrenRouter,sharedChildren} from './children.js';
import {initializeGroupPictures} from './group-pictures.js';
import { socialRouter } from './social.js';
import { verificationSettings } from './verification-utils.js';
import { VerificationService } from './verification-service.js';
import { verificationRouter } from './verification.js';
import { membershipRouter, initializeMembership, registerMembership, membershipStatus, membershipPolicy, approvedMemberSql } from './membership.js';
import { changeMemberAccess, initializeAdminRoles } from './admin.js';
import { badgeColumns, initializeBadgeStorage, assignableBadges } from './badges.js';
const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

let config;
try { config = (await import('./config.js')).default; }
catch (error) { console.error('Unable to load config.js. Copy config.example.js to config.js and configure your database and session secret.', error.message); process.exit(1); }
if (!config.sessionSecret || config.sessionSecret.length < 32 || config.sessionSecret.startsWith('REPLACE_')) throw new Error('Set a unique random sessionSecret of at least 32 characters in config.js.');
const db = mysql.createPool({ ...config.mysql, connectionLimit: 10, timezone: 'Z', multipleStatements: false });
const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
const socialSchema = await readFile(new URL('./social-schema.sql', import.meta.url), 'utf8');
for (const statement of socialSchema.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
const membershipSchema = await readFile(new URL('./membership-schema.sql', import.meta.url), 'utf8');
for (const statement of membershipSchema.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
const verificationSchema = await readFile(new URL('./verification-schema.sql', import.meta.url), 'utf8');
for (const statement of verificationSchema.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
const childrenSchema=await readFile(new URL('./children-schema.sql',import.meta.url),'utf8');
for(const statement of childrenSchema.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
const announcementSchema=await readFile(new URL('./announcement-schema.sql',import.meta.url),'utf8');
for(const statement of announcementSchema.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
await initializeGroupPictures(db,config.mysql.database);
await initializeBadgeStorage(db, config.mysql.database);
await initializeAdminRoles(db, config);
await initializeMembership(db);
const query = async (sql, args = []) => (await db.execute(sql, args))[0];
const verificationConfig = verificationSettings(config);
const cameraBundleReady = await access(new URL('./public/verification-widget.js',import.meta.url)).then(()=>true,()=>false);
if(verificationConfig.ready && !cameraBundleReady) { verificationConfig.ready=false; console.warn('Optional verification requires npm run build:verification.'); }
const verificationProvider = verificationConfig.ready ? (await import('./liveness-provider.js')).awsLivenessProvider(verificationConfig) : null;
const verificationService = new VerificationService(db,verificationConfig,verificationProvider);
await verificationService.purge();
const verificationCleanup = setInterval(()=>verificationService.purge().catch(()=>console.warn('Verification evidence cleanup delayed.')),15*60000);
verificationCleanup.unref();
const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
const standardSecurity = helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'",'https:','data:'],connectSrc:["'self'",new URL(config.publicUrl ?? 'http://127.0.0.1:'+(config.port ?? 3014)).origin.replace(/^http/,'ws')],scriptSrc:["'self'"],styleSrc:["'self'"],upgradeInsecureRequests:config.secureCookies ? [] : null } } });
const cameraRegion = /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(verificationConfig.region) ? verificationConfig.region : 'us-east-1';
const cameraSecurity = helmet({ contentSecurityPolicy: { directives: {
  imgSrc:["'self'",'data:','blob:'],scriptSrc:["'self'","'wasm-unsafe-eval'",'https://cdn.liveness.rekognition.amazonaws.com'],styleSrc:["'self'","'unsafe-inline'"],
  connectSrc:["'self'",'https://cdn.liveness.rekognition.amazonaws.com','https://rekognition-streaming.'+cameraRegion+'.amazonaws.com','wss://rekognition-streaming.'+cameraRegion+'.amazonaws.com'],
  workerSrc:["'self'",'blob:'],upgradeInsecureRequests:config.secureCookies ? [] : null
} } });
app.use((req,res,next)=>(req.path==='/verification-check.html' ? cameraSecurity : standardSecurity)(req,res,next));
app.use((req,res,next)=>{if(req.path==='/verification-check.html') res.set('Permissions-Policy','camera=(self), microphone=()');next();});
app.use(express.json({ limit: '32kb' }));
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({ ...config.mysql, createDatabaseTable: true });
const sessionMiddleware=session({ name: 'mv.sid', secret: config.sessionSecret, store: sessionStore, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: !!config.secureCookies, sameSite: 'lax', maxAge: 7 * 86400000 } });
app.use(sessionMiddleware);
let chat;
app.use('/api',(req,res,next)=>{const chatPath=req.path;res.on('finish',()=>{if(res.statusCode<400 && !['GET','HEAD'].includes(req.method) && /^\/(logout|password|admin|membership|friends|blocks|chat)/.test(chatPath)) void chat?.refresh();});next();});
app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const adminEmail = email => (config.adminEmails ?? []).map(e => e.toLowerCase()).includes(email.toLowerCase());
const isAdmin = user => !!user.is_admin && membershipStatus(user) === 'approved';
const publicUser = user => ({ id: user.id, name: user.name, city: user.city, bio: user.bio, avatar: user.avatar, created_at: user.created_at, staff_badge: !!user.is_admin, verified_member: !!user.verified_member, ...Object.fromEntries(Object.keys(assignableBadges).map(badge => [`${badge}_badge`, !!user[`${badge}_badge`]])) });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const requireAccount = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in.' });
  const [user] = await query(`SELECT u.*,${authColumns()},EXISTS(SELECT 1 FROM member_verifications own_check WHERE own_check.user_id=u.id AND own_check.current_attempt_id IS NOT NULL) AS has_verification_data,a.status AS membership_status,${badgeColumns()} FROM users u LEFT JOIN membership_applications a ON a.user_id=u.id WHERE u.id=?`, [req.session.userId]);
  if (!user || !sameAuthVersion(req.session.authVersion ?? 0,user.auth_version)) { req.session.destroy(()=>{}); return res.status(401).json({error:'Please sign in again.'}); }
  req.user = user; req.isAdmin = isAdmin(user); next();
};
const requireApproved = (req, res, next) => membershipStatus(req.user) === 'approved' ? next() : res.status(403).json({ error: 'Approved membership is required.', code: 'MEMBERSHIP_REQUIRED', membership_status: membershipStatus(req.user) });
const requireAdmin = (req, res, next) => req.isAdmin ? next() : res.status(403).json({ error: 'Administrator access required.' });
app.get('/api/announcement',async(req,res)=>{const [announcement]=await query('SELECT title,body,tone,revision FROM site_announcement WHERE id=1 AND enabled=TRUE');res.json({announcement:announcement??null});});
app.get('/api/session', async (req, res) => {
  req.session.csrf ??= randomBytes(32).toString('hex');
  const [user] = req.session.userId ? await query(`SELECT u.*,${authColumns()},EXISTS(SELECT 1 FROM member_verifications own_check WHERE own_check.user_id=u.id AND own_check.current_attempt_id IS NOT NULL) AS has_verification_data,a.status AS membership_status,${badgeColumns()} FROM users u LEFT JOIN membership_applications a ON a.user_id=u.id WHERE u.id=?`, [req.session.userId]) : [];
  if(user && !sameAuthVersion(req.session.authVersion ?? 0,user.auth_version)) { await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve())); req.session.csrf=randomBytes(32).toString('hex'); return res.json({csrf:req.session.csrf,user:null}); }
  res.json({ csrf: req.session.csrf, user: user ? { ...publicUser(user), email: user.email, admin: isAdmin(user), membership_status: membershipStatus(user), has_verification_data: !!user.has_verification_data, must_change_password: !!user.must_change_password } : null, membership_policy: { ...membershipPolicy, invite_only: config.membership?.inviteOnly === true } });
});
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const a = Buffer.from(req.get('x-csrf-token') ?? ''); const b = Buffer.from(req.session.csrf ?? '');
  if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: 'Session expired. Refresh this page and try again.' });
  next();
});
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
async function signIn(req, userId, authVersion=0) {
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.userId = userId; req.session.authVersion = Number(authVersion); req.session.csrf = randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
}
app.post('/api/register', authLimit, async (req, res) => {
  const name = text(req.body.name, 80), email = text(req.body.email, 254).toLowerCase(), password = text(req.body.password, 72);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 12 || Buffer.byteLength(password) > 72) fail(400, 'Use a password of at least 12 characters and at most 72 UTF-8 bytes.');
  if (req.body.agree !== true) fail(400, 'Please agree to the community guidelines.');
  const requestedAdmin = adminEmail(email);
  if (requestedAdmin) {
    const supplied = Buffer.from(typeof req.body.setup_code === 'string' ? req.body.setup_code : '');
    const expected = Buffer.from(config.adminRegistrationCode ?? '');
    if (expected.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(403, 'This address is reserved. Enter the administrator setup code.');
  }
  const userId = await registerMembership({ db, body: req.body, passwordHash: await bcrypt.hash(password, 12), email, name, requestedAdmin, config, fail });
  await signIn(req, userId); res.status(201).json({ ok: true });
});
app.post('/api/login', authLimit, async (req, res) => {
  const email = text(req.body.email, 254).toLowerCase(), password = typeof req.body.password==='string' ? req.body.password : '';
  if(!password || Buffer.byteLength(password)>200) fail(400,'Enter your password.');
  const [user] = await query(`SELECT u.*,${authColumns()} FROM users u WHERE email=?`, [email]);
  const valid = await bcrypt.compare(password, user?.password ?? '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if (!user || !valid) fail(401, 'Incorrect email or password, or account unavailable.');
  if(user.must_change_password && (!user.password_expires_at || new Date(user.password_expires_at)<=new Date())) fail(401,'Your temporary password has expired. Contact an administrator.');
  await signIn(req,user.id,user.auth_version); res.json({ ok: true });
});
app.post('/api/logout', (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('mv.sid'); res.json({ ok: true }); }));
app.use('/api', requireAccount);
const passwordLimit=rateLimit({windowMs:15*60000,limit:10,keyGenerator:req=>String(req.user.id),standardHeaders:'draft-8',legacyHeaders:false});
app.post('/api/password/change',passwordLimit,async(req,res)=>{
 const version=await updatePassword(db,{actorId:req.user.id,targetId:req.user.id,actorVersion:req.session.authVersion ?? 0,currentPassword:req.body.current_password,newPassword:req.body.new_password});
 await signIn(req,req.user.id,version);res.json({ok:true});
});
app.use('/api',(req,res,next)=>req.user.must_change_password ? res.status(403).json({error:'Change your temporary password before continuing.',code:'PASSWORD_CHANGE_REQUIRED'}) : next());
app.post('/api/admin/users/:id/password',requireApproved,requireAdmin,passwordLimit,async(req,res)=>{
 await updatePassword(db,{actorId:req.user.id,targetId:id(req.params.id),actorVersion:req.session.authVersion ?? 0,currentPassword:req.body.current_password,newPassword:req.body.temporary_password,reset:true});
 res.json({ok:true,expires_in_hours:24});
});
app.use('/api', verificationRouter({ service:verificationService,requireApproved,requireAdmin }));
app.use('/api', membershipRouter({ db, query, config, fail, requireApproved, requireAdmin }));
app.use('/api', requireApproved);
app.use('/api',childrenRouter({db,query}));
app.use('/api',announcementsRouter({db,query,requireAdmin}));
app.get('/api/chat/online',async(req,res)=>res.json({user_ids:await chat.online(req.user.id)}));
const social = await socialRouter({ db, query, config, fail, onMessage:(a,b)=>chat?.message(a,b) });
app.use('/api', social.router);
app.patch('/api/profile', async (req, res) => {
  await social.withImage(req.user.id, req.body.avatar, (execute, url) => execute('UPDATE users SET name=?,city=?,bio=?,avatar=? WHERE id=?', [text(req.body.name, 80), text(req.body.city, 120, false), text(req.body.bio, 2000, false), url, req.user.id]));
  res.json({ ok: true });
});
app.get('/api/members/:id', async (req, res) => {
  const [user] = await query(`SELECT u.id,u.name,u.city,u.bio,u.avatar,u.created_at,${badgeColumns()} FROM users u WHERE u.id=? AND u.banned=FALSE AND ${approvedMemberSql('u')}`, [id(req.params.id)]);
  if (!user) fail(404, 'Member not found.'); user.children=await sharedChildren(query,user.id,req.user.id);res.json(user);
});
app.get('/api/posts', async (req, res) => {
  const groupId = req.query.group ? id(req.query.group) : null;
  const postId = req.query.post ? id(req.query.post) : null;
  const posts = await query(`SELECT p.*,u.name,u.avatar,${badgeColumns()},
    (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS like_count,
    EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
    (SELECT COUNT(*) FROM comments cc JOIN users cu ON cu.id=cc.user_id WHERE cc.post_id=p.id AND cu.banned=FALSE AND ${approvedMemberSql('cu')}) AS comment_count,
    g.name AS group_name FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN community_groups g ON g.id=p.group_id
    WHERE u.banned=FALSE AND ${approvedMemberSql('u')} ${postId ? 'AND p.id=?' : groupId ? 'AND p.group_id=?' : 'AND p.group_id IS NULL'} ORDER BY p.id DESC LIMIT 50`, postId ? [req.user.id, postId] : groupId ? [req.user.id, groupId] : [req.user.id]);
  if (posts.length) {
    const postIds = posts.map(post => post.id), placeholders = postIds.map(() => '?').join(',');
    const latest = await query(`SELECT c.*,cu.name,cu.avatar,${badgeColumns('cu')} FROM comments c
      JOIN users cu ON cu.id=c.user_id
      JOIN (SELECT MAX(cc.id) AS latest_id FROM comments cc JOIN users author ON author.id=cc.user_id
        WHERE cc.post_id IN (${placeholders}) AND author.banned=FALSE AND ${approvedMemberSql('author')} GROUP BY cc.post_id) newest ON newest.latest_id=c.id
      WHERE cu.banned=FALSE AND ${approvedMemberSql('cu')}`, postIds);
    const previews = new Map(latest.map(comment => [comment.post_id, comment]));
    for (const post of posts) post.latest_comment = previews.get(post.id) ?? null;
  }
  res.json(posts);
});
app.post('/api/posts', async (req, res) => {
  const groupId = req.body.group_id ? id(req.body.group_id) : null;
  if (groupId) { const [member] = await query('SELECT 1 FROM memberships WHERE group_id=? AND user_id=?', [groupId, req.user.id]); if (!member) fail(403, 'Join this group before posting.'); }
  const result = await social.withImage(req.user.id, req.body.image, (execute, url) => execute('INSERT INTO posts(user_id,group_id,body,image) VALUES(?,?,?,?)', [req.user.id, groupId, text(req.body.body, 5000), url]));
  res.status(201).json({ id: result.insertId });
});
async function existing(table, value) {
  const [row] = await query(`SELECT * FROM ${table} WHERE id=?`, [id(value)]);
  if (!row) fail(404, 'Content not found.'); return row;
}
app.patch('/api/posts/:id',async(req,res)=>{
 const post=await existing('posts',req.params.id);
 if(post.user_id!==req.user.id)fail(403,'Only the post creator can edit this post.');
 const body=text(req.body.body,5000);
 await social.withImage(req.user.id,req.body.image ?? post.image,async(execute,url)=>{
  const [current]=await execute('SELECT user_id FROM posts WHERE id=? FOR UPDATE',[post.id]);
  if(!current)fail(404,'Post not found.');
  if(current.user_id!==req.user.id)fail(403,'Only the post creator can edit this post.');
  await execute('UPDATE posts SET body=?,image=? WHERE id=? AND user_id=?',[body,url,post.id,req.user.id]);
 });
 res.json({ok:true});
});
app.post('/api/posts/:id/like', async (req, res) => {
  const post = await existing('posts', req.params.id);
  if (req.body.active === true) {
    const result = await query('INSERT IGNORE INTO likes(post_id,user_id) VALUES(?,?)', [post.id, req.user.id]);
    if (result.affectedRows) await social.notify(post.user_id, req.user.id, 'like', post.id);
  }
  else await query('DELETE FROM likes WHERE post_id=? AND user_id=?', [post.id, req.user.id]);
  res.json({ ok: true });
});
app.get('/api/posts/:id/comments', async (req, res) => {
  await existing('posts', req.params.id);
  const before = req.query.before ? id(req.query.before) : null;
  const comments = await query(`SELECT c.*,u.name,u.avatar,${badgeColumns()} FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? AND u.banned=FALSE AND ${approvedMemberSql('u')} ${before ? 'AND c.id<?' : ''} ORDER BY c.id DESC LIMIT 100`, [id(req.params.id), ...(before ? [before] : [])]);
  res.json(comments.reverse());
});
app.post('/api/posts/:id/comments', async (req, res) => {
  const post = await existing('posts', req.params.id);
  await query('INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)', [post.id, req.user.id, text(req.body.body, 2000)]);
  await social.notify(post.user_id, req.user.id, 'comment', post.id); res.status(201).json({ ok: true });
});
app.get('/api/groups', async (req, res) => res.json(await query(`SELECT g.*,u.name AS owner_name,(SELECT COUNT(*) FROM memberships WHERE group_id=g.id) AS members,
  EXISTS(SELECT 1 FROM memberships WHERE group_id=g.id AND user_id=?) AS joined FROM community_groups g JOIN users u ON u.id=g.owner_id WHERE u.banned=FALSE AND ${approvedMemberSql('u')} ORDER BY g.id DESC LIMIT 100`, [req.user.id])));
app.post('/api/groups', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO community_groups(owner_id,name,city,description) VALUES(?,?,?,?)', [req.user.id, text(req.body.name, 100), text(req.body.city, 120), text(req.body.description, 3000)]);
    await connection.execute('INSERT INTO memberships(group_id,user_id) VALUES(?,?)', [result.insertId, req.user.id]);
    await connection.commit(); res.status(201).json({ id: result.insertId });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
});
app.patch('/api/groups/:id',async(req,res)=>{
 const group=await existing('community_groups',req.params.id);
 if(group.owner_id!==req.user.id)fail(403,'Only the group owner can edit this group.');
 const name=text(req.body.name,100),city=text(req.body.city,120),description=text(req.body.description,3000);
 await social.withImage(req.user.id,req.body.image ?? group.image,async(execute,url)=>{
  const [current]=await execute('SELECT owner_id FROM community_groups WHERE id=? FOR UPDATE',[group.id]);
  if(!current)fail(404,'Group not found.');
  if(current.owner_id!==req.user.id)fail(403,'Only the group owner can edit this group.');
  await execute('UPDATE community_groups SET name=?,city=?,description=?,image=? WHERE id=? AND owner_id=?',[name,city,description,url,group.id,req.user.id]);
 });
 res.json({ok:true});
});
app.post('/api/groups/:id/join', async (req, res) => {
  const group = await existing('community_groups', req.params.id);
  if (req.body.active === true) await query('INSERT IGNORE INTO memberships(group_id,user_id) VALUES(?,?)', [group.id, req.user.id]);
  else { if (group.owner_id === req.user.id) fail(400, 'Group owners must keep their membership.'); await query('DELETE FROM memberships WHERE group_id=? AND user_id=?', [group.id, req.user.id]); }
  res.json({ ok: true });
});
app.get('/api/events', async (req, res) => res.json(await query(`SELECT e.*,u.name,${badgeColumns()},(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) AS attendees,
  EXISTS(SELECT 1 FROM rsvps WHERE event_id=e.id AND user_id=?) AS going FROM events e JOIN users u ON u.id=e.user_id WHERE u.banned=FALSE AND ${approvedMemberSql('u')} AND e.starts_at>=UTC_TIMESTAMP() ORDER BY e.starts_at LIMIT 100`, [req.user.id])));
app.post('/api/events', async (req, res) => {
  const starts = new Date(req.body.starts_at);
  if (!Number.isFinite(starts.getTime()) || starts <= new Date()) fail(400, 'Choose a future date and time.');
  await query('INSERT INTO events(user_id,title,location,starts_at,description) VALUES(?,?,?,?,?)', [req.user.id, text(req.body.title, 140), text(req.body.location, 200), starts, text(req.body.description, 3000)]);
  res.status(201).json({ ok: true });
});
app.post('/api/events/:id/rsvp', async (req, res) => {
  const event = await existing('events', req.params.id);
  if (new Date(event.starts_at) <= new Date()) fail(400, 'This event has ended.');
  if (req.body.active === true) await query('INSERT IGNORE INTO rsvps(event_id,user_id) VALUES(?,?)', [event.id, req.user.id]);
  else await query('DELETE FROM rsvps WHERE event_id=? AND user_id=?', [event.id, req.user.id]);
  res.json({ ok: true });
});
app.get('/api/listings', async (req, res) => res.json(await query(`SELECT l.*,u.name,${badgeColumns()} FROM listings l JOIN users u ON u.id=l.user_id WHERE u.banned=FALSE AND ${approvedMemberSql('u')} ORDER BY l.sold,l.id DESC LIMIT 100`)));
app.post('/api/listings', async (req, res) => {
  await social.withImage(req.user.id, req.body.image, (execute, url) => execute('INSERT INTO listings(user_id,title,description,price,city,image,contact) VALUES(?,?,?,?,?,?,?)', [req.user.id, text(req.body.title, 140), text(req.body.description, 3000), price(req.body.price), text(req.body.city, 120), url, text(req.body.contact, 250)]));
  res.status(201).json({ ok: true });
});
app.patch('/api/listings/:id', async (req, res) => {
  const listing = await existing('listings', req.params.id);
  if (listing.user_id !== req.user.id && !req.isAdmin) fail(403, 'Only the seller can update this listing.');
  await query('UPDATE listings SET sold=? WHERE id=?', [req.body.sold === true, listing.id]); res.json({ ok: true });
});
const targets = { post: ['posts', 'user_id'], comment: ['comments', 'user_id'], group: ['community_groups', 'owner_id'], event: ['events', 'user_id'], listing: ['listings', 'user_id'] };
app.delete('/api/content/:type/:id', async (req, res) => {
  if (req.params.type === 'message') {
    if (!req.isAdmin) fail(403, 'Only staff can remove reported messages.');
    const [report] = await query("SELECT 1 FROM reports WHERE target_type='message' AND target_id=?", [id(req.params.id)]);
    if (!report) fail(403, 'Only reported messages can be moderated.');
    await query('DELETE FROM messages WHERE id=?', [id(req.params.id)]); res.json({ ok: true }); return;
  }
  const target = targets[req.params.type]; if (!target) fail(400, 'Invalid content type.');
  const row = await existing(target[0], req.params.id);
  if (!req.isAdmin && row[target[1]] !== req.user.id) fail(403, 'You cannot delete this content.');
  await query(`DELETE FROM ${target[0]} WHERE id=?`, [row.id]); res.json({ ok: true });
});
app.post('/api/reports', async (req, res) => {
  if (req.body.type === 'message') {
    await social.reportMessage(req, res); return;
  }
  const target = targets[req.body.type]; if (!target) fail(400, 'Invalid content type.');
  await existing(target[0], req.body.id);
  await query('INSERT INTO reports(user_id,target_type,target_id,reason) VALUES(?,?,?,?)', [req.user.id, req.body.type, id(req.body.id), text(req.body.reason, 2000)]);
  res.status(201).json({ ok: true });
});
app.get('/api/admin', requireAdmin, async (req, res) => {
  const term = text(req.query.q ?? '', 100, false);
  const users = await query(`SELECT u.id,u.name,u.email,u.city,u.avatar,u.banned,u.is_admin,a.status AS membership_status,u.created_at,${badgeColumns()} FROM users u LEFT JOIN membership_applications a ON a.user_id=u.id WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 200`, [`%${term}%`, `%${term}%`]);
  const reports = await query('SELECT r.*,u.name FROM reports r JOIN users u ON u.id=r.user_id WHERE resolved=FALSE ORDER BY r.id DESC LIMIT 200');
  res.json({ users, reports });
});
app.get('/api/admin/reports',requireAdmin,async(req,res)=>{
 const reports=await query('SELECT r.*,u.name FROM reports r JOIN users u ON u.id=r.user_id WHERE resolved=FALSE ORDER BY r.id DESC LIMIT 200');
 res.json(reports);
});
app.get('/api/admin/logs',requireAdmin,async(req,res)=>{
 const before=req.query.before===undefined ? null : id(req.query.before);
 const rows=await query('SELECT a.id,a.actor_id,a.target_id,a.action,a.created_at,actor.name AS actor_name,target.name AS target_name FROM admin_audit a JOIN users actor ON actor.id=a.actor_id JOIN users target ON target.id=a.target_id'+(before?' WHERE a.id<?':'')+' ORDER BY a.id DESC LIMIT 100',before?[before]:[]);
 res.json({logs:rows,next_before:rows.length===100?rows[rows.length-1].id:null});
});
app.get('/api/admin/users/:id/profile', requireAdmin, async (req, res) => {
  const user = await existing('users', req.params.id);
  const [badges] = await query(`SELECT ${badgeColumns()} FROM users u WHERE u.id=?`, [user.id]);
  Object.assign(user, badges);
  res.json({ ...publicUser(user), email: user.email, is_admin: !!user.is_admin, banned: !!user.banned, children:await sharedChildren(query,user.id,req.user.id) });
});
app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  if (typeof req.body.is_admin !== 'boolean') fail(400, 'Specify administrator access as true or false.');
  await changeMemberAccess(db, config.mysql.database, req.user.id, id(req.params.id), 'role', req.body.is_admin);
  res.json({ ok: true });
});
app.patch('/api/admin/users/:id/developer-badge', requireAdmin, async (req, res) => {
  if (typeof req.body.enabled !== 'boolean') fail(400, 'Specify badge assignment as true or false.');
  await changeMemberAccess(db, config.mysql.database, req.user.id, id(req.params.id), 'developer', req.body.enabled);
  res.json({ ok: true });
});
app.patch('/api/admin/users/:id/badges/:badge', requireAdmin, async (req, res) => {
  if (!Object.hasOwn(assignableBadges, req.params.badge)) fail(400, 'Invalid badge.');
  if (typeof req.body.enabled !== 'boolean') fail(400, 'Specify badge assignment as true or false.');
  await changeMemberAccess(db, config.mysql.database, req.user.id, id(req.params.id), `badge:${req.params.badge}`, req.body.enabled);
  res.json({ ok: true });
});
app.get('/api/admin/reports/:id/content', requireAdmin, async (req, res) => {
  const report = await existing('reports', req.params.id);
  if (report.target_type === 'message') {
    res.json(await existing('messages', report.target_id)); return;
  }
  const target = targets[report.target_type];
  if (!target) fail(400, 'Invalid content type.');
  res.json(await existing(target[0], report.target_id));
});
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  if (typeof req.body.banned !== 'boolean') fail(400, 'Specify account suspension as true or false.');
  await changeMemberAccess(db, config.mysql.database, req.user.id, id(req.params.id), 'suspension', req.body.banned);
  res.json({ ok: true });
});
app.patch('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  await existing('reports', req.params.id); await query('UPDATE reports SET resolved=TRUE WHERE id=?', [id(req.params.id)]); res.json({ ok: true });
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.get('/health', async (req, res) => { await query('SELECT 1'); res.json({ ok: true }); });
app.get('/version', (req, res) => {
  res.set('Cache-Control', 'no-store').set('CDN-Cache-Control', 'no-store').json({ name: 'Moms Village', version });
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), {
  etag: false, lastModified: false,
  setHeaders: (res,path) => {const policy=path.endsWith('moms-village-logo-v1.png')?'public, max-age=31536000, immutable':'no-store';res.set('Cache-Control',policy).set('CDN-Cache-Control',policy);}
}));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'ER_DUP_ENTRY' ? 409 : error.status ?? 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.code === 'ER_DUP_ENTRY' ? 'This email is already registered.' : status >= 500 ? 'Something went wrong. Please try again.' : error.message });
});
await sessionStore.onReady();
const server=createServer(app);
chat=createLiveChat({server,sessionMiddleware,sessionStore,query,config});
server.listen(config.port ?? 3014,config.host ?? '0.0.0.0',()=>console.log(`Moms Village v${version} listening on port ${config.port ?? 3014}`));
async function shutdown() { clearInterval(verificationCleanup); chat.close(); server.close(async () => { await db.end(); await sessionStore.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
