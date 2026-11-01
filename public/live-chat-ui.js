let chatSocket=null,chatBusy=false,chatAgain=false,chatTypingTimer,chatLastTyping=0;
function chatStatus() {
  if(typeof dockConnection==='function')dockConnection();
  const el=document.querySelector('[data-chat-status]');
  if(el)el.textContent=chatSocket?.connected?'Live chat connected':'Reconnecting. Messages can still be sent; use Refresh to check for replies.';
}
function chatConnect() {
  if(typeof dockMount==='function')dockMount();
  if(!me || me.membership_status!=='approved' || me.must_change_password) {chatSocket?.disconnect();chatSocket=null;return;}
  if(typeof window.io!=='function'||chatSocket)return;
  chatSocket=window.io({transports:['websocket'],auth:callback=>callback({csrf}),reconnectionDelayMax:5000});
  chatSocket.on('connect',()=>{chatStatus();chatMount();void chatSync();if(typeof dockSync==='function')void dockSync();void refreshUnread();});
  chatSocket.on('disconnect',reason=>{chatStatus();document.querySelector('[data-chat-presence]')?.replaceChildren();if(reason==='io server disconnect') {chatSocket=null;void initialize();}});
  chatSocket.on('connect_error',()=>chatStatus());
  chatSocket.on('chat:message',data=>{if(typeof dockIncoming==='function')void dockIncoming(data);void refreshUnread();if(page==='messages'&&!location.hash.includes('/'))void load();else void chatSync();});
  chatSocket.on('chat:typing',data=>{
    if(typeof dockHint==='function')dockHint('typing',data);
    if(data.peerId!==socialThread?.peer.id||page!=='messages')return;
    const el=document.querySelector('[data-chat-typing]');if(!el)return;
    el.textContent=data.active?'Typing.':'';
    clearTimeout(chatTypingTimer);chatTypingTimer=setTimeout(()=>{el.textContent='';},3500);
  });
  chatSocket.on('chat:presence',data=>{
    if(typeof dockHint==='function')dockHint('presence',data);
    if(data.peerId!==socialThread?.peer.id)return;
    const el=document.querySelector('[data-chat-presence]');if(el)el.textContent=data.online?'Online':'';
  });
  chatSocket.on('chat:access',data=>{
    if(data.allowed!==false)return;
    if(typeof dockAccess==='function')dockAccess(data.peerId);
    if(data.peerId && data.peerId!==socialThread?.peer.id)return;
    const f=document.querySelector('form[data-form="message"]');
    if(f){for(const el of f.elements)el.disabled=true;f.querySelector('.form-error').textContent='Messaging is unavailable. You must be accepted friends and neither member can be blocked.';}
    document.querySelector('[data-chat-presence]')?.replaceChildren();
    document.querySelector('[data-chat-typing]')?.replaceChildren();
  });
}
function chatMount() {
  if(typeof dockMount==='function')dockMount();
  chatStatus();
  if(!chatSocket?.connected)return;
  const peer=page==='messages'&&location.hash.startsWith('#messages/')&&!location.hash.includes('?') ? socialThread?.peer.id : null;
  const peers=typeof dockChats!=='undefined' ? [...dockChats.entries()].filter(([,c])=>c.expanded).map(([id])=>id) : [];
  if(peer)peers.push(peer);
  if(peers.length)chatSocket.emit('chat:watch',{peerIds:[...new Set(peers)]});
  else chatSocket.emit('chat:leave');
}
async function chatSync() {
  if(chatBusy){chatAgain=true;return;}
  if(page!=='messages'||!location.hash.startsWith('#messages/')||location.hash.includes('?')||!socialThread)return;
  const peer=socialThread.peer.id,route=location.hash;
  chatBusy=true;
  try {
    let more=true;
    for(let n=0;more&&n<20;n++){
      const list=document.querySelector('.conversation');if(!list)break;
      const nodes=[...list.querySelectorAll('[data-message-id]')];
      const after=nodes.length?Math.max(...nodes.map(el=>Number(el.dataset.messageId))):null;
      const t=await api('/messages/'+peer+(after?'?after='+after:''));
      if(location.hash!==route||socialThread.peer.id!==peer)break;
      const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
      const ids=new Set(nodes.map(el=>Number(el.dataset.messageId)));
      for(const m of t.messages)if(!ids.has(m.id)){list.querySelector('[data-chat-empty]')?.remove();list.insertAdjacentHTML('beforeend',chatMessageMarkup(m,t.peer));ids.add(m.id);}
      if(nearBottom)list.scrollTop=list.scrollHeight;
      if(!t.can_send){const f=document.querySelector('form[data-form="message"]');if(f){for(const el of f.elements)el.disabled=true;f.querySelector('.form-error').textContent='Messaging is unavailable.';}}
      socialThread=t;
      more=!!after&&t.has_more&&t.messages.length>0;
      if(more&&n===19)chatAgain=true;
    }
    await refreshUnread();
  }catch{/* Preserve draft and retry after reconnect or Refresh. */}
  finally{chatBusy=false;if(chatAgain){chatAgain=false;setTimeout(()=>void chatSync(),100);}}
}
async function chatSend(f,data) {
  if(!f.dataset.nonce||f.dataset.sentBody!==data.body){f.dataset.nonce=crypto.randomUUID();f.dataset.sentBody=data.body;}
  await api('/messages/'+data.recipient_id,'POST',{body:data.body,nonce:f.dataset.nonce});
  if(f.elements.body.value===data.body)f.elements.body.value='';
  delete f.dataset.nonce;delete f.dataset.sentBody;
  if(chatSocket?.connected)chatSocket.emit('chat:typing',{peerId:Number(data.recipient_id),active:false});
  if(location.hash.includes('?'))location.hash='messages/'+data.recipient_id;else await chatSync();
  await refreshUnread();
}
document.addEventListener('input',event=>{
  if(!event.target.matches('form[data-form="message"] textarea')||!chatSocket?.connected)return;
  if(Date.now()-chatLastTyping>2000){chatSocket.emit('chat:typing',{peerId:socialThread?.peer.id,active:true});chatLastTyping=Date.now();}
});
document.addEventListener('change',async event=>{
  if(!event.target.matches('[data-chat-online]'))return;
  const input=event.target;input.disabled=true;
  try{await api('/chat/settings','PUT',{show_online:input.checked});}
  catch(error){input.checked=!input.checked;notice(error.message);}
  finally{input.disabled=false;}
});
window.addEventListener('online',()=>{chatSocket?.connect();void chatSync();});
window.addEventListener('pagehide',()=>chatSocket?.disconnect());
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void chatSync();void refreshUnread();}});

// Enter sends chat messages; Shift+Enter keeps normal textarea line breaks.
document.addEventListener('keydown',event=>{
 const input=event.target;
 if(!input.matches?.('form[data-form="message"] textarea,form[data-dock-form] textarea'))return;
 if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||event.keyCode===229)return;
 event.preventDefault();
 const form=input.closest('form'),submit=form.querySelector('button[type="submit"]');
 if(event.repeat||input.disabled||!input.value.trim()||!submit||submit.disabled)return;
 form.requestSubmit(submit);
});
