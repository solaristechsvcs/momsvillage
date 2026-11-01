import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
test('responsive pages, mobile menu, dialogs and chat fit real browser viewports',{skip:process.env.MV_BROWSER!=='1',timeout:60000},async()=>{
 const {chromium}=await import('playwright'),express=(await import('express')).default;
 const app=express();app.get('/socket.io/socket.io.js',(req,res)=>res.type('js').send(''));app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let signedIn=false;
 const user={id:1,name:'Village Owner',email:'owner@example.com',city:'Austin',membership_status:'approved',admin:true};
 const peer={id:2,name:'Friend With A Very Long Display Name',email:'friend@example.com',status:'accepted',membership_status:'approved'},other={id:3,name:'Another Friend',status:'accepted'};
 await page.addInitScript(()=>{const socket={connected:true,on:()=>socket,emit:()=>{},connect:()=>{},disconnect:()=>{}};window.io=()=>socket;});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice(4);let data;
  if(path==='/session')data={user:signedIn?user:null,csrf:'test'};
  else if(path==='/unread')data={messages:1,notifications:0};
  else if(path==='/posts'||path==='/messages'||path==='/groups')data=[];
  else if(path==='/profile/children')data=[];
  else if(path==='/friends')data={friends:[peer,other],blocks:[]};
  else if(path==='/chat/online')data={user_ids:[2]};
  else if(path==='/admin')data={users:[{...peer,is_admin:false,city:'Longcity'.repeat(20)}],reports:[]};
  else if(path==='/admin/users/2/profile')data=peer;
  else if(path.startsWith('/messages/'))data={peer:path.endsWith('/3')?other:peer,can_send:true,messages:[],has_more:false};
  else data={ok:true};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const url='http://127.0.0.1:'+server.address().port;
 async function fits(label){const dims=await page.evaluate(()=>({width:innerWidth,body:document.documentElement.scrollWidth}));assert.ok(dims.body<=dims.width+1,label+': '+JSON.stringify(dims));}
 try{
  for(const width of [320,375,390,768,1280]){
   await page.setViewportSize({width,height:844});signedIn=false;await page.goto(url);await page.locator('.landing-top').waitFor();await fits('Landing '+width);
   signedIn=true;await page.goto(url+'/?member=1#feed');await page.locator('.composer').waitFor();await fits('Feed '+width);
   if(width<=700){const menu=page.locator('.mobile-nav-toggle');assert.equal(await menu.isVisible(),true);await menu.click();await page.locator('.sidebar a[href="#admin"]').click();}
   else await page.locator('.sidebar a[href="#admin"]').click();
   await page.locator('[data-action="password-reset"]').waitFor();await fits('Administration '+width);
   await page.locator('[data-action="password-reset"]').click();await page.locator('dialog[open]').waitFor();const box=await page.locator('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
   if(width<=700)assert.equal(await page.locator('input[name="temporary_password"]').evaluate(el=>getComputedStyle(el).fontSize),'16px');
   await page.locator('[data-action="close"]').click();
  }
  await page.setViewportSize({width:390,height:844});await page.goto(url+'/#feed');await page.locator('.dock-launcher').click();await page.locator('[data-dock-action="open"][data-id="2"]').click();
  const first=page.locator('[data-dock-peer="2"]');await first.locator('textarea').fill('A draft that stays');
  await page.locator('.dock-launcher').click();await page.locator('[data-dock-action="open"][data-id="3"]').click();await page.locator('[data-dock-peer="3"]').waitFor();assert.ok((await first.getAttribute('class')).includes('minimized'));
  assert.equal(await first.locator('textarea').inputValue(),'A draft that stays');
  await fits('Mobile chat');
  const win=await page.locator('[data-dock-peer="3"]').boundingBox();assert.ok(win.x>=0&&win.x+win.width<=391);
  await page.setViewportSize({width:390,height:500});await fits('Short viewport');
  await page.evaluate(()=>{location.hash='profile';});await page.locator('[data-child-action="add"]').click();await page.locator('[data-children-form="save"]').waitFor();await fits('Children editor');const childDialog=await page.locator('dialog').boundingBox();assert.ok(childDialog.x>=0&&childDialog.x+childDialog.width<=391);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});