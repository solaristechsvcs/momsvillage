import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { id, text, image } from './validation.js';

export async function socialRouter({ db, query, config, fail, publicUser }) {
  const router = Router();
  const uploadPath = resolve(config.uploadsDirectory ?? './uploads');
  await mkdir(uploadPath, { recursive: true });
  const pair = (a, b) => [Math.min(a, b), Math.max(a, b)];
  const blocked = async (a, b, execute = query) => (await execute('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)', [a, b, b, a])).length > 0;
  async function member(value, self) {
    const peerId = id(value);
    if (peerId === self) fail(400, 'Choose another member.');
    const [peer] = await query('SELECT id,name,city,bio,avatar,created_at FROM users WHERE id=? AND banned=FALSE', [peerId]);
    if (!peer) fail(404, 'Member unavailable.'); return peer;
  }
  async function notify(recipient, actor, kind, target, execute = query) {
    if (recipient === actor || await blocked(recipient, actor, execute)) return;
    await execute('INSERT INTO notifications(user_id,actor_id,kind,target_id) VALUES(?,?,?,?)', [recipient, actor, kind, target]);
  }
  async function transaction(work) {
    const connection = await db.getConnection();
    const execute = async (sql, args = []) => (await connection.execute(sql, args))[0];
    try { await connection.beginTransaction(); const result = await work(execute); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async function withImage(userId, value, work) {
    const url = image(value);
    return transaction(async execute => {
      if (url.startsWith('/api/media/')) {
        const [file] = await execute('SELECT filename FROM uploads WHERE filename=? AND user_id=? FOR UPDATE', [url.slice('/api/media/'.length), userId]);
        if (!file) fail(400, 'Choose an image from your own image library or upload a new one.');
      }
      return work(execute, url);
    });
  }
  // Lock both user records in the same order to serialize block/friend/message races.
  async function lockUsers(execute, a, b) {
    const users = await execute('SELECT id,banned FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE', pair(a, b));
    if (users.length !== 2 || users.some(u => u.banned)) fail(403, 'Member unavailable.');
  }
  router.get('/members', async (req, res) => {
    const term = text(req.query.q ?? '', 100, false).replace(/[\\%_]/g, '\\$&');
    res.json(await query(`SELECT u.id,u.name,u.city,u.bio,u.avatar,u.created_at,
      f.status AS friendship_status,f.requester_id FROM users u
      LEFT JOIN friendships f ON f.user_low=LEAST(u.id,?) AND f.user_high=GREATEST(u.id,?)
      WHERE u.id<>? AND u.banned=FALSE AND (u.name LIKE ? OR u.city LIKE ?)
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.blocked_id=? AND b.user_id=u.id))
      ORDER BY u.name,u.id LIMIT 100`, [req.user.id, req.user.id, req.user.id, `%${term}%`, `%${term}%`, req.user.id, req.user.id]));
  });
  router.get('/relationships/:id', async (req, res) => {
    const peer = await member(req.params.id, req.user.id);
    const [friend] = await query('SELECT status,requester_id FROM friendships WHERE user_low=? AND user_high=?', pair(req.user.id, peer.id));
    const [ownBlock] = await query('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?', [req.user.id, peer.id]);
    res.json({ friendship: friend ?? null, blocked: !!ownBlock, contact_allowed: !await blocked(req.user.id, peer.id) });
  });
  router.get('/friends', async (req, res) => {
    const friends = await query(`SELECT u.id,u.name,u.city,u.bio,u.avatar,u.created_at,f.status,f.requester_id
      FROM friendships f JOIN users u ON u.id=IF(f.user_low=?,f.user_high,f.user_low)
      WHERE (f.user_low=? OR f.user_high=?) AND u.banned=FALSE
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.blocked_id=? AND b.user_id=u.id))
      ORDER BY f.created_at DESC LIMIT 200`, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);
    const blocks = await query('SELECT u.id,u.name,u.avatar FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? ORDER BY b.created_at DESC LIMIT 200', [req.user.id]);
    res.json({ friends, blocks });
  });
  router.post('/friends/:id', async (req, res) => {
    const peer = await member(req.params.id, req.user.id);
    await transaction(async execute => {
      await lockUsers(execute, req.user.id, peer.id);
      if (await blocked(req.user.id, peer.id, execute)) fail(403, 'This member cannot receive your request.');
      const [friend] = await execute('SELECT * FROM friendships WHERE user_low=? AND user_high=?', pair(req.user.id, peer.id));
      if (friend) fail(409, 'A friendship or pending request already exists.');
      await execute('INSERT INTO friendships(user_low,user_high,requester_id) VALUES(?,?,?)', [...pair(req.user.id, peer.id), req.user.id]);
      await notify(peer.id, req.user.id, 'friend_request', req.user.id, execute);
    });
    res.status(201).json({ ok: true });
  });
  router.patch('/friends/:id', async (req, res) => {
    const peer = await member(req.params.id, req.user.id);
    await transaction(async execute => {
      await lockUsers(execute, req.user.id, peer.id);
      if (await blocked(req.user.id, peer.id, execute)) fail(403, 'This request is unavailable.');
      const [friend] = await execute('SELECT * FROM friendships WHERE user_low=? AND user_high=?', pair(req.user.id, peer.id));
      if (!friend || friend.status !== 'pending' || friend.requester_id === req.user.id) fail(403, 'Only the recipient can accept a pending request.');
      await execute("UPDATE friendships SET status='accepted' WHERE user_low=? AND user_high=?", pair(req.user.id, peer.id));
      await notify(peer.id, req.user.id, 'friend_accept', req.user.id, execute);
    });
    res.json({ ok: true });
  });
  router.delete('/friends/:id', async (req, res) => {
    const peerId = id(req.params.id);
    await transaction(async execute => {
      await lockUsers(execute, req.user.id, peerId);
      await execute('DELETE FROM friendships WHERE user_low=? AND user_high=?', pair(req.user.id, peerId));
    });
    res.json({ ok: true });
  });
  router.post('/blocks/:id', async (req, res) => {
    const peer = await member(req.params.id, req.user.id);
    await transaction(async execute => {
      await lockUsers(execute, req.user.id, peer.id);
      await execute('INSERT IGNORE INTO blocks(user_id,blocked_id) VALUES(?,?)', [req.user.id, peer.id]);
      await execute('DELETE FROM friendships WHERE user_low=? AND user_high=?', pair(req.user.id, peer.id));
    });
    res.json({ ok: true });
  });
  router.delete('/blocks/:id', async (req, res) => {
    const peerId = id(req.params.id);
    await transaction(async execute => {
      // Unblocking a suspended member remains possible.
      await execute('SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE', pair(req.user.id, peerId));
      await execute('DELETE FROM blocks WHERE user_id=? AND blocked_id=?', [req.user.id, peerId]);
    });
    res.json({ ok: true });
  });
  router.get('/messages', async (req, res) => {
    const threads = await query(`SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at,u.id AS peer_id,u.name,u.avatar,
      (SELECT COUNT(*) FROM messages x WHERE x.sender_id=u.id AND x.recipient_id=? AND x.read_at IS NULL) AS unread
      FROM messages m JOIN users u ON u.id=IF(m.sender_id=?,m.recipient_id,m.sender_id)
      JOIN (SELECT MAX(id) AS last_id FROM messages WHERE sender_id=? OR recipient_id=? GROUP BY IF(sender_id=?,recipient_id,sender_id)) t ON t.last_id=m.id
      WHERE u.banned=FALSE ORDER BY m.id DESC LIMIT 100`, Array(5).fill(req.user.id));
    res.json(threads);
  });
  router.get('/messages/:id', async (req, res) => {
    const peer = await member(req.params.id, req.user.id);
    const before = req.query.before ? id(req.query.before) : null;
    const messages = await query(`SELECT id,sender_id,recipient_id,body,read_at,created_at FROM messages
      WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ${before ? 'AND id<?' : ''}
      ORDER BY id DESC LIMIT 50`, [req.user.id, peer.id, peer.id, req.user.id, ...(before ? [before] : [])]);
    if (messages.length) {
      const ids = messages.map(m => m.id);
      await query(`UPDATE messages SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE recipient_id=? AND id IN (${ids.map(() => '?').join(',')})`, [req.user.id, ...ids]);
      await query(`UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE user_id=? AND kind='message' AND target_id IN (${ids.map(() => '?').join(',')})`, [req.user.id, ...ids]);
    }
    const [friend] = await query("SELECT 1 FROM friendships WHERE user_low=? AND user_high=? AND status='accepted'", pair(req.user.id, peer.id));
    res.json({ peer, can_send: !!friend && !await blocked(req.user.id, peer.id), messages: messages.reverse(), has_more: messages.length === 50 });
  });
  const messageLimit = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => String(req.user.id), standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/messages/:id', messageLimit, async (req, res) => {
    const peer = await member(req.params.id, req.user.id), body = text(req.body.body, 4000);
    const messageId = await transaction(async execute => {
      await lockUsers(execute, req.user.id, peer.id);
      if (await blocked(req.user.id, peer.id, execute)) fail(403, 'Messaging is unavailable for this member.');
      const [friend] = await execute("SELECT 1 FROM friendships WHERE user_low=? AND user_high=? AND status='accepted'", pair(req.user.id, peer.id));
      if (!friend) fail(403, 'You must be friends before sending a message.');
      const message = await execute('INSERT INTO messages(sender_id,recipient_id,body) VALUES(?,?,?)', [req.user.id, peer.id, body]);
      await notify(peer.id, req.user.id, 'message', message.insertId, execute); return message.insertId;
    });
    res.status(201).json({ id: messageId });
  });
  router.get('/notifications', async (req, res) => {
    const items = await query(`SELECT n.*,u.name,u.avatar FROM notifications n JOIN users u ON u.id=n.actor_id
      WHERE n.user_id=? AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=n.actor_id) OR (b.user_id=n.actor_id AND b.blocked_id=?)) ORDER BY n.id DESC LIMIT 100`, [req.user.id, req.user.id, req.user.id]);
    res.json(items);
  });
  router.patch('/notifications/:id', async (req, res) => {
    await query('UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=? AND user_id=?', [id(req.params.id), req.user.id]);
    res.json({ ok: true });
  });
  router.post('/notifications/read', async (req, res) => {
    const through = id(req.body.through_id);
    await query('UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE user_id=? AND id<=?', [req.user.id, through]); res.json({ ok: true });
  });
  router.get('/unread', async (req, res) => {
    const [counts] = await query(`SELECT
      (SELECT COUNT(*) FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=? AND n.read_at IS NULL AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=n.actor_id) OR (b.user_id=n.actor_id AND b.blocked_id=?))) AS notifications,
      (SELECT COUNT(*) FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.recipient_id=? AND m.read_at IS NULL AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=m.sender_id) OR (b.user_id=m.sender_id AND b.blocked_id=?))) AS messages`, Array(6).fill(req.user.id));
    res.json(counts);
  });
  async function reportMessage(req, res) {
    const [message] = await query('SELECT id FROM messages WHERE id=? AND (sender_id=? OR recipient_id=?)', [id(req.body.id), req.user.id, req.user.id]);
    if (!message) fail(404, 'Message not found.');
    await query("INSERT INTO reports(user_id,target_type,target_id,reason) VALUES(?,'message',?,?)", [req.user.id, message.id, text(req.body.reason, 2000)]);
    res.status(201).json({ ok: true });
  }

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 2 } }).single('image');
  const uploadLimit = rateLimit({ windowMs: 60000, limit: 8, keyGenerator: req => String(req.user.id), standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/uploads', uploadLimit, (req, res, next) => upload(req, res, error => {
    if (error) return next(Object.assign(new Error('Choose one image under 8 MB.'), { status: 400 })); next();
  }), async (req, res) => {
    if (!req.file) fail(400, 'Choose an image to upload.');
    let data;
    try {
      const source = sharp(req.file.buffer, { limitInputPixels: 25000000, animated: false });
      const metadata = await source.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1) fail(400, 'Choose a still JPEG, PNG, or WebP image.');
      data = await source.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch { fail(400, 'That image could not be processed. Use a still JPEG, PNG, or WebP up to 25 megapixels.'); }
    const filename = randomBytes(16).toString('hex') + '.webp';
    const connection = await db.getConnection(); let locked = false, written = false;
    const lockName = `mv-media-${config.mysql.database}`.slice(0, 64);
    try {
      const [[result]] = await connection.execute('SELECT GET_LOCK(?,10) AS acquired', [lockName]);
      locked = Number(result.acquired) === 1;
      if (!locked) fail(503, 'Uploads are busy. Try again shortly.');
      const [[usage]] = await connection.execute('SELECT COALESCE(SUM(bytes),0) AS total,COALESCE(SUM(IF(user_id=?,bytes,0)),0) AS personal FROM uploads', [req.user.id]);
      if (Number(usage.personal) + data.length > 100 * 1024 * 1024 || Number(usage.total) + data.length > 2 * 1024 * 1024 * 1024) fail(413, 'Image storage is full. Remove unused images from your profile image library.');
      await writeFile(resolve(uploadPath, filename), data, { flag: 'wx' }); written = true;
      await connection.execute('INSERT INTO uploads(filename,user_id,bytes) VALUES(?,?,?)', [filename, req.user.id, data.length]);
      written = false;
      res.status(201).json({ url: `/api/media/${filename}` });
    } finally {
      if (written) await unlink(resolve(uploadPath, filename)).catch(() => {});
      if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]); connection.release();
    }
  });
  router.get('/media/:filename', async (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-f0-9]{32}\.webp$/.test(filename)) fail(404, 'Image not found.');
    const [record] = await query('SELECT u.banned FROM uploads f JOIN users u ON u.id=f.user_id WHERE f.filename=?', [filename]);
    if (!record || (record.banned && !req.isAdmin)) fail(404, 'Image not found.');
    res.type('image/webp').set('Content-Disposition', 'inline').sendFile(resolve(uploadPath, filename));
  });
  router.get('/uploads', async (req, res) => res.json(await query('SELECT filename,bytes,created_at FROM uploads WHERE user_id=? ORDER BY created_at DESC LIMIT 200', [req.user.id])));
  router.delete('/uploads/:filename', async (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-f0-9]{32}\.webp$/.test(filename)) fail(400, 'Invalid image.');
    await transaction(async execute => {
      const [record] = await execute('SELECT filename FROM uploads WHERE filename=? AND user_id=? FOR UPDATE', [filename, req.user.id]);
      if (!record) fail(404, 'Image not found.');
      const url = `/api/media/${filename}`;
      const [used] = await execute('SELECT (SELECT COUNT(*) FROM users WHERE avatar=?)+(SELECT COUNT(*) FROM posts WHERE image=?)+(SELECT COUNT(*) FROM listings WHERE image=?) AS total', [url, url, url]);
      if (Number(used.total)) fail(409, 'This image is in use. Remove it from the profile, post, or listing first.');
      await execute('DELETE FROM uploads WHERE filename=? AND user_id=?', [filename, req.user.id]);
    });
    await unlink(resolve(uploadPath, filename)).catch(error => { if (error.code !== 'ENOENT') throw error; }); res.json({ ok: true });
  });
  return { router, notify, reportMessage, withImage };
}
