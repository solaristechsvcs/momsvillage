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
  const peer = { id: 2, name: 'Mom B', city: 'Austin', bio: '<script>bad()</script>', avatar: '' };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const alerts = [{ id: 5, actor_id: 2, kind: 'comment', target_id: 10, name: peer.name, avatar: '', read_at: null, created_at: '2026-10-21T00:00:00Z' }];
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
    else if (url.startsWith('/api/posts')) result = [];
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
  } finally { nativeClose.call(w); }
});
