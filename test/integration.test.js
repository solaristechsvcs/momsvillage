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
  await writeFile(configFile, `export default ${JSON.stringify({ host: '127.0.0.1', port: 3099, sessionSecret: randomBytes(48).toString('hex'), secureCookies: false, trustProxy: false, mysql: { host: '127.0.0.1', port: 3306, user: 'root', password: 'integration-only-password', database: 'momsvillage_test' }, adminEmails: ['admin@example.com'], adminRegistrationCode: code })}`, { flag: 'wx', mode: 0o600 });
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  const base = 'http://127.0.0.1:3099';
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(base + '/health')).ok; if (ready) break; } catch {}
      await delay(250);
    }
    assert.ok(ready, output || 'Server did not start.');
    function client() {
      let cookie = '', csrf = '';
      return async (path, method = 'GET', body, status = 200, withCsrf = true) => {
        const r = await fetch(base + '/api' + path, { method, headers: { cookie, 'Content-Type': 'application/json', ...(withCsrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const setCookie = r.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
        const data = await r.json(); assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
        if (data.csrf) csrf = data.csrf; return data;
      };
    }
    const a = client(), b = client(), admin = client(), guest = client();
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
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await unlink(configFile);
  }
});
