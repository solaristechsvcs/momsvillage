import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('closed groups hide posts and allow requesting or cancelling access',{skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const {JSDOM}=await import('jsdom'),dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#group/5',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const g={id:5,name:'Closed circle',owner_id:1,city:'',description:'Approval required',visibility:'closed',joined:false,join_requested:false,members:1};let postReads=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.fetch=async(url,opts={})=>{let data;
 if(url==='/api/session')data={user:{id:2,name:'Applicant',membership_status:'approved'},csrf:'test'};
 else if(url==='/api/unread')data={messages:0,notifications:0};
 else if(url==='/api/groups')data=[g];
 else if(url==='/api/groups/5/join'){g.join_requested=JSON.parse(opts.body).active;data={ok:true,status:g.join_requested?'pending':'left'};}
 else if(url==='/api/posts?group=5'){assert.equal(g.joined,true,'Nonmembers must not fetch closed posts');postReads++;data=[];}
 else assert.fail('Unexpected closed-group request '+url);
 return {ok:true,json:async()=>data};};
 const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await delay(10);}assert.fail('Closed group UI did not settle.');};
 try{
 w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
 await wait(()=>w.document.querySelector('[data-action="join"]'));
 assert.equal(postReads,0);assert.equal(w.document.querySelector('.composer'),null);assert.equal(w.document.querySelector('[data-action="join"]').textContent,'Request to join');
 w.document.querySelector('[data-action="join"]').click();await wait(()=>w.document.querySelector('[data-action="join"]')?.textContent==='Cancel join request');assert.equal(postReads,0);
 w.document.querySelector('[data-action="join"]').click();await wait(()=>w.document.querySelector('[data-action="join"]')?.textContent==='Request to join');
 g.joined=true;g.join_requested=false;w.location.hash='groups';await wait(()=>w.document.querySelector('[data-action="new-group"]'));
 w.document.querySelector('[data-action="new-group"]').click();assert.equal(w.document.querySelector('select[name="visibility"]').value,'open');assert.ok(w.document.querySelector('select[name="visibility"] option[value="closed"]'));
 w.document.querySelector('[data-action="close"]').click();w.location.hash='group/5';await wait(()=>w.document.querySelector('.composer'));assert.equal(postReads,1);
 }finally{w.close();}
});