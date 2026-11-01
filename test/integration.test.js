import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, unlink, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';

test('MySQL-backed community workflows and access controls', { skip: process.env.MV_INTEGRATION !== '1', timeout: 60000 }, async () => {
  const configFile = new URL('../config.js', import.meta.url);
  let exists = true; try { await access(configFile); } catch { exists = false; }
  assert.equal(exists, false, 'Refusing to overwrite an existing config.js. Integration tests are for disposable CI databases only.');
  const code = randomBytes(32).toString('hex');
  await writeFile(configFile, `export default ${JSON.stringify({ host: '127.0.0.1', port: 3099, sessionSecret: randomBytes(48).toString('hex'), secureCookies: false, trustProxy: 1, mysql: { host: '127.0.0.1', port: 3306, user: 'root', password: 'integration-only-password', database: 'momsvillage_test' }, adminEmails: ['admin@example.com'], adminRegistrationCode: code })}`, { flag: 'wx', mode: 0o600 });
  // Seed an old admin flag whose email was removed from the previous allowlist.
  const mysql = (await import('mysql2/promise')).default;
  const seed = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'integration-only-password', database: 'momsvillage_test' });
  try {
    const oldSchema = await (await import('node:fs/promises')).readFile(new URL('../schema.sql', import.meta.url), 'utf8');
    for (const statement of oldSchema.split(';').map(s => s.trim()).filter(Boolean)) await seed.query(statement);
    const bcrypt = (await import('bcryptjs')).default;
    await seed.execute('INSERT INTO users(name,email,password,is_admin,bio) VALUES(?,?,?,?,?)', ['Retired admin', 'retired@example.com', await bcrypt.hash('legacy-password-123', 4), true, 'Legacy account']);
    await seed.query("CREATE TABLE user_badges(user_id INT UNSIGNED NOT NULL,badge ENUM('developer') NOT NULL,PRIMARY KEY(user_id,badge),FOREIGN KEY(user_id) REFERENCES users(id))");
    await seed.query("INSERT INTO user_badges(user_id,badge) SELECT id,'developer' FROM users WHERE email='retired@example.com'");
  } finally { await seed.end(); }
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; console.log('[server]', String(d).trim()); });
  child.stderr.on('data', d => { output += d; console.log('[server error]', String(d).trim()); });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 45000);
  const base = 'http://127.0.0.1:3099';
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok; if (ready) break; } catch {}
      await delay(250);
    }
    assert.ok(ready, output || 'Server did not start.');
    let clientCounter = 1;
    function client() {
      const proxyAddress = `192.0.2.${clientCounter++}`;
      let cookie = '', csrf = '';
      return async (path, method = 'GET', body, status = 200, withCsrf = true) => {
        console.log('[integration]', method, path);
        if (path === '/register') body = { eligibility_confirmed:true, application_reason:'I am a mother looking for a supportive community.', ...body };
        const multipart = body instanceof FormData;
        const r = await fetch(base + '/api' + path, { signal: AbortSignal.timeout(10000), method, headers: { cookie, 'x-forwarded-for': proxyAddress, ...(!multipart ? { 'Content-Type': 'application/json' } : {}), ...(withCsrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? (multipart ? body : JSON.stringify(body)) : undefined }).catch(error => { throw new Error(`${method} ${path}: ${error.message}`); });
        const setCookie = r.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
        const data = r.headers.get('content-type')?.startsWith('application/json') ? await r.json() : { bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') }; assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
        if (data.csrf) csrf = data.csrf; return data;
      };
    }
    const a = client(), b = client(), admin = client(), guest = client();
    async function approveMember(member, userId) {
      const own = await member('/membership');
      await admin('/admin/membership-applications/' + userId, 'PATCH', { action:'approve',revision:own.application.revision,message:'' });
    }

    await guest('/posts', 'GET', undefined, 401);
    await a('/session');
    await a('/register', 'POST', { name: 'Mom A', email: 'a@example.com', password: 'a-long-password-123', agree: true, city: 'Austin' }, 403, false);
    await a('/register', 'POST', { name: 'Mom A', email: 'a@example.com', password: 'a-long-password-123', agree: true, city: 'Austin' }, 201);
    const userA = (await a('/session')).user;
    await b('/session'); await b('/register', 'POST', { name: 'Mom B', email: 'b@example.com', password: 'a-long-password-123', agree: true }, 201); const userB = (await b('/session')).user;
    await admin('/session');
    await admin('/register', 'POST', { name: 'Admin', email: 'admin@example.com', password: 'a-long-password-123', agree: true }, 403);
    await admin('/register', 'POST', { name: 'Admin', email: 'admin@example.com', password: 'a-long-password-123', agree: true, setup_code: code }, 201);
    assert.equal((await admin('/session')).user.admin, true);
    assert.equal(userA.membership_status, 'pending'); assert.equal(userA.verified_member,false);
    for (const path of ['/posts','/members','/members/' + userB.id,'/groups','/events','/listings','/messages','/notifications','/unread','/uploads','/invitations','/admin','/admin/membership-applications','/admin/verification','/media/0123456789abcdef0123456789abcdef.webp']) await a(path,'GET',undefined,403);
    await a('/posts','POST',{ body:'Unauthorized post' },403);
    await a('/uploads','POST',{},403);
    await a('/invitations','POST',{},403);
    await a('/verification/attempts','POST',{consent:true},403);
    await approveMember(a,userA.id); await approveMember(b,userB.id);

    await b('/admin', 'GET', undefined, 403);
    await a('/profile', 'PATCH', { name: 'Mom A', city: 'Austin', bio: 'Hello village', avatar: '' });
    const profile = await b(`/members/${userA.id}`); assert.equal(profile.bio, 'Hello village'); assert.equal(profile.email, undefined);
    const post = await a('/posts', 'POST', { body: 'First village conversation', image: '' }, 201);
    await b(`/content/post/${post.id}`, 'DELETE', undefined, 403);
    await b(`/posts/${post.id}/like`, 'POST', { active: true });
    await b(`/posts/${post.id}/like`, 'POST', { active: true });
    assert.equal((await a('/posts'))[0].like_count, 1);
    await b(`/posts/${post.id}/comments`, 'POST', { body: 'Welcome!' }, 201);
    const comment = (await a(`/posts/${post.id}/comments`))[0]; assert.equal(comment.body, 'Welcome!');
    await a(`/content/comment/${comment.id}`, 'DELETE', undefined, 403);
    const group = await a('/groups', 'POST', { name: 'Austin Moms', city: 'Austin', description: 'Local friends' }, 201);
    await b('/posts', 'POST', { group_id: group.id, body: 'Hi', image: '' }, 403);
    await b(`/groups/${group.id}/join`, 'POST', { active: true });
    await b('/posts', 'POST', { group_id: group.id, body: 'Hello Austin', image: '' }, 201);
    assert.equal((await b(`/posts?group=${group.id}`)).length, 1);
    await a('/events', 'POST', { title: 'Park day', location: 'Public park', starts_at: new Date(Date.now() + 86400000).toISOString(), description: 'Meet nearby' }, 201);
    const event = (await b('/events'))[0]; await b(`/events/${event.id}/rsvp`, 'POST', { active: true }); assert.equal((await a('/events'))[0].attendees, 1);
    await b(`/events/${event.id}/rsvp`, 'POST', { active: false }); assert.equal((await a('/events'))[0].attendees, 0);
    await a('/listings', 'POST', { title: 'Stroller', description: 'Gently used', price: '25.50', city: 'Austin', image: '', contact: 'Contact me at my public handle' }, 201);
    const listing = (await a('/listings'))[0]; await b(`/listings/${listing.id}`, 'PATCH', { sold: true }, 403); await a(`/listings/${listing.id}`, 'PATCH', { sold: true }); assert.equal(Number((await b('/listings'))[0].sold), 1);
    await b('/reports', 'POST', { type: 'post', id: post.id, reason: 'Please review this' }, 201);
    const report = (await admin('/admin')).reports[0]; assert.equal((await admin(`/admin/reports/${report.id}/content`)).body, 'First village conversation');
    await admin(`/content/post/${post.id}`, 'DELETE'); await admin(`/admin/reports/${report.id}`, 'PATCH', {}); assert.equal((await admin('/admin')).reports.length, 0);
    await admin(`/admin/users/${userB.id}`, 'PATCH', { banned: true }); await b('/posts', 'GET', undefined, 403);
    await admin(`/admin/users/${userB.id}`, 'PATCH', { banned: false }); await b('/posts');
    await a('/logout', 'POST'); await a('/session'); await a('/login', 'POST', { email: 'a@example.com', password: 'a-long-password-123' }); assert.equal((await a('/session')).user.id, userA.id);

    // Friend requests cannot be self-accepted or sent through a block.
    const c = client(); await c('/session');
    await c('/register', 'POST', { name: 'Mom C', email: 'c@example.com', password: 'a-long-password-123', agree: true, is_admin: true, staff_badge: true, developer_badge: true }, 201);
    const userC = (await c('/session')).user; assert.equal(userC.admin, false); assert.equal(userC.staff_badge, false); assert.equal(userC.developer_badge, false);
    await approveMember(c,userC.id);
    assert.ok((await a('/members?q=Austin')).some(u => u.id === userA.id) === false);
    await a(`/messages/${userB.id}`, 'POST', { body: 'Before friendship' }, 403);
    await a(`/friends/${userA.id}`, 'POST', {}, 400);
    await a(`/friends/${userB.id}`, 'POST', {}, 201);
    await b(`/friends/${userA.id}`, 'POST', {}, 409);
    await a(`/friends/${userB.id}`, 'PATCH', {}, 403);
    assert.equal((await b('/friends')).friends[0].status, 'pending');
    assert.ok((await b('/notifications')).some(n => n.kind === 'friend_request'));
    await b(`/friends/${userA.id}`, 'PATCH', {});
    assert.equal((await a('/friends')).friends[0].status, 'accepted');
    const firstMessage = await a(`/messages/${userB.id}`, 'POST', { body: 'A private hello' }, 201);
    assert.equal((await b('/unread')).messages, 1);
    assert.equal((await b('/messages'))[0].body, 'A private hello');
    const history = await b(`/messages/${userA.id}`);
    assert.equal(history.messages[0].body, 'A private hello');
    assert.equal(history.can_send, true);
    assert.equal((await b('/unread')).messages, 0);
    assert.equal((await c(`/messages/${userA.id}`)).messages.length, 0);
    assert.equal((await admin(`/messages/${userA.id}`)).messages.length, 0);
    await c('/reports', 'POST', { type: 'message', id: firstMessage.id, reason: 'Not my message' }, 404);
    await b('/reports', 'POST', { type: 'message', id: firstMessage.id, reason: 'Review this individual message' }, 201);
    const messageReport = (await admin('/admin')).reports[0];
    assert.equal((await admin(`/admin/reports/${messageReport.id}/content`)).body, 'A private hello');
    await b(`/blocks/${userA.id}`, 'POST', {});
    assert.equal((await a('/friends')).friends.length, 0);
    await a(`/messages/${userB.id}`, 'POST', { body: 'Blocked message' }, 403);
    await a(`/friends/${userB.id}`, 'POST', {}, 403);
    assert.equal((await a('/members?q=Mom%20B')).length, 0);
    assert.equal((await b(`/messages/${userA.id}`)).can_send, false);
    await b(`/blocks/${userA.id}`, 'DELETE');
    await a(`/messages/${userB.id}`, 'POST', { body: 'Unfriended' }, 403);
    await a(`/friends/${userB.id}`, 'POST', {}, 201); await b(`/friends/${userA.id}`, 'PATCH', {});
    // Repeated likes do not duplicate notifications. Comments notify the post author.
    const newPost = await a('/posts', 'POST', { body: 'Notify me', image: '' }, 201);
    await b(`/posts/${newPost.id}/like`, 'POST', { active: true }); await b(`/posts/${newPost.id}/like`, 'POST', { active: true });
    await b(`/posts/${newPost.id}/comments`, 'POST', { body: 'Hello again' }, 201);
    const alerts = await a('/notifications');
    assert.equal(alerts.filter(n => n.kind === 'like' && n.target_id === newPost.id).length, 1);
    assert.ok(alerts.some(n => n.kind === 'comment' && n.target_id === newPost.id));
    const privateAlert = alerts.find(n => !n.read_at);
    await c(`/notifications/${privateAlert.id}`, 'PATCH', {});
    assert.ok((await a('/notifications')).find(n => n.id === privateAlert.id).read_at === null);
    await a('/notifications/read', 'POST', { through_id: Math.max(...alerts.map(n => n.id)) });
    assert.equal((await a('/unread')).notifications, 0);
    await admin(`/content/message/${firstMessage.id}`, 'DELETE');
    assert.equal((await b(`/messages/${userA.id}`)).messages.length, 0);
    const unreported = await a(`/messages/${userB.id}`, 'POST', { body: 'Unreported private message' }, 201);
    await admin(`/content/message/${unreported.id}`, 'DELETE', undefined, 403);
    // Images require a session, real image bytes, ownership on attachment, and safe deletion.
    const sharp = (await import('sharp')).default;
    const photo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#779966' } }).withMetadata({ exif: { IFD0: { Artist: 'Remove this metadata' } } }).jpeg().toBuffer();
    const multipart = bytes => { const f = new FormData(); f.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg'); return f; };
    await guest('/session'); await guest('/uploads', 'POST', multipart(photo), 401);
    await a('/uploads', 'POST', multipart(Buffer.from('<svg><script>alert(1)</script></svg>')), 400);
    await a('/uploads', 'POST', multipart(Buffer.alloc(8 * 1024 * 1024 + 1)), 400);
    const uploaded = await a('/uploads', 'POST', multipart(photo), 201);
    assert.match(uploaded.url, /^\/api\/media\/[a-f0-9]{32}\.webp$/);
    const mediaPath = uploaded.url.slice(4);
    const saved = await a(mediaPath); assert.match(saved.type, /^image\/webp/);
    assert.equal((await sharp(saved.bytes).metadata()).exif, undefined);
    await guest(mediaPath, 'GET', undefined, 401);
    await a('/profile', 'PATCH', { name: 'Mom A', city: 'Austin', bio: 'Photo test', avatar: uploaded.url });
    const filename = uploaded.url.split('/').pop();
    await b(`/uploads/${filename}`, 'DELETE', undefined, 404);
    await b('/posts', 'POST', { body: 'Stolen upload reference', image: uploaded.url }, 400);
    await a(`/uploads/${filename}`, 'DELETE', undefined, 409);
    await a('/profile', 'PATCH', { name: 'Mom A', city: 'Austin', bio: 'Photo removed', avatar: '' });
    await a(`/uploads/${filename}`, 'DELETE'); await a(mediaPath, 'GET', undefined, 404);
    assert.equal((await a('/uploads')).length, 0);
    await admin(`/admin/users/${userB.id}`, 'PATCH', { banned: true });
    await a(`/messages/${userB.id}`, 'POST', { body: 'Suspended target' }, 404);
    await admin(`/admin/users/${userB.id}`, 'PATCH', { banned: false });

    // Administrators can manage roles without editing the bootstrap email list.
    const retired = client(); await retired('/session');
    await retired('/login', 'POST', { email: 'retired@example.com', password: 'legacy-password-123' });
    assert.equal((await retired('/session')).user.admin, false, 'Migration must not reactivate previously removed admins');
    await a(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: true }, 403);
    await admin(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: 'true' }, 400);
    await admin(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: true });
    assert.equal((await b('/session')).user.admin, true);
    assert.ok((await b('/admin')).users.find(u => u.id === userB.id).is_admin);
    await admin(`/admin/users/${userB.id}`, 'PATCH', { banned: true }, 400);
    await b(`/admin/users/${userC.id}/role`, 'PATCH', { is_admin: true });
    assert.equal((await c('/session')).user.admin, true);
    await b(`/admin/users/${userC.id}/role`, 'PATCH', { is_admin: false });
    await c('/admin', 'GET', undefined, 403);
    const staffProfile = await admin(`/admin/users/${userB.id}/profile`);
    assert.equal(staffProfile.email, 'b@example.com'); assert.equal(staffProfile.is_admin, true);
    await a(`/admin/users/${userB.id}/profile`, 'GET', undefined, 403);
    await admin(`/admin/users/${userC.id}`, 'PATCH', { banned: true });
    assert.equal((await admin(`/admin/users/${userC.id}/profile`)).banned, true);
    await admin(`/admin/users/${userC.id}/role`, 'PATCH', { is_admin: true }, 400);
    await admin(`/admin/users/${userC.id}`, 'PATCH', { banned: false });
    assert.equal((await admin('/admin?q=b%40example.com')).users.length, 1);
    // Restart migration checks must preserve new admins absent from config.adminEmails.
    const checkDb = mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'root', password: 'integration-only-password', database: 'momsvillage_test' });
    try {
      await (await import('../admin.js')).initializeAdminRoles(checkDb, { mysql: { database: 'momsvillage_test' }, adminEmails: ['admin@example.com'] });
      assert.equal((await b('/session')).user.admin, true);
      const [[count]] = await checkDb.query("SELECT COUNT(*) AS total FROM admin_audit WHERE action='grant_admin'");
      assert.ok(Number(count.total) >= 2);
    } finally { await checkDb.end(); }
    // Concurrent self-demotions must never remove both active administrators.
    const ownerId = (await admin('/session')).user.id;
    const demotions = await Promise.allSettled([
      admin(`/admin/users/${ownerId}/role`, 'PATCH', { is_admin: false }),
      b(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: false })
    ]);
    assert.equal(demotions.filter(r => r.status === 'fulfilled').length, 1);
    if (!(await admin('/session')).user.admin) await b(`/admin/users/${ownerId}/role`, 'PATCH', { is_admin: true });
    await admin(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: false });
    await b('/admin', 'GET', undefined, 403);
    await admin(`/admin/users/${ownerId}/role`, 'PATCH', { is_admin: false }, 400);

    // Staff badges follow actual admin roles; Developer is an independent, admin-managed badge.
    assert.equal((await a(`/members/${ownerId}`)).staff_badge, 1);
    assert.equal((await a(`/members/${userB.id}`)).staff_badge, 0);
    await a(`/admin/users/${userB.id}/developer-badge`, 'PATCH', { enabled: true }, 403);
    await b(`/admin/users/${userB.id}/developer-badge`, 'PATCH', { enabled: true }, 403);
    await admin(`/admin/users/${userB.id}/developer-badge`, 'PATCH', { enabled: 'true' }, 400);
    await admin(`/admin/users/${userB.id}/developer-badge`, 'PATCH', { enabled: true });
    assert.equal((await b('/session')).user.developer_badge, true);
    assert.equal((await b('/session')).user.admin, false);
    await b('/admin', 'GET', undefined, 403);
    const badgeProfile = await a(`/members/${userB.id}`);
    assert.equal(badgeProfile.developer_badge, 1); assert.equal(badgeProfile.email, undefined);
    await a('/profile', 'PATCH', { name: 'Mom A', city: 'Austin', bio: 'No badge spoofing', avatar: '', staff_badge: true, developer_badge: true, is_admin: true, verified_member:true });
    assert.equal((await a('/session')).user.staff_badge, false); assert.equal((await a('/session')).user.verified_member,false);
    assert.equal((await a('/session')).user.developer_badge, false);
    await b(`/posts/${newPost.id}/comments`, 'POST', { body: 'Developer comment' }, 201);
    assert.equal((await a(`/posts/${newPost.id}/comments`)).find(c => c.body === 'Developer comment').developer_badge, 1);
    const devPost = await b('/posts', 'POST', { body: 'Developer post', image: '' }, 201);
    assert.equal((await a(`/posts?post=${devPost.id}`))[0].developer_badge, 1);
    await admin(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: true });
    const both = await a(`/members/${userB.id}`); assert.equal(both.staff_badge, 1); assert.equal(both.developer_badge, 1);
    await admin(`/admin/users/${userB.id}/role`, 'PATCH', { is_admin: false });
    const onlyDeveloper = await a(`/members/${userB.id}`); assert.equal(onlyDeveloper.staff_badge, 0); assert.equal(onlyDeveloper.developer_badge, 1);
    await admin(`/admin/users/${userB.id}/developer-badge`, 'PATCH', { enabled: false });
    assert.equal((await b('/session')).user.developer_badge, false);
    await admin(`/admin/users/${userC.id}`, 'PATCH', { banned: true });
    await admin(`/admin/users/${userC.id}/developer-badge`, 'PATCH', { enabled: true }, 400);
    await admin(`/admin/users/${userC.id}`, 'PATCH', { banned: false });

    // The old ENUM storage must upgrade without removing existing Developer badges.
    assert.equal((await retired('/session')).user.developer_badge, true);
    for (const badge of ['founding_member', 'tester']) {
      await a(`/admin/users/${userB.id}/badges/${badge}`, 'PATCH', { enabled: true }, 403);
      await admin(`/admin/users/${userB.id}/badges/${badge}`, 'PATCH', { enabled: true });
    }
    await admin(`/admin/users/${userB.id}/badges/staff`, 'PATCH', { enabled: true }, 400);
    await admin(`/admin/users/${userB.id}/badges/tester`, 'PATCH', { enabled: 'yes' }, 400);
    const specialBadges = (await b('/session')).user;
    assert.equal(specialBadges.founding_member_badge, true); assert.equal(specialBadges.tester_badge, true); assert.equal(specialBadges.admin, false);
    await b('/admin', 'GET', undefined, 403);
    const publicBadges = await a(`/members/${userB.id}`);
    assert.equal(publicBadges.founding_member_badge, 1); assert.equal(publicBadges.tester_badge, 1);
    assert.equal((await a(`/posts?post=${devPost.id}`))[0].tester_badge, 1);
    await a('/profile', 'PATCH', { name: 'Mom A', city: 'Austin', bio: 'Badge permissions', avatar: '', founding_member_badge: true, tester_badge: true });
    const noSpoof = (await a('/session')).user; assert.equal(noSpoof.founding_member_badge, false); assert.equal(noSpoof.tester_badge, false);
    await admin(`/admin/users/${userB.id}/badges/founding_member`, 'PATCH', { enabled: false });
    const stillTester = (await b('/session')).user; assert.equal(stillTester.founding_member_badge, false); assert.equal(stillTester.tester_badge, true);
    await admin(`/admin/users/${userB.id}/badges/tester`, 'PATCH', { enabled: false });
    assert.equal((await b('/session')).user.tester_badge, false);

    // Feed previews contain exactly the newest visible comment and correct visible counts.
    const previewPost = await a('/posts', 'POST', { body: 'Comment preview test', image: '' }, 201);
    assert.equal((await a(`/posts?post=${previewPost.id}`))[0].latest_comment, null);
    await b(`/posts/${previewPost.id}/comments`, 'POST', { body: 'Older comment' }, 201);
    await c(`/posts/${previewPost.id}/comments`, 'POST', { body: 'Newest comment' }, 201);
    let preview = (await a(`/posts?post=${previewPost.id}`))[0];
    assert.equal(preview.latest_comment.body, 'Newest comment'); assert.equal(preview.comment_count, 2);
    await admin(`/admin/users/${userC.id}`, 'PATCH', { banned: true });
    preview = (await a(`/posts?post=${previewPost.id}`))[0];
    assert.equal(preview.latest_comment.body, 'Older comment'); assert.equal(preview.comment_count, 1);
    await admin(`/admin/users/${userC.id}`, 'PATCH', { banned: false });
    const conversation = await a(`/posts/${previewPost.id}/comments`);
    assert.deepEqual(conversation.map(c => c.body), ['Older comment', 'Newest comment']);
    await c(`/content/comment/${conversation[1].id}`, 'DELETE');
    assert.equal((await a(`/posts?post=${previewPost.id}`))[0].latest_comment.body, 'Older comment');
    await b(`/content/comment/${conversation[0].id}`, 'DELETE');
    preview = (await a(`/posts?post=${previewPost.id}`))[0];
    assert.equal(preview.latest_comment, null); assert.equal(preview.comment_count, 0);
    // Latest conversation page includes the newest comment; older pages remain accessible.
    const commentDb = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'integration-only-password', database: 'momsvillage_test' });
    try { await commentDb.query('INSERT INTO comments(post_id,user_id,body) VALUES ?', [Array.from({ length: 105 }, (_, i) => [previewPost.id, userA.id, `Page comment ${i}`])]); }
    finally { await commentDb.end(); }
    const latestPage = await a(`/posts/${previewPost.id}/comments`);
    assert.equal(latestPage.length, 100); assert.equal(latestPage[0].body, 'Page comment 5'); assert.equal(latestPage[99].body, 'Page comment 104');
    const olderPage = await a(`/posts/${previewPost.id}/comments?before=${latestPage[0].id}`);
    assert.equal(olderPage.length, 5); assert.equal(olderPage[0].body, 'Page comment 0');
    assert.equal((await a(`/posts?post=${previewPost.id}`))[0].latest_comment.body, 'Page comment 104');

    // Existing non-admin accounts are gated on rollout and cannot be silently approved.
    assert.equal((await retired('/session')).user.membership_status, 'pending');
    await retired('/posts','GET',undefined,403);
    let retiredApp = await retired('/membership');
    await admin('/admin/membership-applications/' + retiredApp.application.user_id,'PATCH',{action:'approve',revision:retiredApp.application.revision,message:''},400);
    // Review workflow: no self-approval, stale decisions rejected, feedback and resubmission supported.
    const applicant = client(); await applicant('/session');
    await applicant('/register','POST',{name:'New applicant',email:'applicant@example.com',password:'a-long-password-123',agree:true,eligibility_confirmed:false},400);
    await applicant('/register','POST',{name:'New applicant',email:'applicant@example.com',password:'a-long-password-123',agree:true,membership_status:'approved',is_admin:true},201);
    const applicantUser = (await applicant('/session')).user;
    assert.equal(applicantUser.membership_status,'pending'); assert.equal(applicantUser.admin,false);
    const applicantId = applicantUser.id;
    await a('/members/' + applicantId,'GET',undefined,404);
    await admin('/admin/users/' + applicantId + '/role','PATCH',{is_admin:true},400);
    await applicant('/admin/membership-applications/' + applicantId,'PATCH',{action:'approve',revision:1,message:''},403);
    let ownApplication = await applicant('/membership'), oldRevision = ownApplication.application.revision;
    await applicant('/membership/application','PUT',{eligibility_confirmed:true,application_reason:'Updated application answers',status:'approved'});
    await admin('/admin/membership-applications/' + applicantId,'PATCH',{action:'approve',revision:oldRevision,message:''},409);
    ownApplication = await applicant('/membership');
    assert.equal(ownApplication.status,'pending');
    await admin('/admin/membership-applications/' + applicantId,'PATCH',{action:'request_changes',revision:ownApplication.application.revision,message:'Please explain what you seek from this community.'});
    ownApplication = await applicant('/membership'); assert.ok(ownApplication.application.review_message.includes('Please explain'));
    await applicant('/membership/application','PUT',{eligibility_confirmed:true,application_reason:'I am a mother seeking friendships and peer support.'});
    ownApplication = await applicant('/membership'); assert.equal(ownApplication.application.review_message,'');
    await admin('/admin/membership-applications/' + applicantId,'PATCH',{action:'decline',revision:ownApplication.application.revision,message:'Please review the membership policy.'});
    assert.equal((await applicant('/session')).user.membership_status,'declined');
    await applicant('/invitations','POST',{},403); await applicant('/posts','GET',undefined,403);
    const membershipDb = await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'integration-only-password',database:'momsvillage_test'});
    try {
      await (await import('../membership.js')).initializeMembership(membershipDb);
      assert.equal((await applicant('/membership')).status,'declined','Restart must not overwrite membership decisions');
      await applicant('/membership/application','PUT',{eligibility_confirmed:true,application_reason:'A revised application as an adult mother.'});
      await approveMember(applicant,applicantId);
      assert.equal((await applicant('/session')).user.membership_status,'approved'); await applicant('/posts');
      await applicant('/membership/application','PUT',{eligibility_confirmed:true,application_reason:'Cannot reset approved membership'},403);
      await admin('/admin/membership-applications/' + ownerId,'PATCH',{action:'decline',revision:(await admin('/membership')).application.revision,message:'Cannot remove an admin'},400);
      await admin('/admin/users/' + applicantId,'PATCH',{banned:true});
      assert.equal((await applicant('/membership')).status,'suspended');
      await applicant('/membership/application','PUT',{eligibility_confirmed:true,application_reason:'Cannot bypass suspension'},403);
      await applicant('/uploads','POST',{},403);
      await admin('/admin/users/' + applicantId,'PATCH',{banned:false});
      assert.equal((await applicant('/membership')).status,'approved');
      // Invitations never approve users, and their secrets never appear in list APIs.
      const referral = await a('/invitations','POST',{},201);
      assert.match(referral.code,/^[a-f0-9]{48}$/);
      const personalInvitations = await a('/invitations');
      assert.ok(personalInvitations.every(i=>!Object.hasOwn(i,'code')&&!Object.hasOwn(i,'code_hash')));
      const candidates = [client(),client()];
      await Promise.all(candidates.map(c=>c('/session')));
      const races = await Promise.allSettled(candidates.map((c,i)=>c('/register','POST',{name:'Invited mom ' + i,email:'invited' + i + '@example.com',password:'a-long-password-123',agree:true,invitation_code:referral.code},201)));
      assert.equal(races.filter(r=>r.status==='fulfilled').length,1,'An invitation must be redeemable only once');
      const winner = candidates[races.findIndex(r=>r.status==='fulfilled')], invitedUser=(await winner('/session')).user;
      assert.equal(invitedUser.membership_status,'pending'); await winner('/posts','GET',undefined,403);
      const invitedReview = (await admin('/admin/membership-applications?user_id=' + invitedUser.id))[0];
      assert.equal(invitedReview.inviter_id,userA.id);
      const [[createdCount]] = await membershipDb.query("SELECT COUNT(*) AS total FROM users WHERE email IN ('invited0@example.com','invited1@example.com')");
      assert.equal(createdCount.total,1,'Failed redemption must roll back account creation');
      const revocable = await a('/invitations','POST',{},201);
      let issued=(await a('/invitations')).find(i=>i.suffix===revocable.code.slice(-6));
      await b('/invitations/' + issued.id,'DELETE',undefined,403); await a('/invitations/' + issued.id,'DELETE');
      const invalidInvite = client(); await invalidInvite('/session');
      await invalidInvite('/register','POST',{name:'Invalid invite',email:'invalidinvite@example.com',password:'a-long-password-123',agree:true,invitation_code:revocable.code},400);
      const expiring = await a('/invitations','POST',{},201); issued=(await a('/invitations')).find(i=>i.suffix===expiring.code.slice(-6));
      await membershipDb.execute('UPDATE membership_invitations SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id=?',[issued.id]);
      await invalidInvite('/register','POST',{name:'Expired invite',email:'expiredinvite@example.com',password:'a-long-password-123',agree:true,invitation_code:expiring.code},400);
      const unavailable = await a('/invitations','POST',{},201);
      await admin('/admin/users/' + userA.id,'PATCH',{banned:true});
      await invalidInvite('/register','POST',{name:'Unavailable inviter',email:'unavailable@example.com',password:'a-long-password-123',agree:true,invitation_code:unavailable.code},400);
      await admin('/admin/users/' + userA.id,'PATCH',{banned:false});
      issued=(await a('/invitations')).find(i=>i.suffix===unavailable.code.slice(-6)); await admin('/invitations/' + issued.id,'DELETE');
      for (let i=0;i<5;i++) await a('/invitations','POST',{},201);
      await a('/invitations','POST',{},429);
      const allInvites=await admin('/admin/invitations'); assert.ok(allInvites.every(i=>!Object.hasOwn(i,'code')&&!Object.hasOwn(i,'code_hash')));
      await assert.rejects((await import('../membership.js')).registerMembership({db:membershipDb,body:{eligibility_confirmed:true,application_reason:'Invite-only application'},passwordHash:'unused',email:'inviteonly@example.com',name:'Applicant',requestedAdmin:false,config:{membership:{inviteOnly:true}},fail:(status,message)=>{throw Object.assign(new Error(message),{status});}}),{status:400});
      // Decisions revoke an existing session's community access on its next request.
      ownApplication = await applicant('/membership');
      await admin('/admin/membership-applications/' + applicantId,'PATCH',{action:'decline',revision:ownApplication.application.revision,message:'Membership under review.'});
      await applicant('/posts','GET',undefined,403);
      assert.equal((await applicant('/session')).user.membership_status,'declined');
      await a('/members/' + applicantId,'GET',undefined,404);
      const [[audit]] = await membershipDb.execute("SELECT COUNT(*) AS total FROM admin_audit WHERE action='membership_approve'");
      assert.ok(Number(audit.total)>=4);
    } finally { await membershipDb.end(); }

    assert.equal((await a('/verification')).enabled,false);
    await a('/verification/attempts','POST',{consent:true},503);

    await a('/admin/logs','GET',undefined,403);
    await a('/admin/reports','GET',undefined,403);
    const logPage=await admin('/admin/logs');
    assert.ok(logPage.logs.length>0);
    assert.ok(logPage.logs.every(row=>row.actor_name && row.target_name && !Object.hasOwn(row,'password')));
    assert.ok(logPage.logs.every((row,index)=>index===0 || row.id<logPage.logs[index-1].id));
    await admin('/admin/logs?before=invalid','GET',undefined,400);
    const olderLogs=await admin('/admin/logs?before='+logPage.logs[0].id);
    assert.ok(olderLogs.logs.every(row=>row.id<logPage.logs[0].id));
    assert.ok(Array.isArray(await admin('/admin/reports')));

    // Password resets revoke sessions and require a new password before any community API.
    const resetPath='/admin/users/'+userB.id+'/password';
    await a(resetPath,'POST',{temporary_password:'Temporary-pass-123',current_password:'a-long-password-123'},403);
    await admin(resetPath,'POST',{temporary_password:'short',current_password:'a-long-password-123'},400);
    await admin(resetPath,'POST',{temporary_password:'Temporary-pass-123',current_password:'incorrect-password'},403);
    await admin(resetPath,'POST',{temporary_password:'Temporary-pass-123',current_password:'a-long-password-123'},403,false);
    await admin(resetPath,'POST',{temporary_password:'Temporary-pass-123',current_password:'a-long-password-123'});
    await b('/posts','GET',undefined,401);
    const recovered=client();await recovered('/session');
    await recovered('/login','POST',{email:'b@example.com',password:'a-long-password-123'},401);
    await recovered('/login','POST',{email:'b@example.com',password:'Temporary-pass-123'});
    assert.equal((await recovered('/session')).user.must_change_password,true);
    await recovered('/posts','GET',undefined,403);
    await recovered('/admin','GET',undefined,403);
    await recovered('/verification','GET',undefined,403);
    await recovered('/password/change','POST',{current_password:'wrong-password',new_password:'Final-password-123'},403);
    await recovered('/password/change','POST',{current_password:'Temporary-pass-123',new_password:'Temporary-pass-123'},400);
    await recovered('/password/change','POST',{current_password:'Temporary-pass-123',new_password:'Final-password-123'});
    assert.equal((await recovered('/session')).user.must_change_password,false);
    await recovered('/posts');
    await recovered('/logout','POST');await recovered('/session');
    await recovered('/login','POST',{email:'b@example.com',password:'Temporary-pass-123'},401);
    await recovered('/login','POST',{email:'b@example.com',password:'Final-password-123'});
    const adminId=(await admin('/session')).user.id;
    await admin('/admin/users/'+adminId+'/password','POST',{temporary_password:'Temporary-pass-123',current_password:'a-long-password-123'},400);
    await admin(resetPath,'POST',{temporary_password:'Expiry-password-123',current_password:'a-long-password-123'});
    const authDb=await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'integration-only-password',database:'momsvillage_test'});
    try {
      await authDb.execute('UPDATE password_state SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE user_id=?',[userB.id]);
      await recovered('/session');await recovered('/login','POST',{email:'b@example.com',password:'Expiry-password-123'},401);
      const [[audit]]=await authDb.execute("SELECT COUNT(*) AS total FROM admin_audit WHERE target_id=? AND action='password_reset'",[userB.id]);
      assert.equal(Number(audit.total),2);
      const [[stored]]=await authDb.execute('SELECT password FROM users WHERE id=?',[userB.id]);
      assert.ok(stored.password.startsWith('$2'));assert.notEqual(stored.password,'Expiry-password-123');
    } finally {await authDb.end();}
    const cameraPage=await fetch(base+'/verification-check.html');
    assert.equal(cameraPage.status,200);assert.ok(cameraPage.headers.get('content-security-policy').includes('wasm-unsafe-eval'));
    const homepage=await fetch(base+'/');assert.equal(homepage.headers.get('content-security-policy').includes('wasm-unsafe-eval'),false);
  } finally {
    clearTimeout(watchdog);
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await unlink(configFile);
  }
});
