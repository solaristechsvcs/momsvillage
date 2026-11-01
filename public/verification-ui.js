let verificationRows = [];
const verificationActions = new Set(['verification-start','verification-check','verification-delete','verification-open-review','verification-revoke']);
const verificationLabels = {not_started:'Not started',in_progress:'Camera check in progress',pending_review:'Awaiting private review',verified:'Verified',rejected:'Please retry',expired:'Check expired',error:'Check could not finish',cancelled:'Cancelled',revoked:'Verification revoked'};
async function verificationPage(route) {
  if(page==='verification-review' || route.split('?')[0]==='admin/verification') {
    if(!me.admin) return empty('Administrator access required.','Choose another page.');
    const status=new URLSearchParams(route.split('?')[1]).get('status') ?? 'pending_review';
    const data=await api('/admin/verification?status='+encodeURIComponent(status)); verificationRows=data.attempts;
    return heading('Verification review','Private review of flagged human-presence checks.') + `<p class="hint">Camera checks: ${data.configured ? 'Ready' : data.enabled ? 'Setup required' : 'Disabled'}. Review images expire after ${esc(data.retention_hours)} hours and are deleted after a decision. Review authenticity and image quality; images do not establish gender or motherhood.</p><div class="buttons"><a class="button-link" href="#admin/verification">Flagged attempts</a><a class="button-link" href="#admin/verification?status=verified">Verified members</a></div><p></p>` +
      (data.attempts.map(a=>`<article class="card verification-card"><h3>${esc(a.name)}</h3><p class="muted">${esc(a.email)}</p><span class="pill">${esc(verificationLabels[a.status] ?? a.status)}</span><p>AI liveness score: ${a.confidence === null ? 'Unavailable' : esc(a.confidence)} / 100</p><p class="hint">${a.evidence_expires_at ? 'Images expire '+esc(date(a.evidence_expires_at)) : 'No stored review images'}</p><div class="buttons">${a.status==='pending_review' ? `<button data-action="verification-open-review" data-id="${a.id}">Open private review</button>` : ''}${a.verified ? `<button class="secondary" data-action="verification-revoke" data-user="${a.user_id}">Revoke verification</button>` : ''}</div></article>`).join('') || empty('No attempts in this view.','Flagged camera checks will appear here.'));
  }
  const data=await api('/verification');
  const enabled=data.enabled, active=data.status==='in_progress', flagged=data.status==='pending_review';
  return heading('Optional member verification','A camera check for human presence.') +
    `<section class="card"><span class="pill">${esc(verificationLabels[data.status] ?? data.status)}</span>${data.verified ? '<h2>Verified Member</h2>' : ''}<p>Verification is optional. Approved members keep their current community access regardless of verification status.</p><p>This checks human presence. It does not verify gender, identity documents, or motherhood.</p>${data.review_message ? `<p class="application-answer">${esc(data.review_message)}</p>` : ''}${flagged ? '<p>Your check is waiting for an administrator to review the private images. Check this page for the decision.</p>' : ''}${!enabled ? '<p class="hint">Optional camera verification is not available yet. Your membership access is unaffected.</p>' : ''}${data.verified ? `<p class="hint">Completed ${esc(date(data.verified_at))} · ${data.method==='manual_review' ? 'Approved after manual review' : 'AI liveness check completed'}</p>` : ''}${active && enabled ? `<div class="buttons"><a class="button-link" href="/verification-check.html?attempt=${encodeURIComponent(data.attempt_id)}">Continue camera check</a><button class="secondary" data-action="verification-check" data-id="${data.attempt_id}">Check result</button></div>` : ''}${enabled && !data.verified && !active && !flagged ? `<p>A short camera video is processed by Amazon Web Services. A successful automatic check does not retain review photos here. Flagged check images are encrypted, visible only to administrators, and retained for up to ${esc(data.retention_hours)} hours. You can delete verification data and withdraw verification. The camera flow may show flashing lights; read its instructions before proceeding.</p><label class="check"><input type="checkbox" id="verification-consent"><span>I consent to this optional camera check, AWS processing, and private review of flagged images as described above.</span></label><button class="form-submit" data-action="verification-start">Start optional verification</button><p class="hint">Up to three new attempts per day. You can cancel the check at any time.</p>` : ''}${data.attempt_id || data.verified ? '<p><button class="secondary" data-action="verification-delete">Delete verification data / withdraw</button></p>' : ''}</section>`;
}
async function handleVerificationClick(button) {
  const {action,id}=button.dataset; button.disabled=true;
  try {
    if(action==='verification-start') {
      const consent=!!$('#verification-consent')?.checked;
      if(!consent) { notice('Read the camera-check notice and confirm consent first.');return; }
      const attempt=await api('/verification/attempts','POST',{consent:true});
      location.assign('/verification-check.html?attempt='+encodeURIComponent(attempt.id));return;
    }
    if(action==='verification-check') { await api('/verification/attempts/'+id+'/complete','POST',{});await initialize();return; }
    if(action==='verification-delete') {
      modal('Delete verification data?',form('verification-delete','<p>This deletes stored review photos, cancels unfinished checks and removes your Verified status. Your approved membership access remains available while verification is optional.</p>','Delete data and withdraw'));return;
    }
    if(action==='verification-open-review') {
      const a=verificationRows.find(a=>a.id===id);
      modal('Private verification review',`<p>${esc(a.name)} · AI liveness score ${esc(a.confidence)} / 100</p><p class="hint">Assess authenticity and quality. Do not infer gender or motherhood from appearance. Access to these images is logged.</p><div class="review-evidence">${Array.from({length:a.image_count},(_,i)=>`<img src="/api/admin/verification/attempts/${a.id}/images/${i}" referrerpolicy="no-referrer" alt="Verification review image ${i+1}">`).join('')}</div>${form('verification-review',`<input type="hidden" name="id" value="${a.id}"><input type="hidden" name="revision" value="${a.revision}"><label for="review-action">Decision</label><select name="action" id="review-action" required><option value="">Choose a decision</option><option value="approve">Approve after manual review</option><option value="reject">Request a new camera check</option></select>${field('message','Review reason / message to member',{type:'textarea',max:1500})}`,'Save verification review')}`);return;
    }
    if(action==='verification-revoke') {
      modal('Revoke Verified status?',form('verification-revoke',`<input type="hidden" name="id" value="${button.dataset.user}">${field('message','Reason / message to member',{type:'textarea',max:1500})}`,'Revoke verification'));return;
    }
  } catch(error) {notice(error.message);}
  finally {button.disabled=false;}
}
async function handleVerificationSubmit(f) {
  const data=Object.fromEntries(new FormData(f)),button=f.querySelector('[type=submit]');
  button.disabled=true;f.querySelector('.form-error').textContent='';
  try {
    if(f.dataset.form==='verification-delete') {await api('/verification','DELETE');closeModal();await initialize();return;}
    if(f.dataset.form==='verification-review') await api('/admin/verification/attempts/'+data.id,'PATCH',{action:data.action,revision:Number(data.revision),message:data.message});
    if(f.dataset.form==='verification-revoke') await api('/admin/verification/members/'+data.id+'/revoke','PATCH',{message:data.message});
    closeModal();notice('Verification updated.');await load();
  } catch(error) {f.querySelector('.form-error').textContent=error.message;}
  finally {button.disabled=false;}
}
