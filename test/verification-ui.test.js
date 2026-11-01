import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
async function waitFor(check) {for(let n=0;n<100;n++){if(check()) return;await delay(10);}assert.fail('Verification UI did not reach expected state.');}
async function page(hash,fetcher) {
  const {JSDOM}=await import('jsdom');
  const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#'+hash,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,close=w.close;
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=fetcher;
  w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
  return {w,close:()=>close.call(w)};
}
const response=data=>({ok:true,json:async()=>data});
test('verification is optional and requires separate consent; members can withdraw', {skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
  const user={id:1,name:'Member',membership_status:'approved',admin:false,verified_member:false},calls=[];
  let status={enabled:true,optional:true,verified:false,status:'not_started',attempt_id:null,retention_hours:72};
  const ui=await page('verification',async(url,opts={})=>{
    calls.push([url,opts.method??'GET',opts.body]);
    if(url==='/api/session') return response({user,csrf:'test'});
    if(url==='/api/unread') return response({messages:0,notifications:0});
    if(url==='/api/verification'&&opts.method==='DELETE'){status={...status,verified:false,status:'not_started',attempt_id:null};user.verified_member=false;return response({ok:true});}
    if(url==='/api/verification') return response(status);
    if(url==='/api/posts') return response([]);
    assert.fail('Unexpected verification request '+url);
  });
  const w=ui.w;
  try {
    await waitFor(()=>w.document.querySelector('[data-action="verification-start"]'));
    assert.ok(w.document.querySelector('#main').textContent.includes('optional'));
    assert.ok(w.document.querySelector('.sidebar a[href="#feed"]'));
    w.document.querySelector('[data-action="verification-start"]').click();
    assert.equal(calls.some(c=>c[0]==='/api/verification/attempts'),false);
    status={...status,verified:true,status:'verified',attempt_id:'11111111-1111-4111-8111-111111111111',method:'aws_liveness',verified_at:'2026-11-01T00:00:00Z'};user.verified_member=true;
    w.location.hash='profile';await waitFor(()=>w.document.querySelector('.member-badge.verified'));
    w.location.hash='verification';await waitFor(()=>w.document.querySelector('[data-action="verification-delete"]'));
    w.document.querySelector('[data-action="verification-delete"]').click();
    assert.equal(calls.some(c=>c[0]==='/api/verification'&&c[1]==='DELETE'),false);
    const f=w.document.querySelector('form[data-form="verification-delete"]');f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>calls.some(c=>c[0]==='/api/verification'&&c[1]==='DELETE'));
    await waitFor(()=>w.document.querySelector('[data-action="verification-start"]'));
  }finally{ui.close();}
});
test('flagged images stay in private admin review with explicit decisions and revocation', {skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
  const user={id:1,name:'Owner',membership_status:'approved',admin:true},calls=[];
  const attempt={id:'11111111-1111-4111-8111-111111111111',user_id:2,name:'Member',email:'member@example.com',status:'pending_review',confidence:'20.00',revision:2,image_count:2,evidence_expires_at:'2099-01-01T00:00:00Z',verified:false};
  let reviewed=false,revoked=false;
  const ui=await page('verification-review',async(url,opts={})=>{
    calls.push([url,opts.method??'GET',opts.body]);
    if(url==='/api/session')return response({user,csrf:'test'});
    if(url==='/api/unread')return response({messages:0,notifications:0});
    if(url.startsWith('/api/admin/verification?'))return response({enabled:true,configured:true,retention_hours:72,attempts:url.includes('status=verified')?(reviewed&&!revoked?[{...attempt,status:'verified',verified:true,image_count:0}]:[]):reviewed?[]:[attempt]});
    if(url==='/api/admin/verification/attempts/'+attempt.id){const body=JSON.parse(opts.body);assert.equal(body.action,'approve');assert.equal(body.revision,2);reviewed=true;return response({ok:true});}
    if(url==='/api/admin/verification/members/2/revoke'){revoked=true;return response({ok:true});}
    assert.fail('Unexpected admin verification request '+url);
  });
  const w=ui.w;
  try {
    await waitFor(()=>w.document.querySelector('[data-action="verification-open-review"]'));
    assert.equal(w.document.querySelector('.verification-card img'),null);
    w.document.querySelector('[data-action="verification-open-review"]').click();
    const images=[...w.document.querySelectorAll('.review-evidence img')];assert.equal(images.length,2);
    assert.ok(images.every(i=>i.getAttribute('src').startsWith('/api/admin/verification/')));
    const f=w.document.querySelector('form[data-form="verification-review"]');f.elements.action.value='approve';f.elements.message.value='Reviewed human-presence evidence.';
    assert.equal(reviewed,false);f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!w.document.querySelector('.verification-card'));
    w.location.hash='verification-review?status=verified';await waitFor(()=>w.document.querySelector('[data-action="verification-revoke"]'));
    w.document.querySelector('[data-action="verification-revoke"]').click();
    const revoke=w.document.querySelector('form[data-form="verification-revoke"]');revoke.elements.message.value='Verification revoked after review.';revoke.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>revoked);await waitFor(()=>!w.document.querySelector('.verification-card'));
  }finally{ui.close();}
});

