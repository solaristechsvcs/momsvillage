import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { text, id, price } from './validation.js';
import { socialRouter } from './social.js';
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
const query = async (sql, args = []) => (await db.execute(sql, args))[0];
const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'https:', 'data:'], scriptSrc: ["'self'"], styleSrc: ["'self'"], upgradeInsecureRequests: config.secureCookies ? [] : null } } }));
app.use(express.json({ limit: '32kb' }));
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({ ...config.mysql, createDatabaseTable: true });
app.use(session({ name: 'mv.sid', secret: config.sessionSecret, store: sessionStore, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: !!config.secureCookies, sameSite: 'lax', maxAge: 7 * 86400000 } }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const adminEmail = email => (config.adminEmails ?? []).map(e => e.toLowerCase()).includes(email.toLowerCase());
const isAdmin = user => !!user.is_admin && adminEmail(user.email);
const publicUser = user => ({ id: user.id, name: user.name, city: user.city, bio: user.bio, avatar: user.avatar, created_at: user.created_at });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const requireUser = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in.' });
  const [user] = await query('SELECT * FROM users WHERE id=?', [req.session.userId]);
  if (!user || user.banned) return res.status(403).json({ error: 'This account is unavailable.' });
  req.user = user; req.isAdmin = isAdmin(user); next();
};
const requireAdmin = (req, res, next) => req.isAdmin ? next() : res.status(403).json({ error: 'Administrator access required.' });
app.get('/api/session', async (req, res) => {
  req.session.csrf ??= randomBytes(32).toString('hex');
  const [user] = req.session.userId ? await query('SELECT * FROM users WHERE id=?', [req.session.userId]) : [];
  res.json({ csrf: req.session.csrf, user: user && !user.banned ? { ...publicUser(user), email: user.email, admin: isAdmin(user) } : null });
});
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const a = Buffer.from(req.get('x-csrf-token') ?? ''); const b = Buffer.from(req.session.csrf ?? '');
  if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: 'Session expired. Refresh this page and try again.' });
  next();
});
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
async function signIn(req, userId) {
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.userId = userId; req.session.csrf = randomBytes(32).toString('hex');
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
  const result = await query('INSERT INTO users(name,email,password,city,bio,is_admin) VALUES(?,?,?,?,?,?)', [name, email, await bcrypt.hash(password, 12), text(req.body.city ?? '', 120, false), '', requestedAdmin]);
  await signIn(req, result.insertId); res.status(201).json({ ok: true });
});
app.post('/api/login', authLimit, async (req, res) => {
  const email = text(req.body.email, 254).toLowerCase(), password = text(req.body.password, 200);
  const [user] = await query('SELECT * FROM users WHERE email=?', [email]);
  const valid = await bcrypt.compare(password, user?.password ?? '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if (!user || !valid || user.banned) fail(401, 'Incorrect email or password, or account unavailable.');
  await signIn(req, user.id); res.json({ ok: true });
});
app.post('/api/logout', (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('mv.sid'); res.json({ ok: true }); }));
app.use('/api', requireUser);
const social = await socialRouter({ db, query, config, fail });
app.use('/api', social.router);
app.patch('/api/profile', async (req, res) => {
  await social.withImage(req.user.id, req.body.avatar, (execute, url) => execute('UPDATE users SET name=?,city=?,bio=?,avatar=? WHERE id=?', [text(req.body.name, 80), text(req.body.city, 120, false), text(req.body.bio, 2000, false), url, req.user.id]));
  res.json({ ok: true });
});
app.get('/api/members/:id', async (req, res) => {
  const [user] = await query('SELECT id,name,city,bio,avatar,created_at FROM users WHERE id=? AND banned=FALSE', [id(req.params.id)]);
  if (!user) fail(404, 'Member not found.'); res.json(user);
});
app.get('/api/posts', async (req, res) => {
  const groupId = req.query.group ? id(req.query.group) : null;
  const postId = req.query.post ? id(req.query.post) : null;
  const posts = await query(`SELECT p.*,u.name,u.avatar,
    (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS like_count,
    EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
    (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count,
    g.name AS group_name FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN community_groups g ON g.id=p.group_id
    WHERE u.banned=FALSE ${postId ? 'AND p.id=?' : groupId ? 'AND p.group_id=?' : 'AND p.group_id IS NULL'} ORDER BY p.id DESC LIMIT 50`, postId ? [req.user.id, postId] : groupId ? [req.user.id, groupId] : [req.user.id]);
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
  res.json(await query('SELECT c.*,u.name,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? AND u.banned=FALSE ORDER BY c.id LIMIT 100', [id(req.params.id)]));
});
app.post('/api/posts/:id/comments', async (req, res) => {
  const post = await existing('posts', req.params.id);
  await query('INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)', [post.id, req.user.id, text(req.body.body, 2000)]);
  await social.notify(post.user_id, req.user.id, 'comment', post.id); res.status(201).json({ ok: true });
});
app.get('/api/groups', async (req, res) => res.json(await query(`SELECT g.*,u.name AS owner_name,(SELECT COUNT(*) FROM memberships WHERE group_id=g.id) AS members,
  EXISTS(SELECT 1 FROM memberships WHERE group_id=g.id AND user_id=?) AS joined FROM community_groups g JOIN users u ON u.id=g.owner_id WHERE u.banned=FALSE ORDER BY g.id DESC LIMIT 100`, [req.user.id])));
