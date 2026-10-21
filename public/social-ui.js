const socialActions = new Set(['friend-send', 'friend-accept', 'friend-remove', 'block', 'confirm-block', 'unblock', 'notification', 'read-notifications', 'refresh-thread', 'image-library', 'remove-image']);
let socialRecords = [], socialThread = null;
function imageField(name, label, value = '') {
  return `${field(name, `${label} URL (optional)`, { value, max: 1000, required: false })}<label for="file-${name}">Or upload ${esc(label.toLowerCase())}</label><input id="file-${name}" type="file" name="photo_file" accept="image/jpeg,image/png,image/webp" data-upload-field="${name}"><p class="hint" data-upload-status>JPEG, PNG or WebP, up to 8 MB. Images are resized and location metadata is removed.</p>`;
}
function connectionButtons(user, friendship, contactAllowed = true, ownBlock = false) {
  if (ownBlock) return `<button class="secondary" data-action="unblock" data-id="${user.id}">Unblock member</button>`;
  if (!contactAllowed) return '<p class="hint">Contact is unavailable for this member.</p>';
  let html;
  if (friendship?.status === 'accepted') html = `<a class="button-link" href="#messages/${user.id}">Message</a><button class="secondary" data-action="friend-remove" data-id="${user.id}">Remove friend</button>`;
  else if (friendship?.status === 'pending') html = friendship.requester_id === me.id ? `<button class="secondary" data-action="friend-remove" data-id="${user.id}">Cancel request</button>` : `<button data-action="friend-accept" data-id="${user.id}">Accept request</button><button class="secondary" data-action="friend-remove" data-id="${user.id}">Decline</button>`;
  else html = `<button data-action="friend-send" data-id="${user.id}">Add friend</button>`;
  return html + `<button class="subtle" data-action="block" data-id="${user.id}">Block</button>`;
}
function memberCard(user, friendship) {
  return `<article class="card member-card"><button class="profile-link" data-action="member" data-id="${user.id}">${avatar(user)}<h3>${esc(user.name)}</h3></button><p class="muted">${esc(user.city || 'Part of the village')}</p><p>${esc((user.bio ?? '').slice(0, 200))}</p><div class="buttons">${connectionButtons(user, friendship)}</div></article>`;
}
async function memberModal(memberId) {
  const user = await api(`/members/${memberId}`);
  const relationship = user.id !== me.id ? await api(`/relationships/${memberId}`) : null;
  modal(user.name, `<div class="profile-cover"></div>${avatar(user)}<p class="muted">${esc(user.city || 'Part of the village')}</p><p class="member-info">${esc(user.bio || 'Still writing her story.')}</p><small>Joined ${esc(new Date(user.created_at).toLocaleDateString())}</small>${relationship ? `<div class="buttons member-controls">${connectionButtons(user, relationship.friendship, relationship.contact_allowed, relationship.blocked)}</div>` : '<p><a href="#profile">Edit my profile</a></p>'}`);
}
async function socialPage(route) {
  if (page === 'members') {
    const term = new URLSearchParams(route.split('?')[1]).get('q') ?? '';
    socialRecords = await api(`/members?q=${encodeURIComponent(term)}`);
    return heading('Find your people', 'Connect with moms by name or city.') + form('member-search', field('q', 'Search by name or city', { value: term, max: 100, required: false }), 'Find moms') + '<p class="hint">Showing up to 100 members. Share only what you feel comfortable sharing.</p><div class="grid">' + (socialRecords.map(u => memberCard(u, u.friendship_status ? { status: u.friendship_status, requester_id: u.requester_id } : null)).join('') || empty('No matches yet.', 'Try a different name or city.')) + '</div>';
  }
  if (page === 'friends') {
    const data = await api('/friends');
    const sections = [ ['Friend requests', data.friends.filter(f => f.status === 'pending' && f.requester_id !== me.id)], ['Your friends', data.friends.filter(f => f.status === 'accepted')], ['Sent requests', data.friends.filter(f => f.status === 'pending' && f.requester_id === me.id)] ];
    return heading('Your circle of support', 'A friendship can start with a simple hello.') + sections.map(([title, members]) => `<section class="social-section"><h2>${title}</h2><div class="grid">${members.map(u => memberCard(u, u)).join('') || '<p class="muted">Nothing here yet.</p>'}</div></section>`).join('') + `<section class="card"><h2>Blocked members</h2><p class="hint">Blocking stops friend requests, direct messages, and notifications between you. Shared community content remains visible. Unblocking does not restore a friendship.</p>${data.blocks.map(u => `<div class="admin-row"><strong>${esc(u.name)}</strong> <button class="secondary" data-action="unblock" data-id="${u.id}">Unblock</button></div>`).join('') || '<p class="muted">You haven’t blocked anyone.</p>'}</section>`;
  }
  if (page === 'messages') {
    const peerId = route.split('?')[0].split('/')[1];
    if (!peerId) {
      socialRecords = await api('/messages');
      return heading('A little conversation', 'Private messages between you and your friends.') + '<p class="hint">Start a conversation from a friend’s profile or your Friends page.</p>' + (socialRecords.map(t => `<a class="card thread-link" href="#messages/${t.peer_id}">${avatar(t)}<div><strong>${esc(t.name)} ${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</strong><p>${esc(t.body.slice(0, 130))}</p><small>${esc(date(t.created_at))}</small></div></a>`).join('') || empty('Your inbox is ready.', 'Add a friend to start your first conversation.'));
    }
    const before = new URLSearchParams(route.split('?')[1]).get('before');
    socialThread = await api(`/messages/${encodeURIComponent(peerId)}${before ? `?before=${encodeURIComponent(before)}` : ''}`);
    const t = socialThread;
    return heading(t.peer.name, 'Only you and this member can read this conversation.', 'refresh-thread', 'Refresh') + '<p class="hint"><a href="#messages">Back to inbox</a> · Staff can inspect individual messages if reported.</p>' + `<div class="conversation card">${t.has_more ? `<a class="older-messages" href="#messages/${t.peer.id}?before=${t.messages[0].id}">View older messages</a>` : ''}${before ? `<a href="#messages/${t.peer.id}">Back to latest messages</a>` : ''}${t.messages.map(m => `<article class="message ${m.sender_id === me.id ? 'mine' : ''}"><strong>${m.sender_id === me.id ? 'You' : esc(t.peer.name)}</strong><p>${esc(m.body)}</p><small>${esc(date(m.created_at))}</small><button class="subtle" data-action="report" data-type="message" data-id="${m.id}">Report</button></article>`).join('') || '<p class="muted">Say hello to start your conversation.</p>'}</div>${t.can_send ? form('message', `<input type="hidden" name="recipient_id" value="${t.peer.id}">${field('body', 'Your message', { type: 'textarea', max: 4000 })}`, 'Send message') : '<p class="hint">Messaging is unavailable. You must be accepted friends and neither member can be blocked.</p>'}<div class="buttons member-controls"><button class="subtle" data-action="block" data-id="${t.peer.id}">Block member</button></div>`;
  }
  socialRecords = await api('/notifications');
  const phrases = { friend_request: 'sent you a friend request', friend_accept: 'accepted your friend request', message: 'sent you a message', comment: 'commented on your post', like: 'liked your post' };
  return heading('A little village news', 'Requests, conversations, and moments of connection.', socialRecords.length ? 'read-notifications' : null, 'Mark all read') + (socialRecords.map(n => `<button class="card notification ${n.read_at ? '' : 'unread'}" data-action="notification" data-id="${n.id}">${avatar(n)}<span><strong>${esc(n.name)}</strong> ${esc(phrases[n.kind] ?? 'shared an update')}<small>${esc(date(n.created_at))}</small></span>${!n.read_at ? '<span class="unread-dot" aria-label="Unread"></span>' : ''}</button>`).join('') || empty('You’re all caught up.', 'New connections and conversations will appear here.'));
}
async function handleSocialClick(button) {
  const { action, id } = button.dataset;
  button.disabled = true;
  try {
    if (action === 'image-library') {
      const files = await api('/uploads');
      modal('Your image library', '<p class="hint">Remove images you no longer use. Images attached to a profile, post, or listing cannot be deleted.</p><div class="grid image-library">' + (files.map(f => `<article><img class="post-image" src="/api/media/${f.filename}" alt="Your uploaded image"><p class="hint">${Math.ceil(f.bytes / 1024)} KB</p><button class="secondary" data-action="remove-image" data-id="${f.filename}">Delete unused image</button></article>`).join('') || '<p>No images yet.</p>') + '</div>'); return;
    }
    if (action === 'remove-image') { await api(`/uploads/${id}`, 'DELETE'); button.closest('article').remove(); notice('Unused image removed.'); return; }
    if (action === 'block') { modal('Block this member?', `<p>This removes your friendship and prevents requests, messages, and notifications between you. Shared community posts remain visible.</p><button data-action="confirm-block" data-id="${id}">Block member</button>`); return; }
    if (action === 'friend-send') { await api(`/friends/${id}`, 'POST', {}); notice('Friend request sent.'); }
    if (action === 'friend-accept') { await api(`/friends/${id}`, 'PATCH', {}); notice('You’re now friends.'); }
    if (action === 'friend-remove') await api(`/friends/${id}`, 'DELETE');
    if (action === 'confirm-block') { await api(`/blocks/${id}`, 'POST', {}); notice('Member blocked.'); }
    if (action === 'unblock') await api(`/blocks/${id}`, 'DELETE');
    if (action === 'read-notifications') await api('/notifications/read', 'POST', { through_id: Math.max(...socialRecords.map(n => n.id)) });
    if (action === 'notification') {
      const n = socialRecords.find(item => item.id === Number(id));
      await api(`/notifications/${id}`, 'PATCH', {});
      if (n.kind === 'message') location.hash = `messages/${n.actor_id}`;
      else if (n.kind === 'friend_request' || n.kind === 'friend_accept') location.hash = 'friends';
      else location.hash = `post/${n.target_id}`;
      await refreshUnread(); return;
    }
    closeModal(); await refreshUnread(); await load();
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
}
async function socialSubmit(f) {
  const data = Object.fromEntries(new FormData(f)); const submit = f.querySelector('[type=submit]');
  submit.disabled = true; f.querySelector('.form-error').textContent = '';
  try {
    if (f.dataset.form === 'member-search') {
      const hash = `members?q=${encodeURIComponent(data.q)}`;
      if (location.hash.slice(1) === hash) await load(); else location.hash = hash;
    } else {
      await api(`/messages/${data.recipient_id}`, 'POST', { body: data.body });
      if (location.hash.includes('?')) location.hash = `messages/${data.recipient_id}`; else await load();
      await refreshUnread();
    }
  } catch (error) { f.querySelector('.form-error').textContent = error.message; }
  finally { submit.disabled = false; }
}
document.addEventListener('change', async event => {
  const input = event.target.closest('[data-upload-field]'); if (!input || !input.files[0]) return;
  const file = input.files[0], f = input.closest('form'), status = f.querySelector('[data-upload-status]');
  const submit = f.querySelector('[type=submit]'); const context = csrf;
  if (file.size > 8 * 1024 * 1024) { notice('Choose an image under 8 MB.'); input.value = ''; return; }
  f.dataset.uploading = 'true'; submit.disabled = true; input.disabled = true; status.textContent = 'Uploading your photo…';
  try {
    const body = new FormData(); body.append('image', file);
    const response = await fetch('/api/uploads', { method: 'POST', headers: { 'x-csrf-token': context }, body });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Upload failed.');
    f.elements[input.dataset.uploadField].value = result.url;
    status.textContent = 'Photo uploaded. Save or publish to use it.';
  } catch (error) { status.textContent = error.message; }
  finally { delete f.dataset.uploading; submit.disabled = false; input.disabled = false; input.value = ''; }
});
async function refreshUnread() {
  if (!me || document.hidden) return;
  try {
    unread = await api('/unread');
    for (const [key, count] of Object.entries(unread)) {
      const badge = document.querySelector(`[data-count="${key}"]`);
      if (badge) { badge.textContent = count ? String(count) : ''; badge.hidden = !count; }
    }
  } catch { /* Preserve the current draft if connectivity drops. */ }
}
setInterval(refreshUnread, 30000);
