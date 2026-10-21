const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let unread = { messages: 0, notifications: 0 };
let me = null, csrf = '', page = 'feed', group = null, records = [], generation = 0;
const labels = { feed: ['⌂', 'Village feed'], members: ['\u263a', 'Find moms'], friends: ['\u2661', 'Friends'], messages: ['\u2709', 'Messages'], notifications: ['\u2667', 'Notifications'], groups: ['♧', 'Local groups'], events: ['☷', 'Events'], marketplace: ['◇', 'Marketplace'], profile: ['○', 'My profile'], admin: ['⚙', 'Administration'] };
const avatar = (user, size = '') => user.avatar ? `<img class="avatar ${size}" src="${esc(user.avatar)}" referrerpolicy="no-referrer" alt="${esc(user.name)}">` : `<span class="avatar ${size}" aria-hidden="true">${esc(user.name?.slice(0, 1).toUpperCase() || 'M')}</span>`;
const logo = '<a class="logo" href="#feed"><span class="logo-mark">♧</span>Moms Village</a>';
const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const owned = row => row.user_id === me.id || row.owner_id === me.id || me.admin;
async function api(path, method = 'GET', data) {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json().catch(() => ({ error: 'Unable to reach the server.' }));
  if (!response.ok) throw new Error(result.error || 'Unable to complete that request.');
  return result;
}
function notice(message) { $('#notice').textContent = message; clearTimeout(notice.timer); notice.timer = setTimeout(() => { $('#notice').textContent = ''; }, 5000); }
function modal(title, html) { $('#modal-body').innerHTML = `<h2>${esc(title)}</h2>${html}`; if (!$('#modal').open) $('#modal').showModal(); }
function closeModal() { $('#modal').close(); $('#modal-body').innerHTML = ''; }
function field(name, label, options = {}) {
  const { value = '', type = 'text', max = 200, required = true } = options;
  return `<label for="f-${name}">${esc(label)}</label>${type === 'textarea' ? `<textarea id="f-${name}" name="${name}" maxlength="${max}" ${required ? 'required' : ''}>${esc(value)}</textarea>` : `<input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" max="999999.99" step="0.01"' : ''}>`}`;
}
function form(name, fields, button) { return `<form data-form="${name}">${fields}<p class="form-error" role="alert"></p><button class="form-submit" type="submit">${esc(button)}</button></form>`; }
function moderation(type, row) { return `${owned(row) ? `<button class="subtle" data-action="delete" data-type="${type}" data-id="${row.id}">Delete</button>` : ''}<button class="subtle" data-action="report" data-type="${type}" data-id="${row.id}">Report</button>`; }
function empty(title, message) { return `<div class="empty"><strong>${esc(title)}</strong>${esc(message)}</div>`; }
function landing() {
  $('#app').innerHTML = `<header>${logo}<span class="header-note">A little support. A lot of belonging.</span><button class="secondary header-login" data-action="login">Member sign in ↗</button></header><main class="landing"><div class="landing-top"><section><div class="eyebrow">Motherhood takes a village</div><h1>You don't have to<br>mom <em>alone.</em></h1><p>A place to ask the little questions, share the big moments, and find moms who just get it.</p><div class="buttons"><button data-action="register">Find your village ↗</button><button class="secondary" data-action="login">I’m already a member</button></div><p class="hint">Your everyday corner of connection.</p></section><div class="landing-art" aria-hidden="true">♧<span class="floating top">♡ &nbsp; A little encouragement goes a long way.</span><span class="floating">A new chapter. A shared experience.</span></div></div><section class="features"><div><span class="icon">☀</span><h3>Everyday connection</h3><p>Honest conversations, small wins, and advice from moms who understand.</p></div><div><span class="icon">♧</span><h3>Your local people</h3><p>Find nearby groups and turn shared experiences into real friendships.</p></div><div><span class="icon">☷</span><h3>Make a little time</h3><p>Plan park days, coffee catch-ups, and family-friendly gatherings.</p></div><div><span class="icon">◇</span><h3>Pass it forward</h3><p>Give outgrown favorites a new home in the village marketplace.</p></div></section><div class="footer-note">Moms Village · Made for connection. &nbsp; <a href="#guidelines">Community guidelines</a></div></main>`;
}
function auth(register) {
  modal(register ? 'A village starts with you.' : 'Welcome back.', form(register ? 'register' : 'login', `${register ? field('name', 'Your name', { max: 80 }) : ''}${field('email', 'Email address', { type: 'email', max: 254 })}${field('password', 'Password', { type: 'password', max: 72 })}${register ? `<p class="hint">Use at least 12 characters. Your account email is private.</p>${field('city', 'City or area (optional)', { max: 120, required: false })}<details><summary class="hint">Administrator setup</summary>${field('setup_code', 'Administrator setup code', { type: 'password', max: 200, required: false })}</details><label class="check"><input type="checkbox" name="agree" required><span>I’m 18 or older and agree to the <a href="#guidelines" data-action="guidelines">community guidelines</a>.</span></label>` : ''}`, register ? 'Join Moms Village' : 'Sign in'));
}
function guidelines() { modal('A kinder corner of the internet.', '<p>Be respectful, supportive, and honest. Moms Village is for adults aged 18 and older. Harassment, hate, scams, illegal items, and unsafe content are not welcome.</p><p>Protect your privacy and your children’s privacy. Avoid sharing home addresses, school details, and other sensitive information. Profiles and content are visible to signed-in members; local groups are open groups.</p><p>Report content that breaks these guidelines. Staff can remove content and suspend accounts. Meet marketplace contacts in public and use your own judgment. Marketplace listings are classifieds; Moms Village does not process payments or guarantee transactions.</p><p>Choose what you share. Displaying an external image loads it from its host, which may receive your IP address. Community discussions are peer support and do not replace professional advice.</p>'); }
function shell() {
  $('#app').innerHTML = `<header>${logo}<span class="header-note">Your village, wherever you are.</span><div class="account"><span class="muted">Hi, ${esc(me.name.split(' ')[0])}</span><a href="#profile" aria-label="My profile">${avatar(me)}</a><button class="subtle" data-action="logout">Sign out</button></div></header><div class="layout"><aside class="sidebar"><nav aria-label="Main navigation">${Object.entries(labels).filter(([key]) => key !== 'admin' || me.admin).map(([key, [icon, label]]) => `<a class="nav-link ${page === key || (page === 'group' && key === 'groups') ? 'active' : ''}" href="#${key}"><span class="nav-icon">${icon}</span>${label}${['messages','notifications'].includes(key) ? `<span class="badge" data-count="${key}" ${unread[key] ? '' : 'hidden'}>${unread[key] || ''}</span>` : ''}</a>`).join('')}</nav><div class="side-card"><span>❋</span><h3>A little kindness<br>goes a long way.</h3><p>Every mom’s journey looks different. There’s room for yours here.</p><a href="#guidelines">Our community guidelines ↗</a></div></aside><main id="main"><p class="loading">Gathering the village…</p></main><aside class="rail"><div class="card"><span class="pill">A NOTE FOR YOUR DAY</span><h3>You’re doing better<br>than you think.</h3><p>Some days, showing up is the big win. We’re glad you’re here.</p></div><div class="card"><h3>Make room for connection</h3><p>Find a group close to home or create a gathering of your own.</p><a href="#groups"><button class="secondary full">Explore local groups ↗</button></a></div><div class="card"><h3>Village values</h3><div class="rail-item"><span>♡</span><div><strong>Lead with kindness</strong><small>A supportive space for every chapter.</small></div></div><div class="rail-item"><span>♧</span><div><strong>Share at your own pace</strong><small>You choose what to share.</small></div></div><div class="rail-item"><span>☀</span><div><strong>Help each other grow</strong><small>Small gestures make a difference.</small></div></div></div><div class="footer-note">Moms Village © ${new Date().getFullYear()}<br><a href="#guidelines">Community guidelines</a></div></aside></div>`;
}
const heading = (title, subtitle, action, button) => `<div class="page-heading"><div><h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p></div>${action ? `<button data-action="${action}">${esc(button)}</button>` : ''}</div>`;
function postCard(p) {
  return `<article class="card"><div class="post-head"><button class="profile-link" data-action="member" data-id="${p.user_id}">${avatar(p)}</button><div><button class="profile-link" data-action="member" data-id="${p.user_id}"><strong>${esc(p.name)} ${memberBadges(p)}</strong></button><small>${esc(date(p.created_at))}${p.group_name ? ` · ${esc(p.group_name)}` : ' · Village conversation'}</small></div></div><p class="post-body">${esc(p.body)}</p>${p.image ? `<img class="post-image" loading="lazy" src="${esc(p.image)}" referrerpolicy="no-referrer" alt="Photo shared by ${esc(p.name)}">` : ''}<div class="post-actions"><button class="${p.liked ? 'active' : ''}" data-action="like" data-id="${p.id}" data-active="${!p.liked}">♡ ${p.like_count} ${p.like_count === 1 ? 'like' : 'likes'}</button><button data-action="comments" data-id="${p.id}">☏ ${p.comment_count} comments</button><span class="spacer"></span>${moderation('post', p)}</div></article>`;
}
function composer() { return `<div class="card composer">${avatar(me)}<button data-action="post">What’s on your mind, ${esc(me.name.split(' ')[0])}?</button></div>`; }
async function load() {
  const current = ++generation;
  const route = location.hash.slice(1) || 'feed';
  if (route === 'guidelines') { history.replaceState(null, '', '#feed'); await load(); guidelines(); return; }
  page = route.startsWith('messages/') ? 'messages' : route.startsWith('group/') ? 'group' : labels[route.split('?')[0]] ? route.split('?')[0] : 'feed';
  if (!me) { landing(); return; }
  shell();
  try {
    let html = '';
    if (['members', 'friends', 'messages', 'notifications'].includes(page)) {
      html = await socialPage(route);
    } else if (page === 'feed' || page === 'group') {
      if (page === 'group') {
        const groups = await api('/groups'); group = groups.find(g => g.id === Number(route.split('/')[1]));
        if (!group) throw new Error('Group not found.');
      } else group = null;
      records = await api(`/posts${route.startsWith('post/') ? `?post=${encodeURIComponent(route.split('/')[1])}` : group ? `?group=${group.id}` : ''}`);
      html = group ? heading(group.name, `${group.city} · ${group.members} members · Open group`) + `<p>${esc(group.description)}</p>${group.joined ? composer() : `<div class="card"><p>Join this group to take part in the conversation.</p><button data-action="join" data-id="${group.id}" data-active="true">Join group</button></div>`}` : heading('Your village feed', 'A little connection for your everyday.') + '<section class="hero"><div class="eyebrow">You belong here</div><h2>Motherhood is better<br>with a village.</h2><p>Share the messy middle, celebrate the little things, and find your people.</p><span class="hero-art" aria-hidden="true">♧</span></section>' + composer();
      html += '<div class="section-bar"><h2>The latest conversations</h2><span class="muted">Newest first</span></div>' + (records.map(postCard).join('') || empty('Be the first to say hello.', 'Start a conversation. Your village is listening.'));
    } else if (page === 'groups') {
      records = await api('/groups'); html = heading('Find your local people', 'Shared experiences. New friendships. A village close to home.', 'new-group', '+ Create group') + '<input class="search" id="search" type="search" aria-label="Search groups by name or city" placeholder="Search groups or your city…"><div id="cards" class="grid">' + groupCards(records) + '</div>';
    } else if (page === 'events') {
      records = await api('/events'); html = heading('Good things, together', 'Make time for connection, one get-together at a time.', 'new-event', '+ Plan event') + '<div class="grid">' + (records.map(e => `<article class="card"><span class="pill">${esc(date(e.starts_at))}</span><h3>${esc(e.title)}</h3><p class="muted">⌖ ${esc(e.location)}<br>Hosted by ${esc(e.name)} ${memberBadges(e)} · ${e.attendees} going</p><p>${esc(e.description)}</p><div class="buttons"><button class="${e.going ? 'secondary' : ''}" data-action="rsvp" data-id="${e.id}" data-active="${!e.going}">${e.going ? '✓ Going · Cancel' : 'Count me in'}</button>${moderation('event', e)}</div></article>`).join('') || empty('Make the first plan.', 'Coffee, a park day, or a walk — it starts with an invitation.')) + '</div>';
    } else if (page === 'marketplace') {
      records = await api('/listings'); html = heading('A new home for old favorites', 'Buy, sell, and pass a little goodness forward.', 'new-listing', '+ List an item') + '<p class="hint">Community classifieds · Prices in USD · Arrange exchanges directly with sellers.</p><input class="search" id="search" type="search" aria-label="Search listings" placeholder="Search items or your city…"><div class="grid" id="cards">' + listingCards(records) + '</div>';
    } else if (page === 'profile') {
      html = heading('Your little corner', 'Let your village get to know you.') + `<div class="card"><div class="profile-cover"></div>${avatar(me)}${memberBadges(me)}${form('profile', field('name', 'Display name', { value: me.name, max: 80 }) + field('city', 'City or area', { value: me.city, max: 120, required: false }) + field('bio', 'About you', { type: 'textarea', value: me.bio, max: 2000, required: false }) + imageField('avatar', 'Profile picture', me.avatar) + '<p class="hint">These details are visible to signed-in members. Your email stays private.</p><button type="button" class="secondary" data-action="image-library">My image library</button>', 'Save profile')}</div>`;
    } else if (page === 'admin' && me.admin) {
      const adminQuery = new URLSearchParams(route.split('?')[1]).get('q') ?? '';
      const data = await api(`/admin?q=${encodeURIComponent(adminQuery)}`); records = data.reports;
      html = heading('Care for the village', 'Review reports and manage community accounts.') + `<section class="card"><h2>Open reports</h2>${data.reports.map(r => `<div class="admin-row"><strong>${esc(r.target_type)} #${r.target_id}</strong><p>${esc(r.reason)}</p><small>Reported by ${esc(r.name)} · ${esc(date(r.created_at))}</small><div class="buttons"><button class="secondary" data-action="review" data-id="${r.id}">View content</button><button class="danger" data-action="delete" data-type="${esc(r.target_type)}" data-id="${r.target_id}">Remove content</button><button class="secondary" data-action="resolve" data-id="${r.id}">Resolve</button></div></div>`).join('') || '<p class="muted">No open reports.</p>'}</section><section class="card"><h2>Members</h2>${form('admin-search', field('q', 'Find a member by name or email', { value: adminQuery, max: 100, required: false }), 'Search members')}<p class="hint">Showing up to 200 matching accounts.</p>${data.users.map(adminMemberRow).join('')}</section>`;
    } else html = empty('This page is unavailable.', 'Choose a page from the navigation.');
    if (current === generation) {
      $('#main').innerHTML = html;
      if (page === 'messages') await refreshUnread();
    }
  } catch (error) { if (current === generation) $('#main').innerHTML = empty('We couldn’t load this page.', error.message); }
}
function groupCards(groups) { return groups.map(g => `<article class="card"><div class="tile-art">♧</div><span class="pill">${esc(g.city)}</span><h3><a href="#group/${g.id}">${esc(g.name)}</a></h3><p class="muted">${g.members} members · Open group</p><p>${esc(g.description)}</p><div class="buttons"><a href="#group/${g.id}"><button class="secondary">Visit group ↗</button></a><button data-action="join" data-id="${g.id}" data-active="${!g.joined}">${g.joined ? 'Joined · Leave' : 'Join group'}</button>${moderation('group', g)}</div></article>`).join('') || empty('Your people are out there.', 'Create a group for your area or try another search.'); }
function listingCards(items) { return items.map(l => `<article class="card">${l.image ? `<img class="post-image" src="${esc(l.image)}" referrerpolicy="no-referrer" loading="lazy" alt="${esc(l.title)}">` : '<div class="tile-art peach">◇</div>'}<span class="pill">${l.sold ? 'SOLD' : esc(l.city)}</span><h3>${esc(l.title)}</h3><div class="price">${Number(l.price) === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(l.price)}</div><p>${esc(l.description)}</p><p class="muted">Listed by ${esc(l.name)} ${memberBadges(l)}</p><div class="buttons">${!l.sold ? `<button data-action="contact" data-id="${l.id}">Contact seller</button>` : ''}${owned(l) ? `<button class="secondary" data-action="sold" data-id="${l.id}" data-active="${!l.sold}">${l.sold ? 'Relist' : 'Mark sold'}</button>` : ''}${moderation('listing', l)}</div></article>`).join('') || empty('Little things, new beginnings.', 'List your first item or try another search.'); }
async function comments(postId) {
  const list = await api(`/posts/${postId}/comments`);
  modal('Keep the conversation going', `<div>${list.map(c => `<article class="comment"><strong>${esc(c.name)} ${memberBadges(c)}</strong><p>${esc(c.body)}</p>${moderation('comment', c)}</article>`).join('') || '<p class="muted">Be the first to add a little support.</p>'}</div>${form('comment', `<input type="hidden" name="post_id" value="${postId}">${field('body', 'Your comment', { type: 'textarea', max: 2000 })}`, 'Add comment')}`);
}
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  if (page === 'members') return;
  const term = event.target.value.toLowerCase(); const filtered = records.filter(r => `${r.name ?? r.title} ${r.city} ${r.description}`.toLowerCase().includes(term));
  $('#cards').innerHTML = page === 'groups' ? groupCards(filtered) : listingCards(filtered);
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  event.preventDefault(); const { action, id, type, active } = button.dataset;
  if (socialActions.has(action)) { await handleSocialClick(button); return; }
  try {
    if (action === 'close') closeModal();
    else if (action === 'login' || action === 'register') auth(action === 'register');
    else if (action === 'guidelines') guidelines();
    else if (action === 'logout') { await api('/logout', 'POST'); me = null; await initialize(); }
    else if (action === 'post') modal('A thought for your village', form('post', field('body', 'What’s on your mind?', { type: 'textarea', max: 5000 }) + imageField('image', 'Photo'), 'Share with the village'));
    else if (action === 'new-group') modal('Bring your people together', form('group', field('name', 'Group name', { max: 100 }) + field('city', 'City or area', { value: me.city, max: 120 }) + field('description', 'What is your group about?', { type: 'textarea', max: 3000 }) + '<p class="hint">Open groups and discussions are visible to all signed-in members.</p>', 'Create group'));
    else if (action === 'new-event') modal('Make a little plan', form('event', field('title', 'Event name', { max: 140 }) + field('location', 'Public meeting place / area', { max: 200 }) + field('starts_at', 'Date and time (your local time)', { type: 'datetime-local' }) + field('description', 'The details', { type: 'textarea', max: 3000 }), 'Create event'));
    else if (action === 'new-listing') modal('Pass something lovely forward', form('listing', field('title', 'Item name', { max: 140 }) + field('price', 'Price in USD (0 for free)', { type: 'number' }) + field('city', 'City or area', { value: me.city, max: 120 }) + field('description', 'Description and condition', { type: 'textarea', max: 3000 }) + imageField('image', 'Item photo') + field('contact', 'How should buyers contact you?', { max: 250 }) + '<p class="hint">Contact instructions are shared with signed-in members. Choose a contact method you are comfortable sharing.</p>', 'Publish listing'));
    else if (action === 'comments') await comments(id);
    else if (action === 'admin-profile') await adminProfileModal(id);
    else if (action === 'developer-badge') {
      modal(active === 'true' ? 'Assign Developer badge?' : 'Remove Developer badge?', form('developer-badge', `<p>This badge identifies a Developer. It does not grant administrator permissions.</p><input type="hidden" name="id" value="${id}"><input type="hidden" name="active" value="${active}">`, active === 'true' ? 'Assign Developer badge' : 'Remove Developer badge'));
    }
    else if (action === 'admin-role') {
      modal(active === 'true' ? 'Grant administrator access?' : 'Revoke administrator access?', form('admin-role', `<p>${active === 'true' ? 'This member will have full administrator access, including moderation and assigning other administrators.' : 'This member will lose administrator access immediately. The last active administrator cannot be removed.'}</p><input type="hidden" name="id" value="${id}"><input type="hidden" name="active" value="${active}">`, active === 'true' ? 'Grant admin access' : 'Revoke admin access'));
    }
    else if (action === 'member') await memberModal(id);
    else if (action === 'contact') { const l = records.find(r => r.id === Number(id)); modal(`Contact ${l.name}`, `<p>${esc(l.title)}</p><p class="member-info">${esc(l.contact)}</p><p class="hint">Meet in a public place. Never share sensitive payment or personal information.</p>`); }
    else if (action === 'report') modal('Help care for the village', form('report', `<input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="id" value="${id}">${field('reason', 'What should the team know?', { type: 'textarea', max: 2000 })}`, 'Send report'));
    else if (action === 'delete') modal('Delete this content?', `<p>This removes the ${esc(type)} and any attached conversations permanently.</p>${form('delete', `<input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="id" value="${id}">`, 'Delete content')}`);
    else if (action === 'review') {
      const content = await api('/admin/reports/' + id + '/content');
      modal('Reported content', `<p class="member-info">${esc(content.body ?? content.description ?? '')}</p><p>${esc(content.name ?? content.title ?? '')}</p>${content.image ? `<img class="post-image" src="${esc(content.image)}" referrerpolicy="no-referrer" alt="Reported image">` : ''}`);
    }
    else {
      button.disabled = true;
      if (action === 'like') await api(`/posts/${id}/like`, 'POST', { active: active === 'true' });
      if (action === 'join') await api(`/groups/${id}/join`, 'POST', { active: active === 'true' });
      if (action === 'rsvp') await api(`/events/${id}/rsvp`, 'POST', { active: active === 'true' });
      if (action === 'sold') await api(`/listings/${id}`, 'PATCH', { sold: active === 'true' });
      if (action === 'resolve') await api(`/admin/reports/${id}`, 'PATCH', {});
      if (action === 'ban') { modal(active === 'true' ? 'Suspend this account?' : 'Restore this account?', form('ban', `<p>${active === 'true' ? 'This member will lose access and their content will be hidden.' : 'This member will regain access and their content will be visible again.'}</p><input type="hidden" name="id" value="${id}"><input type="hidden" name="active" value="${active}">`, active === 'true' ? 'Suspend account' : 'Restore account')); return; }
      await load();
    }
  } catch (error) { notice(error.message); } finally { button.disabled = false; }
});
document.addEventListener('submit', async event => {
  const f = event.target.closest('form[data-form]'); if (!f) return; event.preventDefault();
  if (f.dataset.form === 'admin-search') {
    const hash = `admin?q=${encodeURIComponent(new FormData(f).get('q') ?? '')}`;
    if (location.hash.slice(1) === hash) await load(); else location.hash = hash;
    return;
  }
  if (['member-search','message'].includes(f.dataset.form)) { await socialSubmit(f); return; }
  if (f.dataset.uploading) { notice('Wait for your photo upload to finish.'); return; }
  const data = Object.fromEntries(new FormData(f));
  delete data.photo_file; const submit = f.querySelector('[type=submit]'); submit.disabled = true; f.querySelector('.form-error').textContent = '';
  try {
    const name = f.dataset.form;
    if (name === 'register') { data.agree = data.agree === 'on'; await api('/register', 'POST', data); }
    if (name === 'login') await api('/login', 'POST', data);
    if (name === 'profile') { await api('/profile', 'PATCH', data); notice('Your profile is updated.'); }
    if (name === 'post') await api('/posts', 'POST', { ...data, group_id: page === 'group' ? group.id : null });
    if (name === 'group') await api('/groups', 'POST', data);
    if (name === 'event') await api('/events', 'POST', { ...data, starts_at: new Date(data.starts_at).toISOString() });
    if (name === 'listing') await api('/listings', 'POST', data);
    if (name === 'report') { await api('/reports', 'POST', data); notice('Report sent to the community team.'); }
    if (name === 'delete') await api(`/content/${data.type}/${data.id}`, 'DELETE');
    if (name === 'developer-badge') {
      await api(`/admin/users/${data.id}/developer-badge`, 'PATCH', { enabled: data.active === 'true' });
      notice(data.active === 'true' ? 'Developer badge assigned.' : 'Developer badge removed.');
    }
    if (name === 'admin-role') {
      await api(`/admin/users/${data.id}/role`, 'PATCH', { is_admin: data.active === 'true' });
      notice(data.active === 'true' ? 'Administrator access granted.' : 'Administrator access revoked.');
      if (Number(data.id) === me.id && data.active !== 'true') history.replaceState(null, '', '#feed');
    }
    if (name === 'ban') await api(`/admin/users/${data.id}`, 'PATCH', { banned: data.active === 'true' });
    if (name === 'comment') { await api(`/posts/${data.post_id}/comments`, 'POST', data); await comments(data.post_id); return; }
    closeModal(); await initialize();
  } catch (error) { f.querySelector('.form-error').textContent = error.message; } finally { submit.disabled = false; }
});
async function initialize() {
  try { const state = await api('/session'); me = state.user; csrf = state.csrf;
    if (me) unread = await api('/unread');
    await load(); }
  catch (error) { $('#app').innerHTML = `<main class="landing">${empty('The village is taking a moment.', error.message)}</main>`; }
}
window.addEventListener('hashchange', () => { closeModal(); load(); });
initialize();

