import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('chat dock keeps separate collapsible conversations and drafts across pages',{skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#feed',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 const events={},calls=[];let signedIn=true,incoming=false;
 const user={id:1,name:'Self',membership_status:'approved'},friends=[{id:2,name:'Friend Two',status:'accepted'},{id:3,name:'Friend Three',status:'accepted'}];
 const socket={connected:true,on:(name,fn)=>{events[name]=fn;return socket;},emit:()=>{},disconnect:()=>{},connect:()=>{}};w.io=()=>socket;
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
 w.fetch=async(url,opts={})=>{calls.push([url,opts.method??'GET',opts.body]);let data;
  if(url==='/api/session')data={user:signedIn?user:null,csrf:'test'};
  else if(url==='/api/logout'){signedIn=false;data={ok:true};}
  else if(url==='/api/unread')data={messages:incoming?1:0,notifications:0};
  else if(url==='/api/posts'||url==='/api/groups'||url==='/api/messages')data=[];
  else if(url==='/api/friends')data={friends,blocks:[]};
  else if(url==='/api/chat/online')data={user_ids:[2]};
  else if(url.startsWith('/api/messages/')){const id=Number(url.split('/').pop().split('?')[0]);if(opts.method==='POST')data={id:9};else data={peer:friends.find(f=>f.id===id),can_send:true,has_more:false,messages:incoming&&id===2?[{id:4,sender_id:2,recipient_id:1,body:'<script>Reply</script>',created_at:'2026-11-01T00:00:00Z'}]:[]};}
  else assert.fail('Unexpected dock request '+url);
  return {ok:true,json:async()=>data};
 };
 const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await delay(10);}assert.fail('Dock did not settle.');};
 try{
  w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','live-chat-ui.js','chat-dock.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
  await wait(()=>w.document.querySelector('.dock-launcher'));
  w.document.querySelector('.dock-launcher').click();await wait(()=>w.document.querySelector('[data-dock-action="open"]'));
  assert.ok(w.document.querySelector('[data-dock-online="2"]').textContent.includes('Online'));
  w.document.querySelector('[data-dock-action="open"][data-id="2"]').click();await wait(()=>w.document.querySelector('[data-dock-peer="2"] textarea'));
  const first=w.document.querySelector('[data-dock-peer="2"]'),draft=first.querySelector('textarea');draft.value='Draft for friend two';
  w.location.hash='groups';await wait(()=>w.document.querySelector('#main h1')?.textContent.includes('local'));
  assert.equal(w.document.querySelector('[data-dock-peer="2"] textarea'),draft);assert.equal(draft.value,'Draft for friend two');
  first.querySelector('[data-dock-action="minimize"]').click();assert.ok(first.classList.contains('minimized'));
  const count=calls.filter(c=>c[0].startsWith('/api/messages/2')).length;incoming=true;events['chat:message']({peerId:2});await wait(()=>!first.querySelector('.dock-new').hidden);
  assert.equal(calls.filter(c=>c[0].startsWith('/api/messages/2')).length,count,'Collapsed windows must not read incoming messages');
  first.querySelector('[data-dock-action="expand"]').click();await wait(()=>first.querySelector('[data-message-id="4"]'));
  assert.equal(first.querySelector('.dock-new').hidden,true);assert.equal(first.querySelector('script'),null);assert.equal(draft.value,'Draft for friend two');
  w.document.querySelector('[data-dock-action="open"][data-id="3"]').click();await wait(()=>w.document.querySelector('[data-dock-peer="3"]'));
  assert.equal(w.document.querySelectorAll('.dock-window').length,2);
  const second=w.document.querySelector('[data-dock-peer="3"]'),f=second.querySelector('form');f.elements.body.value='Hello three';const shift=new w.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});f.elements.body.dispatchEvent(shift);assert.equal(shift.defaultPrevented,false);assert.equal(calls.some(c=>c[0]==='/api/messages/3'&&c[1]==='POST'),false);f.elements.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));assert.equal(calls.some(c=>c[0]==='/api/messages/3'&&c[1]==='POST'),false);f.elements.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await wait(()=>calls.some(c=>c[0]==='/api/messages/3'&&c[1]==='POST'));
  assert.equal(JSON.parse(calls.find(c=>c[0]==='/api/messages/3'&&c[1]==='POST')[2]).body,'Hello three');assert.equal(draft.value,'Draft for friend two');
  first.querySelector('[data-dock-action="close"]').click();assert.equal(w.document.querySelectorAll('.dock-window').length,1);
  w.document.querySelector('[data-action="logout"]').click();await wait(()=>!w.document.getElementById('chat-dock'));
 }finally{w.close();}
});