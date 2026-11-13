let applicationPolicy = { text: 'Moms Village is a private community for mothers aged 18 and older.', confirmation: 'I am a mother, am at least 18 years old, and meet the mothers-only membership policy.', invite_only: true };
let applicationReviews = [];
const membershipActions = new Set(['membership-refresh','review-member','membership-review','create-invitation','copy-invitation','revoke-invitation']);

function eligibilityField(checked = false) {
  return `<label class="check"><input type="checkbox" name="eligibility_confirmed" required ${checked ? 'checked' : ''}><span>${esc(applicationPolicy.confirmation)}</span></label>`;
}
function membershipRegistrationFields() {
  return `<fieldset class="application-fields"><legend>Membership application</legend><p class="hint">${esc(applicationPolicy.text)}</p>${field('application_reason','What would you like from this community?',{ type:'textarea',max:1500 })}${field('referral','How did you hear about us? (optional)',{ max:200,required:false })}${field('invitation_code','Invitation code',{ max:100,required:true })}${eligibilityField()}<p class="hint">Applications are private to you and administrators. Please do not include children’s names, photos, medical records, or other sensitive documents. Invitations do not bypass review.</p></fieldset>`;
}
async function renderMembershipGate() {
  const data = await api('/membership');
  applicationPolicy = { ...data.policy, invite_only: data.invite_only };
  if (data.status === 'approved') { await initialize(); return; }
  const a = data.application ?? {}, status = data.status;
  const title = status === 'suspended' ? 'Your membership is suspended' : status === 'declined' ? 'Your application needs attention' : a.submitted_at ? 'Your application is awaiting review' : 'Complete your membership application';
  const formHtml = status === 'suspended' ? '<p>Please contact the community administrators about your account.</p>' : form('membership-application',
    field('application_reason','What would you like from this community?',{type:'textarea',max:1500,value:a.reason ?? ''}) +
    field('referral','How did you hear about us? (optional)',{max:200,required:false,value:a.referral ?? ''}) +
    (a.has_invitation ? '<p class="hint">An invitation is attached to your application.</p>' : field('invitation_code',data.invite_only ? 'Invitation code' : 'Invitation code (optional)',{max:100,required:data.invite_only})) +
    eligibilityField(!!a.eligibility_confirmed), a.submitted_at ? 'Update and resubmit application' : 'Submit application');
  $('#app').innerHTML = `<header>${logo}<button class="secondary" data-action="logout">Sign out</button></header><main class="membership-gate"><span class="pill">${esc(status)}</span><h1>${esc(title)}</h1><p>${esc(applicationPolicy.text)}</p><p>Community posts, member profiles, groups, events, messaging, marketplace listings and photos become available after approval.</p>${a.review_message ? `<div class="card"><strong>Message from the review team</strong><p class="application-answer">${esc(a.review_message)}</p></div>` : ''}<button class="secondary" data-action="membership-refresh">Check application status</button>${status !== 'suspended' ? '<p class="hint">Do not include details identifying children, photos or documents. You can update your application while it is under review.</p>' : ''}${formHtml}${me.has_verification_data ? '<p><button class="secondary" data-action="verification-delete">Delete optional verification data</button></p>' : ''}</main>`;
}
function reviewCard(a) {
  const decisions = a.is_admin ? ['approve'] : ['approve','request_changes','decline'];
  return `<article class="card application-card"><div class="page-heading"><div><h2>${esc(a.name)}</h2><small>${esc(a.email)} · ${esc(a.city)}</small></div><span class="pill">${esc(a.banned ? 'Suspended' : a.status)}</span></div><p class="hint">${a.submitted_at ? 'Submitted ' + esc(date(a.submitted_at)) : 'Application not yet submitted'} · Revision ${a.revision}</p><p><strong>Eligibility confirmation:</strong> ${a.eligibility_confirmed ? 'Self-confirmed' : 'Not submitted'}</p><p class="application-answer">${esc(a.reason || 'No application answers yet.')}</p>${a.referral ? `<p><strong>Referral information:</strong> ${esc(a.referral)}</p>` : ''}${a.inviter_name ? `<p><strong>Invitation from:</strong> ${esc(a.inviter_name)} · …${esc(a.invitation_suffix)}</p>` : '<p class="hint">No invitation attached.</p>'}${a.review_message ? `<p><strong>Last message to applicant:</strong> ${esc(a.review_message)}</p>` : ''}<div class="buttons"><button class="secondary" data-action="admin-profile" data-id="${a.user_id}">View profile</button>${decisions.map(action => `<button class="${action === 'decline' ? 'danger' : 'secondary'}" data-action="membership-review" data-id="${a.user_id}" data-review="${action}" ${a.banned || (action === 'approve' && !a.is_admin && (!a.submitted_at || !a.eligibility_confirmed)) ? 'disabled' : ''}>${{ approve:'Approve membership',request_changes:'Request more information',decline:'Decline membership' }[action]}</button>`).join('')}</div></article>`;
}
function invitationRows(rows, admin = false) {
  return rows.map(i => {
    const expired = new Date(i.expires_at) <= new Date();
    const state = i.used_at ? 'Used' : i.revoked ? 'Revoked' : expired ? 'Expired' : 'Active';
    return `<div class="admin-row"><strong>Invitation …${esc(i.suffix)}</strong> <span class="pill">${state}</span>${admin ? `<p>Issued by ${esc(i.issuer_name)}</p>` : ''}<small>Created ${esc(date(i.created_at))} · Expires ${esc(date(i.expires_at))}</small>${i.used_by_name ? "<p>Used by "+esc(i.used_by_name)+" on "+esc(date(i.used_at))+"</p>" : ""}${state === 'Active' ? `<button class="secondary" data-action="revoke-invitation" data-id="${i.id}">Revoke invitation</button>` : ''}</div>`;
  }).join('') || '<p class="muted">No invitations yet.</p>';
}
async function membershipPage(route, view=page) {
  if (view === 'invitations') {
    const rows = await api('/invitations');
    return heading('Invite someone you trust','Invitations support an application. Every new member still needs approval.','create-invitation','Create invitation') + '<p class="hint">Each code can be used once, expires after 14 days and is displayed only when created. You may have 5 active codes and issue 20 per week. Share privately with a mother who meets the community policy. Generation and use are recorded on your account and visible to administrators.</p><section class="card">' + invitationRows(rows) + '</section>';
  }
  if (!me.admin) return empty('Administrator access required.','Choose another page from the navigation.');
  const params = new URLSearchParams(route.split('?')[1]), status = params.get('status') ?? 'pending', member = params.get('user');
  const [applications, invitations] = await Promise.all([api('/admin/membership-applications?' + (member ? 'user_id=' + encodeURIComponent(member) : 'status=' + encodeURIComponent(status))),api('/admin/invitations')]);
  applicationReviews = applications;
  return heading('Membership applications','Review eligibility statements and referrals before admitting members.') +
    '<p class="hint">Review self-declared eligibility, authenticity concerns and community fit. Do not ask for children’s photos or records, or assess gender from appearance.</p><div class="buttons">' +
    ['pending','approved','declined'].map(s => `<a class="button-link" href="#admin/applications?status=${s}">${s[0].toUpperCase()+s.slice(1)}</a>`).join('') + '</div><p class="hint">Showing up to 200 applications. From Administration, use Review membership to open a specific account.</p>' +
    (applications.map(reviewCard).join('') || empty('No applications in this view.','New submissions will appear here.')) +
    '<details class="card"><summary>Recent community invitations</summary>' + invitationRows(invitations,true) + '</details>';
}
async function handleMembershipClick(button) {
  const { action,id } = button.dataset; button.disabled = true;
  try {
    if (action === 'membership-refresh') { await initialize(); return; }
    if (action === 'review-member') { closeModal(); location.hash = 'admin/applications?user=' + id; return; }
    if (action === 'membership-review') {
      const a = applicationReviews.find(a => a.user_id === Number(id)), review = button.dataset.review;
      modal({approve:'Approve membership?',decline:'Decline membership?',request_changes:'Request more information?'}[review],
        form('membership-review', `<p>Reviewing ${esc(a.name)}. This decision controls access to the private community.</p><input type="hidden" name="id" value="${a.user_id}"><input type="hidden" name="revision" value="${a.revision}"><input type="hidden" name="action" value="${review}">${field('message','Message to applicant (visible to them)',{type:'textarea',max:1500,required:review !== 'approve'})}`,'Confirm decision'));
      return;
    }
    if (action === 'create-invitation') {
      const result = await api('/invitations','POST',{});
      modal('Your private invitation code', `<p>Copy this code now. It expires in 14 days, can be used once, and is not displayed again after closing.</p><label for="invitation-copy">Invitation code</label><input id="invitation-copy" readonly value="${esc(result.code)}"><button class="form-submit" data-action="copy-invitation">Copy invitation code</button><p class="hint">An invitation does not grant access. The applicant must still be approved.</p>`);
      await load(); return;
    }
    if (action === 'copy-invitation') {
      const input = $('#invitation-copy');
      if (navigator.clipboard) { await navigator.clipboard.writeText(input.value); notice('Invitation code copied.'); }
      else { input.focus(); input.select(); notice('Select and copy this code.'); }
      return;
    }
    if (action === 'revoke-invitation') {
      await api('/invitations/' + id,'DELETE'); notice('Invitation revoked.'); await load();
    }
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
}
async function handleMembershipSubmit(f) {
  const data = Object.fromEntries(new FormData(f)), submit = f.querySelector('[type=submit]');
  submit.disabled = true; f.querySelector('.form-error').textContent = '';
  try {
    if (f.dataset.form === 'membership-application') {
      await api('/membership/application','PUT',{ ...data,eligibility_confirmed:data.eligibility_confirmed === 'on' }); notice('Application submitted for review.'); await initialize();
    } else {
      await api('/admin/membership-applications/' + data.id,'PATCH',{ action:data.action,revision:Number(data.revision),message:data.message });
      closeModal(); notice('Membership review saved.'); await load();
    }
  } catch (error) { f.querySelector('.form-error').textContent = error.message; }
  finally { submit.disabled = false; }
}

async function inviteLogsPage(route){
 const params=new URLSearchParams(route.split('?')[1]||'');
 const data=await api('/admin/invite-logs?'+params);
 return heading('Invite Logs','Review invitation generation and use.')+
 '<section class="card"><form data-invite-filter><label>Generating user ID<input name="issuer" type="number" min="1" value="'+esc(params.get('issuer')||'')+'"></label><label>Status<select name="status">'+['all','active','used','revoked','expired','unavailable'].map(x=>'<option '+(params.get('status')===x?'selected ':'')+'value="'+x+'">'+x+'</option>').join('')+'</select></label><button>Filter</button></form></section>'+
 '<section class="card"><h2>Verify a code</h2><form data-invite-verify><label>Full invitation code<input name="code" required maxlength="100" autocomplete="off"></label><button>Verify code</button><p class="form-error"></p><div data-invite-result aria-live="polite"></div></form></section>'+
 '<section class="card">'+(data.logs.map(inviteLogRow).join('')||'<p>No invitations match.</p>')+'</section>'+
 (data.next_before?'<a href="#admin/invite-logs?'+esc(new URLSearchParams({...Object.fromEntries(params),before:data.next_before}).toString())+'">Older entries</a>':'');
}
function inviteLogRow(i){
 return '<article class="admin-row"><strong>Invitation #'+i.id+' · …'+esc(i.suffix)+'</strong> <span class="pill">'+esc(i.status)+'</span><p>Generated by <button class="profile-link" data-action="admin-profile" data-id="'+i.issuer_id+'">'+esc(i.issuer_name)+'</button> (#'+i.issuer_id+') · '+esc(i.issuer_email)+'</p><small>Created '+esc(date(i.created_at))+' · Expires '+esc(date(i.expires_at))+'</small>'+(i.used_by?'<p>Used by <button class="profile-link" data-action="admin-profile" data-id="'+i.used_by+'">'+esc(i.used_by_name)+'</button> · '+esc(i.used_by_email)+' · '+esc(date(i.used_at))+'</p>':'')+(i.status==='active'?'<button class="secondary" data-action="revoke-invitation" data-id="'+i.id+'">Revoke invitation</button>':'')+'</article>';
}
document.addEventListener('submit',async event=>{
 const f=event.target;
 if(f.matches('[data-invite-filter]')){event.preventDefault();location.hash='admin/invite-logs?'+new URLSearchParams(new FormData(f));return;}
 if(!f.matches('[data-invite-verify]'))return;
 event.preventDefault();const button=f.querySelector('button');button.disabled=true;
 try{
  const result=await api('/admin/invite-logs/verify','POST',{code:f.elements.code.value.trim()});
  f.elements.code.value='';f.querySelector('.form-error').textContent='';
  f.querySelector('[data-invite-result]').innerHTML=result.found?inviteLogRow(result.invitation):'<p>Code not found or invalid. It cannot be used to create an account.</p>';
 }catch(error){f.querySelector('.form-error').textContent=error.message;}
 finally{button.disabled=false;}
});