test('temporary password gate blocks community navigation until replacement', {skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const user={id:2,name:'Member',membership_status:'approved',must_change_password:true};let changed=false;
 const ui=await page('feed',async(url,opts={})=>{
  if(url==='/api/session')return response({user,csrf:'test'});
  if(url==='/api/password/change'){const body=JSON.parse(opts.body);assert.equal(body.current_password,'Temporary-pass-123');assert.equal(body.new_password,'New-password-123');changed=true;user.must_change_password=false;return response({ok:true});}
  if(url==='/api/unread')return response({messages:0,notifications:0});
  if(url==='/api/posts')return response([]);
  assert.fail('Unexpected gate request '+url);
 });
 try{
  const w=ui.w;await waitFor(()=>w.document.querySelector('form[data-form="password-change"]'));
  assert.equal(w.document.querySelector('.sidebar'),null);
  const f=w.document.querySelector('form[data-form="password-change"]');f.elements.current_password.value='Temporary-pass-123';f.elements.new_password.value='New-password-123';f.elements.confirm_password.value='Mismatch-password';
  f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>f.querySelector('.form-error').textContent.includes('match'));assert.equal(changed,false);
  f.elements.confirm_password.value='New-password-123';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>changed);await waitFor(()=>w.document.querySelector('.sidebar'));
 }finally{ui.close();}
});

test('administration consolidates staff navigation and keeps audit logs private', {skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const user={id:1,name:'Admin',admin:true,membership_status:'approved'};
 const ui=await page('admin/users',async(url)=>{
  if(url==='/api/session')return response({user,csrf:'test'});
  if(url==='/api/unread')return response({messages:0,notifications:0});
  if(url==='/api/admin?q=')return response({users:[],reports:[]});
  if(url==='/api/admin/logs')return response({logs:[{id:4,action:'password_reset',actor_name:'<Admin>',actor_id:1,target_name:'Member',target_id:2,created_at:'2026-11-01T00:00:00Z'}],next_before:4});
  if(url==='/api/admin/logs?before=4')return response({logs:[],next_before:null});
  if(url==='/api/admin/reports')return response([]);
  assert.fail('Unexpected administration request '+url);
 });
 try{
  const w=ui.w;await waitFor(()=>w.document.querySelector('.admin-tabs'));
  assert.equal(w.document.querySelectorAll('.admin-tabs a').length,6);
  assert.equal(w.document.querySelector('.sidebar a[href="#applications"]'),null);
  assert.equal(w.document.querySelector('.sidebar a[href="#verification-review"]'),null);
  assert.equal(w.document.querySelector('.sidebar a[href="#invitations"]'),null);
  assert.ok(w.document.querySelector('.sidebar a[href="#admin"].active'));
  w.location.hash='admin/logs';await waitFor(()=>w.document.querySelector('.audit-list'));
  assert.ok(w.document.querySelector('.audit-list').textContent.includes('<Admin>'));
  assert.equal(w.document.querySelector('.audit-list admin'),null);
  w.document.querySelector('a[href="#admin/logs?before=4"]').click();await waitFor(()=>w.document.querySelector('#main').textContent.includes('No audit entries'));
  w.location.hash='admin/moderation';await waitFor(()=>w.document.querySelector('#main').textContent.includes('No open reports'));
 }finally{ui.close();}
 const member=await page('admin/logs',async(url)=>{
  if(url==='/api/session')return response({user:{id:2,name:'Member',admin:false,membership_status:'approved'},csrf:'test'});
  if(url==='/api/unread')return response({messages:0,notifications:0});
  assert.fail('Member must not request staff data '+url);
 });
 try{await waitFor(()=>member.w.document.querySelector('#main')?.textContent.includes('Administrator access required'));assert.equal(member.w.document.querySelector('.admin-tabs'),null);}finally{member.close();}
});