app.post('/api/groups', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO community_groups(owner_id,name,city,description) VALUES(?,?,?,?)', [req.user.id, text(req.body.name, 100), text(req.body.city, 120), text(req.body.description, 3000)]);
    await connection.execute('INSERT INTO memberships(group_id,user_id) VALUES(?,?)', [result.insertId, req.user.id]);
    await connection.commit(); res.status(201).json({ id: result.insertId });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
});
app.post('/api/groups/:id/join', async (req, res) => {
  const group = await existing('community_groups', req.params.id);
  if (req.body.active === true) await query('INSERT IGNORE INTO memberships(group_id,user_id) VALUES(?,?)', [group.id, req.user.id]);
  else { if (group.owner_id === req.user.id) fail(400, 'Group owners must keep their membership.'); await query('DELETE FROM memberships WHERE group_id=? AND user_id=?', [group.id, req.user.id]); }
  res.json({ ok: true });
});
app.get('/api/events', async (req, res) => res.json(await query(`SELECT e.*,u.name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) AS attendees,
  EXISTS(SELECT 1 FROM rsvps WHERE event_id=e.id AND user_id=?) AS going FROM events e JOIN users u ON u.id=e.user_id WHERE u.banned=FALSE AND e.starts_at>=UTC_TIMESTAMP() ORDER BY e.starts_at LIMIT 100`, [req.user.id])));
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
app.get('/api/listings', async (req, res) => res.json(await query('SELECT l.*,u.name FROM listings l JOIN users u ON u.id=l.user_id WHERE u.banned=FALSE ORDER BY l.sold,l.id DESC LIMIT 100')));
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
  const users = await query('SELECT id,name,email,city,banned,created_at FROM users ORDER BY id DESC LIMIT 200');
  const reports = await query('SELECT r.*,u.name FROM reports r JOIN users u ON u.id=r.user_id WHERE resolved=FALSE ORDER BY r.id DESC LIMIT 200');
  res.json({ users, reports });
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
  const user = await existing('users', req.params.id);
  if (adminEmail(user.email)) fail(400, 'Administrator accounts cannot be suspended here.');
  await query('UPDATE users SET banned=? WHERE id=?', [req.body.banned === true, user.id]); res.json({ ok: true });
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
  setHeaders: res => res.set('Cache-Control', 'no-store').set('CDN-Cache-Control', 'no-store')
}));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'ER_DUP_ENTRY' ? 409 : error.status ?? 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.code === 'ER_DUP_ENTRY' ? 'This email is already registered.' : status >= 500 ? 'Something went wrong. Please try again.' : error.message });
});
await sessionStore.onReady();
const server = app.listen(config.port ?? 3014, config.host ?? '0.0.0.0', () => console.log(`Moms Village v${version} listening on port ${config.port ?? 3014}`));
async function shutdown() { server.close(async () => { await db.end(); await sessionStore.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
