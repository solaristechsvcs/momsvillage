import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

async function bootUI(hash, fetcher) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url),'utf8'), { url:'https://example.com/#' + hash, runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window, close = w.close;
  w.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open',''); };
  w.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  w.fetch = fetcher;
  const scripts = await Promise.all(['membership-ui.js','social-ui.js','app.js'].map(f => readFile(new URL('../public/' + f,import.meta.url),'utf8')));
  w.eval(scripts.join('\n'));
  return { w, close:() => close.call(w) };
}
async function waitFor(check) { for (let n=0;n<100;n++) { if(check()) return; await delay(10); } assert.fail('Membership UI did not reach the expected state.'); }
const policy = { text:'For adult mothers only.',confirmation:'I am a mother aged 18 or older.',invite_only:false };
const response = data => ({ ok:true,json:async()=>data });

test('pending, declined and suspended applicants stay outside community UI until approved', { skip:process.env.MV_UI !== '1',timeout:10000 }, async()=>{
  const user = { id:9,name:'Applicant',email:'applicant@example.com',admin:false,membership_status:'pending' };
  const application = { user_id:9,status:'pending',reason:'Looking for support',referral:'',eligibility_confirmed:true,revision:1,submitted_at:'2026-11-01T00:00:00Z',review_message:'<script>Review feedback</script>' };
  const calls = [];
  const ui = await bootUI('marketplace',async(url,opts={})=>{
    calls.push([url,opts.method ?? 'GET',opts.body]);
    if(url==='/api/session') return response({user,csrf:'test',membership_policy:policy});
    if(url==='/api/membership') return response({status:user.membership_status,application,policy});
    if(url==='/api/membership/application') {
      const body=JSON.parse(opts.body); assert.equal(body.eligibility_confirmed,true);
      application.reason=body.application_reason; application.status='pending'; application.review_message=''; application.revision++; user.membership_status='pending';
      return response({ok:true});
    }
    if(user.membership_status!=='approved') assert.fail('Applicant tried to load community data: ' + url);
    if(url==='/api/unread') return response({messages:0,notifications:0});
    if(url==='/api/posts') return response([]);
    assert.fail('Unexpected URL ' + url);
  });
  const w=ui.w;
  try {
    await waitFor(()=>w.document.querySelector('.membership-gate'));
    assert.equal(w.document.querySelector('.sidebar'),null);
    assert.equal(w.document.querySelector('.membership-gate script'),null);
    assert.ok(w.document.querySelector('.membership-gate').textContent.includes('<script>Review feedback</script>'));
    w.location.hash='members'; await delay(20);
    assert.equal(calls.some(c=>c[0].startsWith('/api/members')),false);
    user.membership_status='declined'; application.status='declined';
    w.document.querySelector('[data-action="membership-refresh"]').click(); await waitFor(()=>w.document.querySelector('h1')?.textContent.includes('needs attention'));
    const f=w.document.querySelector('form[data-form="membership-application"]'); f.elements.application_reason.value='Updated application';
    f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>w.document.querySelector('h1')?.textContent.includes('awaiting review'));
    assert.equal(JSON.parse(calls.find(c=>c[0]==='/api/membership/application')[2]).application_reason,'Updated application');
    user.membership_status='suspended'; w.document.querySelector('[data-action="membership-refresh"]').click();
    await waitFor(()=>w.document.querySelector('h1')?.textContent.includes('suspended'));
    assert.equal(w.document.querySelector('form[data-form="membership-application"]'),null);
    user.membership_status='approved'; application.status='approved'; w.document.querySelector('[data-action="membership-refresh"]').click();
    await waitFor(()=>w.document.querySelector('.sidebar'));
    assert.ok(calls.some(c=>c[0]==='/api/unread')); assert.ok(calls.some(c=>c[0]==='/api/posts'));
  } finally { ui.close(); }
});

test('admin reviews require confirmation and invitation secrets are displayed only on creation', { skip:process.env.MV_UI !== '1',timeout:10000 }, async()=>{
  const owner={id:1,name:'Owner',admin:true,membership_status:'approved'};
  let reviewed=false,created=false;
  const calls=[],code='ab'.repeat(24);
  const application={ user_id:9,name:'Applicant',email:'applicant@example.com',city:'Austin',status:'pending',reason:'<script>Application</script>',revision:3,eligibility_confirmed:true,submitted_at:'2026-11-01T00:00:00Z' };
  const ui=await bootUI('applications',async(url,opts={})=>{
    calls.push([url,opts.method ?? 'GET',opts.body]);
    if(url==='/api/session') return response({user:owner,csrf:'test',membership_policy:policy});
    if(url==='/api/unread') return response({messages:0,notifications:0});
    if(url.startsWith('/api/admin/membership-applications?')) return response(reviewed?[]:[application]);
    if(url==='/api/admin/invitations') return response([]);
    if(url==='/api/admin/membership-applications/9') { const body=JSON.parse(opts.body);assert.equal(body.action,'approve');assert.equal(body.revision,3);reviewed=true;return response({ok:true}); }
    if(url==='/api/invitations'&&opts.method==='POST') { created=true;return response({code,expires_in_days:14}); }
    if(url==='/api/invitations') return response(created?[{id:1,suffix:'ababab',expires_at:'2099-01-01T00:00:00Z',revoked:false,used_at:null}]:[]);
    assert.fail('Unexpected URL '+url);
  });
  const w=ui.w;
  try {
    await waitFor(()=>w.document.querySelector('.application-card'));
    assert.equal(w.document.querySelector('.application-card script'),null);
    w.document.querySelector('[data-action="membership-review"][data-review="approve"]').click();
    assert.equal(reviewed,false);
    const f=w.document.querySelector('form[data-form="membership-review"]');f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!w.document.querySelector('.application-card'));
    assert.equal(reviewed,true);
    w.location.hash='invitations'; await waitFor(()=>w.document.querySelector('[data-action="create-invitation"]'));
    w.document.querySelector('[data-action="create-invitation"]').click(); await waitFor(()=>w.document.querySelector('#invitation-copy'));
    assert.equal(w.document.querySelector('#invitation-copy').value,code);
    w.document.querySelector('[data-action="close"]').click();
    assert.equal(w.document.querySelector('#invitation-copy'),null);
    assert.equal(w.document.body.textContent.includes(code),false);
    assert.ok(w.document.querySelector('[data-action="revoke-invitation"]'));
  } finally { ui.close(); }
});
