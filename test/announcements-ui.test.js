import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await delay(10);}assert.fail('Announcement UI did not settle.');};
test('public announcement is escaped, dismissible, refreshed and independent of page contents',{skip:process.env.MV_UI!=='1'},async()=>{
 const {JSDOM}=await import('jsdom'),dom=new JSDOM('<body><div id="app">Page</div></body>',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let a={title:'<script>Title</script>',body:'<img src=x onerror=bad()>',tone:'important',revision:1};
 w.fetch=async()=>({ok:true,json:async()=>({announcement:a})});
 try{
  w.eval(await readFile(new URL('../public/announcement-banner.js',import.meta.url),'utf8'));await wait(()=>w.document.getElementById('site-announcement'));
  assert.equal(w.document.querySelector('#site-announcement img'),null);assert.ok(w.document.querySelector('#site-announcement').textContent.includes('<script>Title</script>'));
  w.document.querySelector('#app').textContent='Another page';assert.ok(w.document.getElementById('site-announcement'));
  w.document.querySelector('#site-announcement button').click();await w.refreshSiteAnnouncement();assert.equal(w.document.getElementById('site-announcement'),null);
  a={...a,revision:2};await w.refreshSiteAnnouncement();assert.ok(w.document.getElementById('site-announcement'));
  a=null;await w.refreshSiteAnnouncement();assert.equal(w.document.getElementById('site-announcement'),null);
 }finally{w.close();}
});
test('admin can publish and remove a sitewide announcement with explicit confirmation',{skip:process.env.MV_UI!=='1'},async()=>{
 const {JSDOM}=await import('jsdom'),dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#admin/announcements',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let a={title:'',body:'',tone:'info',enabled:false,revision:1},removed=false;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.fetch=async(url,opts={})=>{let data;
 if(url==='/api/session')data={user:{id:1,name:'Owner',admin:true,membership_status:'approved'},csrf:'test'};
 else if(url==='/api/unread')data={messages:0,notifications:0};
 else if(url==='/api/admin/announcement'){
  if(opts.method==='PUT'){const body=JSON.parse(opts.body);assert.equal(body.revision,a.revision);a={...body,revision:a.revision+1};data={ok:true};}
  else if(opts.method==='DELETE'){removed=true;a={...a,enabled:false,revision:a.revision+1};data={ok:true};}else data=a;
 }else assert.fail('Unexpected announcement request '+url);
 return {ok:true,json:async()=>data};};
 try{
  w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','announcements-ui.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
  await wait(()=>w.document.querySelector('[data-announcement-form="save"]'));
  const f=w.document.querySelector('[data-announcement-form="save"]');f.elements.title.value='News';f.elements.body.value='Welcome everyone';f.elements.enabled.checked=true;f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>w.document.querySelector('[data-announcement-remove]'));assert.equal(a.enabled,true);
  w.document.querySelector('[data-announcement-remove]').click();assert.equal(removed,false);
  w.document.querySelector('[data-announcement-form="remove"]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>removed);await wait(()=>!w.document.querySelector('[data-announcement-remove]'));
 }finally{w.close();}
});