import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('owners edit groups and authors edit their own posts with existing values',{skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const {JSDOM}=await import('jsdom'),dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#group/5',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const group={id:5,owner_id:1,name:'Our group',city:'Austin',description:'Group details',image:'https://example.com/group.jpg',members:2,joined:true};
 const posts=[{id:8,user_id:1,group_id:5,name:'Self',body:'Original post',image:'https://example.com/photo.jpg',created_at:'2026-11-01T00:00:00Z',comment_count:1,like_count:2},{id:9,user_id:2,group_id:5,name:'Friend',body:'Another author',image:'',created_at:'2026-11-01T00:00:00Z',comment_count:0,like_count:0}];let groupSaved=false,postSaved=false;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.fetch=async(url,opts={})=>{let data;
 if(url==='/api/session')data={user:{id:1,name:'Self',admin:true,membership_status:'approved'},csrf:'test'};
 else if(url==='/api/unread')data={messages:0,notifications:0};
 else if(url==='/api/groups/5/requests')data=[];
 else if(url==='/api/groups')data=[group];
 else if(url==='/api/posts?group=5')data=posts;
 else if(url==='/api/groups/5'&&opts.method==='PATCH'){Object.assign(group,JSON.parse(opts.body));groupSaved=true;data={ok:true};}
 else if(url==='/api/posts/8'&&opts.method==='PATCH'){Object.assign(posts[0],JSON.parse(opts.body));postSaved=true;data={ok:true};}
 else assert.fail('Unexpected editing request '+url);
 return {ok:true,json:async()=>data};};
 const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await delay(10);}assert.fail('Editing UI did not settle.');};
 try{
 w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
 await wait(()=>w.document.querySelector('[data-action="edit-group"]'));
 assert.equal(w.document.querySelector('[data-action="edit-post"][data-id="9"]'),null);
 w.document.querySelector('[data-action="edit-group"]').click();let f=w.document.querySelector('form[data-form="edit-group"]');assert.equal(f.elements.name.value,'Our group');assert.equal(f.elements.description.value,'Group details');
 assert.equal(f.elements.visibility.value,'open');f.elements.visibility.value='closed';assert.equal(f.elements.image.value,'https://example.com/group.jpg');assert.ok(f.querySelector('[data-upload-field="image"]'));f.elements.image.value='https://example.com/new-group.jpg';f.elements.name.value='Our updated group';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>groupSaved&&w.document.querySelector('#main h1')?.textContent==='Our updated group');
 assert.equal(group.visibility,'closed');assert.equal(w.document.querySelector('.group-cover').getAttribute('src'),'https://example.com/new-group.jpg');
 w.document.querySelector('[data-action="edit-post"][data-id="8"]').click();f=w.document.querySelector('form[data-form="edit-post"]');assert.equal(f.elements.body.value,'Original post');assert.equal(f.elements.image.value,'https://example.com/photo.jpg');
 f.elements.body.value='Updated post';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>postSaved&&w.document.querySelector('.post-body')?.textContent==='Updated post');
 assert.equal(posts[0].group_id,5);assert.equal(posts[0].like_count,2);assert.equal(posts[0].comment_count,1);
 }finally{w.close();}
});