function adminMemberRow(user) {
  const admin = !!user.is_admin;
  return `<div class="admin-row"><div class="post-head">${avatar(user)}<div><button class="profile-link" data-action="admin-profile" data-id="${user.id}"><strong>${esc(user.name)} ${memberBadges(user)}${user.id === me.id ? ' (you)' : ''}</strong></button><span class="pill">${admin ? 'Administrator' : 'Member'}${user.banned ? ' / Suspended' : ''}</span></div></div><small>${esc(user.email)} / ${esc(user.city)}</small><div class="buttons"><button class="secondary" data-action="admin-profile" data-id="${user.id}">View profile</button><button class="${admin ? 'secondary' : ''}" data-action="admin-role" data-id="${user.id}" data-active="${!admin}" ${user.banned && !admin ? 'disabled title="Restore the account before granting access"' : ''}>${admin ? 'Revoke admin' : 'Grant admin'}</button><button class="secondary" data-action="developer-badge" data-id="${user.id}" data-active="${!user.developer_badge}" ${user.banned && !user.developer_badge ? 'disabled title="Restore the account before assigning a badge"' : ''}>${user.developer_badge ? 'Remove Developer badge' : 'Assign Developer badge'}</button>${!admin || user.banned ? `<button class="${user.banned ? 'secondary' : 'danger'}" data-action="ban" data-id="${user.id}" data-active="${!user.banned}">${user.banned ? 'Restore account' : 'Suspend account'}</button>` : ''}</div></div>`;
}
async function adminProfileModal(memberId) {
  const user = await api(`/admin/users/${memberId}/profile`);
  modal(user.name, `<div class="profile-cover"></div>${avatar(user)}${memberBadges(user)}<p><span class="pill">${user.is_admin ? 'Administrator' : 'Member'}${user.banned ? ' / Suspended' : ''}</span></p><p class="muted">${esc(user.email)}<br>${esc(user.city || 'No city shared')}</p><p class="member-info">${esc(user.bio || 'No biography shared yet.')}</p><small>Joined ${esc(new Date(user.created_at).toLocaleDateString())}</small>`);
}

function memberBadges(user) {
  const flag = value => value === true || value === 1;
  return `<span class="member-badges">${flag(user.staff_badge) ? '<span class="member-badge staff" title="Administrator" aria-label="Staff administrator">Staff</span>' : ''}${flag(user.developer_badge) ? '<span class="member-badge developer" title="Assigned by an administrator">Developer</span>' : ''}</span>`;
}
