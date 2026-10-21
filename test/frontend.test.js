import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

test('social navigation, requests, conversations, notifications and photo forms', { skip: process.env.MV_UI !== '1', timeout: 10000 }, async () => {
  const { JSDOM } = await import('jsdom');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.com/#members?q=Austin', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, calls = [];
  const nativeClose = w.close;
  const self = { id: 1, name: 'Mom A', city: 'Austin', bio: '', avatar: '', admin: false };
  const peer = { id: 2, name: 'Mom B', city: 'Austin', bio: '<script>bad()</script>', avatar: '', staff_badge: true, developer_badge: true, founding_member_badge: true, tester_badge: true };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const alerts = [{ id: 5, actor_id: 2, kind: 'comment', target_id: 10, name: peer.name, avatar: '', read_at: null, created_at: '2026-10-21T00:00:00Z' }];
  const commentRows = [
    { id: 1, post_id: 10, user_id: 2, name: 'Mom B', body: 'An older hidden comment', created_at: '2026-10-21T00:00:00Z' },
    { id: 2, post_id: 10, user_id: 2, name: 'Mom B', body: '<script>Latest comment</script>', created_at: '2026-10-21T00:01:00Z', tester_badge: true }
  ];
  const feedPost = { id: 10, user_id: 1, name: 'Mom A', body: 'A village discussion', like_count: 0, comment_count: 2, latest_comment: commentRows[1], created_at: '2026-10-21T00:00:00Z' };
  w.fetch = async (url, opts = {}) => {
    calls.push([url, opts.method ?? 'GET', opts.body]);
    let result = { ok: true };
    if (url === '/api/session') result = { csrf: 'test-csrf', user: self };
    else if (url === '/api/unread') result = { messages: 1, notifications: 1 };
    else if (url.startsWith('/api/members?')) result = [peer];
    else if (url === '/api/members/2') result = peer;
    else if (url === '/api/relationships/2') result = { friendship: null, blocked: false, contact_allowed: true };
    else if (url === '/api/messages/2' && opts.method === 'GET') result = { peer, can_send: true, has_more: false, messages: [{ id: 3, sender_id: 2, recipient_id: 1, body: '<img src=x onerror=bad()>', created_at: '2026-10-21T00:00:00Z' }] };
    else if (url === '/api/notifications') result = alerts;
    else if (url === '/api/posts/10/comments') {
      if (opts.method === 'POST') {
        commentRows.push({ id: 3, post_id: 10, user_id: 1, name: 'Mom A', body: JSON.parse(opts.body).body, created_at: '2026-10-21T00:02:00Z' });
        feedPost.latest_comment = commentRows[2]; feedPost.comment_count = 3;
      } else result = commentRows;
    }
    else if (url.startsWith('/api/posts')) result = [feedPost];
    return { ok: true, json: async () => result };
  };
  const waitFor = async check => { for (let n = 0; n < 100; n++) { if (check()) return; await delay(10); } assert.fail('UI did not reach expected state: ' + w.document.body.textContent.slice(-1000)); };
  const go = async hash => { w.location.hash = hash; await delay(20); };
  try {
    w.eval((await readFile(new URL('../public/social-ui.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')));
    assert.equal(w.close, nativeClose, 'Application helpers must preserve the browser window.close API.');
    await waitFor(() => w.document.querySelector('.member-card'));
    assert.ok(calls.some(c => c[0] === '/api/members?q=Austin'));
    assert.equal(w.document.querySelector('.member-card script'), null);
    assert.equal(w.document.querySelectorAll('.member-card .member-badge.staff').length, 1);
    assert.equal(w.document.querySelectorAll('.member-card .member-badge.developer').length, 1);
    assert.equal(w.document.querySelectorAll('.member-card .member-badge.founding-member').length, 1);
    assert.equal(w.document.querySelectorAll('.member-card .member-badge.tester').length, 1);
    assert.ok(w.document.querySelector('.member-card').textContent.includes('<script>bad()</script>'));
    w.document.querySelector('[data-action="friend-send"]').click();
    await waitFor(() => calls.some(c => c[0] === '/api/friends/2' && c[1] === 'POST'));
    await go('messages/2'); await waitFor(() => w.document.querySelector('form[data-form="message"]'));
    assert.equal(w.document.querySelector('.conversation img'), null);
    const messageForm = w.document.querySelector('form[data-form="message"]');
    messageForm.elements.body.value = 'Hi there';
    messageForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => calls.some(c => c[0] === '/api/messages/2' && c[1] === 'POST'));
    assert.equal(JSON.parse(calls.find(c => c[0] === '/api/messages/2' && c[1] === 'POST')[2]).body, 'Hi there');
    await go('notifications'); await waitFor(() => w.document.querySelector('.notification'));
    w.document.querySelector('.notification').click();
    await waitFor(() => calls.some(c => c[0] === '/api/posts?post=10'));
    assert.ok(calls.some(c => c[0] === '/api/notifications/5' && c[1] === 'PATCH'));
    await go('profile'); await waitFor(() => w.document.querySelector('form[data-form="profile"]'));
    assert.ok(w.document.querySelector('input[data-upload-field="avatar"]'));
    assert.equal(w.document.querySelector('input[name="avatar"]').type, 'text');
    await go('feed'); await waitFor(() => w.document.querySelector('.latest-comment'));
    assert.equal(w.document.querySelectorAll('.latest-comment').length, 1);
    assert.ok(w.document.querySelector('.latest-comment').textContent.includes('<script>Latest comment</script>'));
    assert.equal(w.document.querySelector('.latest-comment script'), null);
    assert.ok(w.document.querySelector('.latest-comment .member-badge.tester'));
    assert.equal(w.document.querySelector('#main').textContent.includes('An older hidden comment'), false);
    w.document.querySelector('[data-action="comments"][data-id="10"]').click();
    await waitFor(() => w.document.querySelector('#modal-body .comment'));
    assert.ok(w.document.querySelector('#modal-body').textContent.includes('An older hidden comment'));
    const commentForm = w.document.querySelector('form[data-form="comment"]'); commentForm.elements.body.value = 'The new latest reply';
    commentForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => w.document.querySelector('.latest-comment')?.textContent.includes('The new latest reply'));
    assert.equal(w.document.querySelector('#main').textContent.includes('An older hidden comment'), false);

  } finally { nativeClose.call(w); }
});

