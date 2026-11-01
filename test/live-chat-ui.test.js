import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('live replies preserve drafts, escape content, deduplicate, and show ephemeral hints',{skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#messages/2',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,events={},emits=[];let latest=false,nonce;
 const socket={connected:true,on:(name,fn)=>{events[name]=fn;return socket;},emit:(...args)=>emits.push(args),disconnect:()=>{},connect:()=>{}};w.io=()=>socket;
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
 const self={id:1,name:'Self',membership_status:'approved'},peer={id:2,name:'Friend'},first={id:1,sender_id:2,recipient_id:1,body:'Hello',created_at:'2026-11-01T00:00:00Z'};
 w.fetch=async(url,opts={})=>{
  let data;
  if(url==='/api/session')data={user:self,csrf:'test'};
  else if(url==='/api/unread')data={messages:0,notifications:0};
  else if(url==='/api/messages/2'&&opts.method==='POST'){const body=JSON.parse(opts.body);nonce=body.nonce;data={id:3};}
  else if(url==='/api/messages/2')data={peer,can_send:true,messages:[first],has_more:false};
  else if(url.startsWith('/api/messages/2?after='))data={peer,can_send:true,messages:latest?[{id:2,sender_id:2,recipient_id:1,body:'<img src=x onerror=alert(1)>',created_at:first.created_at}]:[],has_more:false};
  else assert.fail('Unexpected live UI request '+url);
  return {ok:true,json:async()=>data};
 };
 const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await delay(10);}assert.fail('Live UI did not settle.');};
 try{
  w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','live-chat-ui.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
  await wait(()=>w.document.querySelector('form[data-form="message"]'));
  const f=w.document.querySelector('form[data-form="message"]');f.elements.body.value='Keep my unfinished draft';
  latest=true;events['chat:message']({peerId:2});await wait(()=>w.document.querySelector('[data-message-id="2"]'));
  assert.equal(f.elements.body.value,'Keep my unfinished draft');assert.equal(w.document.querySelector('.conversation img'),null);
  events['chat:message']({peerId:2});await delay(30);assert.equal(w.document.querySelectorAll('[data-message-id="2"]').length,1);
  events['chat:presence']({peerId:2,online:true});assert.equal(w.document.querySelector('[data-chat-presence]').textContent,'Online');
  events['chat:typing']({peerId:2,active:true});assert.equal(w.document.querySelector('[data-chat-typing]').textContent,'Typing…');
  f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>nonce);assert.match(nonce,/^[a-f0-9-]{36}$/);await wait(()=>f.elements.body.value==='');
  events['chat:access']({allowed:false});assert.equal(f.elements.body.disabled,true);
  assert.equal(w.document.querySelector('[data-chat-presence]').textContent,'');
 }finally{w.close();}
});