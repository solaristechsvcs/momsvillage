import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('children editor defaults private and compact badges show chosen age and colors',{skip:process.env.MV_UI!=='1',timeout:10000},async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.com/#profile',runScripts:'outside-only'}),w=dom.window;
 let rows=[],saved;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.fetch=async(url,opts={})=>{
 let data;
 if(url==='/api/session')data={user:{id:1,name:'Parent',membership_status:'approved'},csrf:'test'};
 else if(url==='/api/unread')data={messages:0,notifications:0};
 else if(url==='/api/profile/children'&&opts.method==='POST'){saved=JSON.parse(opts.body);rows=[{id:1,...saved}];data={id:1};}
 else if(url==='/api/profile/children')data=rows;
 else if(url==='/api/profile/children/1'&&opts.method==='DELETE'){rows=[];data={ok:true};}
 else assert.fail('Unexpected child request '+url);
 return {ok:true,json:async()=>data};
 };
 const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await delay(10);}assert.fail('Children UI did not settle.');};
 try{
 w.eval((await Promise.all(['verification-ui.js','membership-ui.js','social-ui.js','children-ui.js','app.js'].map(f=>readFile(new URL('../public/'+f,import.meta.url),'utf8')))).join('\n'));
 await wait(()=>w.document.querySelector('[data-child-action="add"]'));
 w.document.querySelector('[data-child-action="add"]').click();
 let f=w.document.querySelector('[data-children-form="save"]');assert.equal(f.elements.shared.checked,false);assert.equal(f.elements.child_name.disabled,true);assert.equal(f.elements.age_value.disabled,true);assert.equal(f.elements.gender.value,'undisclosed');assert.ok(f.querySelector('[data-child-preview] svg'));
 f.elements.name_mode.value='name';f.elements.name_mode.dispatchEvent(new w.Event('change',{bubbles:true}));f.elements.child_name.value='<script>Nickname</script>';
 f.elements.age_mode.value='months';f.elements.age_mode.dispatchEvent(new w.Event('change',{bubbles:true}));f.elements.age_value.value='23';f.elements.gender.value='girl';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>w.document.querySelector('[data-child-action="edit"]'));assert.equal(saved.shared,false);assert.equal(saved.age_value,23);assert.equal(w.document.querySelector('.children-section script'),null);
 const badges=w.eval('sharedChildrenSection([{name:"Nickname",age_value:23,age_unit:"months",gender:"girl"},{name:null,age_value:9,age_unit:"years",gender:"boy"},{name:null,age_value:null,age_unit:null,gender:"undisclosed"}])');
 const holder=w.document.createElement('div');holder.innerHTML=badges;assert.equal(holder.querySelector('.girl').textContent,'1y11m');assert.equal(holder.querySelector('.boy').textContent,'9y');assert.ok(holder.querySelector('.rainbow svg'));assert.ok(holder.querySelector('.rainbow').textContent.includes('Rather not say'));
 w.document.querySelector('[data-child-action="delete"]').click();f=w.document.querySelector('[data-children-form="delete"]');assert.equal(rows.length,1);f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.document.querySelector('.children-section').textContent.includes('No children added'));
 }finally{w.close();}
});