test('admin member profiles and confirmed role changes', { skip: process.env.MV_UI !== '1', timeout: 10000 }, async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'https://example.com/#admin', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, nativeClose = w.close, calls = [];
  const owner = { id: 1, name: 'Owner', email: 'owner@example.com', admin: true, is_admin: true, staff_badge: true, city: '', avatar: '' };
  const users = [owner, { id: 2, name: 'New admin', email: 'new@example.com', is_admin: false, banned: false, city: '', avatar: '' }, { id: 3, name: 'Suspended mom', email: 'suspended@example.com', is_admin: false, banned: true, city: '', avatar: '', bio: '<script>unsafe()</script>' }];
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  w.fetch = async (url, opts = {}) => {
    calls.push([url, opts.method ?? 'GET', opts.body]);
    let result = { ok: true };
    if (url === '/api/session') result = { csrf: 'test-csrf', user: owner };
    else if (url === '/api/unread') result = { messages: 0, notifications: 0 };
    else if (url.startsWith('/api/admin?q=')) result = { users, reports: [] };
    else if (url.endsWith('/2/role')) { users[1].is_admin = JSON.parse(opts.body).is_admin; users[1].staff_badge = users[1].is_admin; }
    else if (url.endsWith('/2/developer-badge')) users[1].developer_badge = JSON.parse(opts.body).enabled;
    else if (url.includes('/2/badges/')) users[1][`${url.split('/').pop()}_badge`] = JSON.parse(opts.body).enabled;
    else if (url.endsWith('/3/profile')) result = users[2];
    return { ok: true, json: async () => result };
  };
  const waitFor = async check => { for (let n = 0; n < 100; n++) { if (check()) return; await delay(10); } assert.fail('Admin UI did not reach expected state.'); };
  try {
    w.eval((await readFile(new URL('../public/social-ui.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')));
    await waitFor(() => w.document.querySelector('[data-action="admin-role"][data-id="2"]'));
    assert.equal(w.document.querySelector('[data-action="admin-role"][data-id="3"]').disabled, true);
    w.document.querySelector('[data-action="admin-role"][data-id="2"]').click();
    assert.equal(calls.some(c => c[0].endsWith('/2/role')), false, 'Opening confirmation must not grant access.');
    const roleForm = w.document.querySelector('form[data-form="admin-role"]');
    assert.ok(roleForm.textContent.includes('full administrator access'));
    roleForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => w.document.querySelector('[data-action="admin-role"][data-id="2"][data-active="false"]'));
    assert.deepEqual(JSON.parse(calls.find(c => c[0].endsWith('/2/role'))[2]), { is_admin: true });
    assert.ok(w.document.querySelector('.admin-row .member-badge.staff'));
    w.document.querySelector('[data-action="developer-badge"][data-id="2"]').click();
    const badgeForm = w.document.querySelector('form[data-form="developer-badge"]');
    assert.ok(badgeForm.textContent.includes('does not grant administrator permissions'));
    assert.equal(calls.some(c => c[0].endsWith('/2/developer-badge')), false);
    badgeForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => w.document.querySelector('[data-action="developer-badge"][data-id="2"][data-active="false"]'));
    assert.ok(w.document.querySelector('.admin-row .member-badge.developer'));
    for (const [badge, label] of [['founding_member', 'Founding Member'], ['tester', 'Tester']]) {
      assert.equal(w.document.querySelector(`[data-action="assignable-badge"][data-badge="${badge}"][data-id="3"]`).disabled, true);
      w.document.querySelector(`[data-action="assignable-badge"][data-badge="${badge}"][data-id="2"]`).click();
      const form = w.document.querySelector('form[data-form="assignable-badge"]');
      assert.ok(form.textContent.includes(label));
      form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => w.document.querySelector(`[data-action="assignable-badge"][data-badge="${badge}"][data-id="2"][data-active="false"]`));
    }
    assert.ok(w.document.querySelector('.admin-row .member-badge.founding-member'));
    assert.ok(w.document.querySelector('.admin-row .member-badge.tester'));
    w.document.querySelector('[data-action="assignable-badge"][data-badge="founding_member"][data-id="2"]').click();
    w.document.querySelector('form[data-form="assignable-badge"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => w.document.querySelector('[data-action="assignable-badge"][data-badge="founding_member"][data-id="2"][data-active="true"]'));
    assert.equal(w.document.querySelector('.admin-row .member-badge.founding-member'), null);
    assert.ok(w.document.querySelector('.admin-row .member-badge.tester'));
    w.document.querySelector('[data-action="admin-profile"][data-id="3"]').click();
    await waitFor(() => w.document.querySelector('#modal-body .member-info'));
    assert.ok(w.document.querySelector('#modal-body').textContent.includes('Suspended'));
    assert.equal(w.document.querySelector('#modal-body script'), null);
    assert.ok(w.document.querySelector('#modal-body').textContent.includes('suspended@example.com'));
  } finally { nativeClose.call(w); }
});
