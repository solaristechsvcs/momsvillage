const dockChats=new Map();
let dockListOpen=false,dockOwner=null,dockGeneration=0;
function dockAllowed(){return !!me&&me.membership_status==='approved'&&!me.must_change_password;}
function dockMount(){
 if(!dockAllowed()||dockOwner!==me?.id){document.getElementById('chat-dock')?.remove();dockChats.clear();dockListOpen=false;dockOwner=me?.id;dockGeneration++;}
 if(!dockAllowed()||document.getElementById('chat-dock'))return;
 const root=document.createElement('aside');root.id='chat-dock';root.setAttribute('aria-label','Quick messages');
 root.innerHTML=`<div class="dock-windows"></div><section class="dock-panel" hidden aria-label="Friends and conversations"><div class="dock-heading"><strong>Friends</strong><button type="button" data-dock-action="inbox-close" aria-label="Collapse friends list">−</button></div><div class="dock-inbox-body"></div></section><button type="button" class="dock-launcher" data-dock-action="inbox" aria-expanded="false">Chat <span data-dock-unread hidden></span></button>`;
 document.body.append(root);dockUnread();
}
function dockUnread(){
 const el=document.querySelector('[data-dock-unread]');if(el){el.hidden=!unread.messages;el.textContent=unread.messages?String(unread.messages):'';}
}
async function dockInbox(){
 dockMount();const panel=document.querySelector('.dock-panel');if(!panel)return;
 dockListOpen=true;panel.hidden=false;document.querySelector('.dock-launcher').setAttribute('aria-expanded','true');
 const gen=dockGeneration;document.querySelector('.dock-inbox-body').textContent='Loading friends…';
 try{
  const [threads,data,online]=await Promise.all([api('/messages'),api('/friends'),api('/chat/online')]);
  if(gen!==dockGeneration||!dockAllowed())return;
  const recent=new Map(threads.map(t=>[t.peer_id,t]));
  const ids=new Set(online.user_ids),friends=data.friends.filter(f=>f.status==='accepted');
  friends.sort((a,b)=>Number(ids.has(b.id))-Number(ids.has(a.id))||(recent.get(b.id)?.id??0)-(recent.get(a.id)?.id??0));
  document.querySelector('.dock-inbox-body').innerHTML=`<p class="hint">${ids.size} friends online. Online status is shared only by friends who opt in.</p>`+
   (friends.map(f=>`<button type="button" class="dock-contact" data-dock-action="open" data-id="${f.id}">${avatar(f)}<span><strong>${esc(f.name)}</strong><small data-dock-online="${f.id}">${ids.has(f.id)?'● Online':esc(recent.get(f.id)?.body?.slice(0,60)??'Start a conversation')}</small></span>${recent.get(f.id)?.unread?`<span class="badge">${recent.get(f.id).unread}</span>`:''}</button>`).join('')||'<p>Add an accepted friend to start chatting.</p>')+'<a href="#messages">Messages and online-status settings</a>';
 }catch(error){if(gen===dockGeneration)document.querySelector('.dock-inbox-body').textContent=error.message;}
}
function dockConnection(){for(const c of dockChats.values())c.root.querySelector('.dock-connection').textContent=chatSocket?.connected?'Live chat connected':'Reconnecting… Your draft is kept.';}
function dockAccess(peerId){
 const c=dockChats.get(peerId);if(!c)return;c.thread.can_send=false;
 const f=c.root.querySelector('form');for(const el of f.elements)el.disabled=true;
 f.querySelector('.form-error').textContent='Messaging is unavailable. You must be accepted friends and neither member can be blocked.';
 c.root.querySelector('.dock-presence').textContent='';c.root.querySelector('.dock-typing').textContent='';
}
function dockHint(kind,data){
 const c=dockChats.get(data.peerId);if(!c)return;
 const el=c.root.querySelector(kind==='typing'?'.dock-typing':'.dock-presence');
 el.textContent=kind==='typing'?(data.active?'Typing…':''):(data.online?'Online':'');
 if(kind==='typing'){clearTimeout(c.typingTimer);c.typingTimer=setTimeout(()=>{el.textContent='';},3500);}
}
async function dockOpen(id){
 dockMount();const gen=dockGeneration;
 if(dockChats.has(id)){const c=dockChats.get(id);c.expanded=true;c.root.classList.remove('minimized');c.root.querySelector('.dock-title').setAttribute('aria-expanded','true');c.root.querySelector('.dock-new').hidden=true;dockMobileFocus(c);chatMount();await dockSync(id);return;}
 if(dockChats.size>=3){notice('Close a chat window before opening another. Up to three conversations can stay open.');return;}
 try{
  const t=await api('/messages/'+id);
  if(gen!==dockGeneration||!dockAllowed()||dockChats.has(id))return;
  if(dockChats.size>=3)return;
  const root=document.createElement('section');root.className='dock-window';root.dataset.dockPeer=String(id);root.setAttribute('aria-label','Chat with '+t.peer.name);
  root.innerHTML=`<div class="dock-heading"><button type="button" class="dock-title" data-dock-action="expand" aria-expanded="true">${esc(t.peer.name)} <span class="dock-new" hidden>● New</span></button><button type="button" data-dock-action="minimize" aria-label="Minimize chat with ${esc(t.peer.name)}">−</button><button type="button" data-dock-action="close" aria-label="Close chat with ${esc(t.peer.name)}">×</button></div><div class="dock-window-body"><p class="dock-connection"></p><p class="dock-presence"></p><div class="dock-messages" role="log" aria-live="polite" aria-label="Conversation messages">${t.messages.map(m=>chatMessageMarkup(m,t.peer)).join('')||'<p data-chat-empty>Say hello.</p>'}</div><p class="dock-typing" role="status"></p><form data-dock-form><label for="dock-message-${id}">Your message</label><textarea id="dock-message-${id}" name="body" rows="2" maxlength="4000" required></textarea><p class="form-error" role="alert"></p><button type="submit">Send</button></form><div class="dock-controls"><button type="button" data-dock-action="history">History</button><button type="button" data-dock-action="block">Block</button></div></div>`;
  dockChats.set(id,{root,thread:t,expanded:true,busy:false,again:false});
  document.querySelector('.dock-windows').append(root);dockMobileFocus(dockChats.get(id));dockConnection();
  if(!t.can_send)dockAccess(id);
  const list=root.querySelector('.dock-messages');list.scrollTop=list.scrollHeight;
  chatMount();await refreshUnread();root.querySelector('textarea').focus();
 }catch(error){notice(error.message);}
}
async function dockSync(id){
 if(!dockAllowed()||document.hidden)return;
 if(id===undefined){await Promise.all([...dockChats.keys()].map(peer=>dockSync(peer)));return;}
 const c=dockChats.get(id);if(!c||!c.expanded)return;
 if(c.busy){c.again=true;return;}c.busy=true;
 try{
  for(let n=0;n<20;n++){
   const after=c.thread.messages.at(-1)?.id,t=await api('/messages/'+id+(after?'?after='+after:''));
   if(dockChats.get(id)!==c||!c.expanded)return;
   const list=c.root.querySelector('.dock-messages'),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80,ids=new Set(c.thread.messages.map(m=>m.id));
   for(const m of t.messages)if(!ids.has(m.id)){c.thread.messages.push(m);ids.add(m.id);list.querySelector('[data-chat-empty]')?.remove();list.insertAdjacentHTML('beforeend',chatMessageMarkup(m,t.peer));}
   c.thread.can_send=t.can_send;if(!t.can_send)dockAccess(id);
   if(bottom)list.scrollTop=list.scrollHeight;
   c.root.querySelector('.dock-new').hidden=true;
   if(!after||!t.has_more||!t.messages.length)break;
   if(n===19)c.again=true;
  }
  await refreshUnread();
 }catch{/* Preserve the current draft. */}
 finally{c.busy=false;if(c.again){c.again=false;setTimeout(()=>void dockSync(id),100);}}
}
async function dockIncoming(data){
 if(!dockAllowed())return;
 if(!dockChats.has(data.peerId)&&!document.hidden)await dockOpen(data.peerId);
 const c=dockChats.get(data.peerId);if(c){if(c.expanded&&!document.hidden)await dockSync(data.peerId);else c.root.querySelector('.dock-new').hidden=false;}
 if(dockListOpen)void dockInbox();
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-dock-action]');if(!b)return;
 const action=b.dataset.dockAction,id=Number(b.closest('[data-dock-peer]')?.dataset.dockPeer),c=dockChats.get(id);
 if(action==='inbox'){if(dockListOpen){document.querySelector('[data-dock-action="inbox-close"]').click();}else await dockInbox();}
 if(action==='inbox-close'){dockListOpen=false;document.querySelector('.dock-panel').hidden=true;document.querySelector('.dock-launcher').setAttribute('aria-expanded','false');}
 if(action==='open')await dockOpen(Number(b.dataset.id));
 if(c&&(action==='minimize'||action==='expand')){
  c.expanded=action==='expand'?!c.expanded:false;c.root.classList.toggle('minimized',!c.expanded);c.root.querySelector('.dock-title').setAttribute('aria-expanded',String(c.expanded));
  dockMobileFocus(c);chatMount();if(c.expanded)await dockSync(id);
 }
 if(c&&action==='close'){clearTimeout(c.typingTimer);c.root.remove();dockChats.delete(id);chatMount();}
 if(c&&action==='history'){location.hash='messages/'+id;}
 if(c&&action==='block')modal('Block this member?',`<p>This removes your friendship and stops messaging.</p><button data-action="confirm-block" data-id="${id}">Block member</button>`);
});
document.addEventListener('click',event=>{
 if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 const a=event.target.closest('a[href^="#messages/"]');if(!a||a.closest('#chat-dock')||!dockAllowed())return;
 const m=/^#messages\/(\d+)$/.exec(a.getAttribute('href'));if(!m)return;
 event.preventDefault();event.stopImmediatePropagation();void dockOpen(Number(m[1]));
},true);
document.addEventListener('input',event=>{
 const f=event.target.closest('[data-dock-form]');if(!f||!chatSocket?.connected)return;
 const id=Number(f.closest('[data-dock-peer]').dataset.dockPeer),c=dockChats.get(id);
 if(c&&Date.now()-(c.lastTyping??0)>2000){c.lastTyping=Date.now();chatSocket.emit('chat:typing',{peerId:id,active:true});}
});
document.addEventListener('submit',async event=>{
 const f=event.target.closest('[data-dock-form]');if(!f)return;event.preventDefault();
 const id=Number(f.closest('[data-dock-peer]').dataset.dockPeer),c=dockChats.get(id);if(!c)return;
 const body=f.elements.body.value,submit=f.querySelector('[type="submit"]');submit.disabled=true;f.querySelector('.form-error').textContent='';
 try{
  if(!f.dataset.nonce||f.dataset.sentBody!==body){f.dataset.nonce=crypto.randomUUID();f.dataset.sentBody=body;}
  await api('/messages/'+id,'POST',{body,nonce:f.dataset.nonce});
  if(dockChats.get(id)!==c)return;
  if(f.elements.body.value===body)f.elements.body.value='';delete f.dataset.nonce;delete f.dataset.sentBody;
  if(chatSocket?.connected)chatSocket.emit('chat:typing',{peerId:id,active:false});
  await dockSync(id);await chatSync();
 }catch(error){if(dockChats.get(id)===c)f.querySelector('.form-error').textContent=error.message;}
 finally{if(dockChats.get(id)===c)submit.disabled=!c.thread.can_send;}
});
setInterval(()=>{if(dockListOpen&&!document.hidden)void dockInbox();},15000);
window.addEventListener('online',()=>void dockSync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void dockSync();});

function dockMobileFocus(selected){
 if(!window.matchMedia?.('(max-width:700px)').matches||!selected?.expanded)return;
 for(const c of dockChats.values())if(c!==selected&&c.expanded){c.expanded=false;c.root.classList.add('minimized');c.root.querySelector('.dock-title').setAttribute('aria-expanded','false');}
}
function dockViewport(){
 const viewport=window.visualViewport;
 document.documentElement.style.setProperty('--mobile-height',(viewport?.height??window.innerHeight)+'px');
 document.documentElement.style.setProperty('--keyboard-inset',Math.max(0,window.innerHeight-(viewport?.height??window.innerHeight)-(viewport?.offsetTop??0))+'px');
 const expanded=[...dockChats.values()].filter(c=>c.expanded);if(expanded.length>1){dockMobileFocus(expanded.at(-1));chatMount();}
}
window.visualViewport?.addEventListener('resize',dockViewport);
window.visualViewport?.addEventListener('scroll',dockViewport);
window.addEventListener('resize',dockViewport);
dockViewport();
