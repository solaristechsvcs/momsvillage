import { Server } from 'socket.io';
import { timingSafeEqual } from 'node:crypto';
import { sameAuthVersion } from './passwords.js';

export function createLiveChat({server,sessionMiddleware,sessionStore,query,config}) {
  const origin=new URL(config.publicUrl ?? 'http://127.0.0.1:'+(config.port ?? 3014)).origin;
  const io=new Server(server,{transports:['websocket'],maxHttpBufferSize:8192,perMessageDeflate:false,
    allowRequest:(req,done)=>done(null,req.headers.origin===origin)});
  io.engine.use(sessionMiddleware);
  const all=()=>[...io.sockets.sockets.values()];
  async function authenticate(socket) {
    const session=await new Promise((resolve,reject)=>sessionStore.get(socket.request.sessionID,(e,s)=>e?reject(e):resolve(s)));
    if(!session?.userId) throw new Error('Sign in required.');
    const [u]=await query("SELECT u.id,u.banned,m.status,COALESCE(p.version,0) AS version,COALESCE(p.must_change,FALSE) AS must_change FROM users u JOIN membership_applications m ON m.user_id=u.id LEFT JOIN password_state p ON p.user_id=u.id WHERE u.id=?",[session.userId]);
    if(!u || u.banned || u.status!=='approved' || u.must_change || !sameAuthVersion(session.authVersion ?? 0,u.version)) throw new Error('Sign in required.');
    return u.id;
  }
  async function allowed(a,b) {
    if(!Number.isSafeInteger(b)||a===b||b<=0) return false;
    const [row]=await query("SELECT f.user_low FROM friendships f JOIN users u ON u.id=? JOIN membership_applications m ON m.user_id=u.id WHERE f.user_low=LEAST(?,?) AND f.user_high=GREATEST(?,?) AND f.status='accepted' AND u.banned=FALSE AND m.status='approved' AND NOT EXISTS(SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))",[b,a,b,a,b,a,b,b,a]);
    return !!row;
  }
  async function presence(socket,peer=socket.data.peer) {
    if(!peer || !await allowed(socket.data.userId,peer)) {socket.emit('chat:access',{allowed:false,peerId:peer});socket.data.peers=(socket.data.peers??[]).filter(id=>id!==peer);return;}
    const [pref]=await query('SELECT show_online FROM chat_preferences WHERE user_id=?',[peer]);
    let online=false;
    if(pref?.show_online) for(const other of all().filter(s=>s.data.userId===peer)) {
      try {await authenticate(other);online=true;break;}catch {other.disconnect(true);}
    }
    socket.emit('chat:presence',{peerId:peer,online});
  }
  io.use(async(socket,next)=>{
    try {
      const csrf=socket.handshake.auth?.csrf,expected=socket.request.session?.csrf;
      if(typeof csrf!=='string'||typeof expected!=='string'||!csrf.length||csrf.length>200) throw new Error();
      const a=Buffer.from(csrf),b=Buffer.from(expected);
      if(a.length!==b.length||!timingSafeEqual(a,b)) throw new Error();
      socket.data.userId=await authenticate(socket);
      if(all().filter(s=>s.data.userId===socket.data.userId).length>=6) throw new Error();
      next();
    }catch{next(new Error('Chat authentication failed. Sign in again.'));}
  });
  io.on('connection',socket=>{
    let windowStart=Date.now(),events=0;
    socket.use(async(packet,next)=>{
      if(Date.now()-windowStart>10000){windowStart=Date.now();events=0;}
      if(++events>30){socket.disconnect(true);return;}
      try {await authenticate(socket);next();}catch{socket.disconnect(true);}
    });
    socket.on('chat:watch',async(data,ack)=>{
      try {
        const peers=data?.peerIds ?? [data?.peerId];
        if(!Array.isArray(peers)||peers.length>4) throw new Error();
        socket.data.peers=[];
        let ok=true;
        for(const peer of [...new Set(peers)]){
          if(!await allowed(socket.data.userId,peer)){socket.emit('chat:access',{allowed:false,peerId:peer});ok=false;continue;}
          socket.data.peers.push(peer);
        }
        socket.data.peer=socket.data.peers[0]??null;
        for(const peer of socket.data.peers)await presence(socket,peer);
        if(typeof ack==='function')ack({ok});
      }catch{(typeof ack==='function' && ack({ok:false}));}
    });
    socket.on('chat:leave',()=>{socket.data.peer=null;socket.data.peers=[];});
    socket.on('chat:typing',async(data)=>{
      try {
        const peer=data?.peerId ?? socket.data.peer;
        if(!(socket.data.peers??[]).includes(peer)||typeof data?.active!=='boolean'||!await allowed(socket.data.userId,peer)) return;
        for(const other of all().filter(s=>s.data.userId===peer&&(s.data.peers??[]).includes(socket.data.userId))){
          try {await authenticate(other);other.emit('chat:typing',{peerId:socket.data.userId,active:data.active});}catch{other.disconnect(true);}
        }
      }catch{/* Ephemeral hints can be dropped. */}
    });
  });
  let checking=false;
  async function refresh(){
    if(checking)return;checking=true;
    try {for(const s of all()){try{await authenticate(s);for(const peer of [...(s.data.peers??[])])await presence(s,peer);}catch{s.disconnect(true);}}}
    finally{checking=false;}
  }
  const timer=setInterval(()=>void refresh(),5000);timer.unref();
  async function message(a,b){
    for(const s of all().filter(s=>s.data.userId===a||s.data.userId===b)){
      const peer=s.data.userId===a?b:a;
      try {await authenticate(s);if(await allowed(s.data.userId,peer))s.emit('chat:message',{peerId:peer});}catch{s.disconnect(true);}
    }
  }
  async function online(userId){
    const ids=new Set();
    for(const socket of all()){
      const peer=socket.data.userId;
      if(ids.has(peer)||!await allowed(userId,peer))continue;
      const [pref]=await query('SELECT show_online FROM chat_preferences WHERE user_id=?',[peer]);
      if(!pref?.show_online)continue;
      try{await authenticate(socket);ids.add(peer);}catch{socket.disconnect(true);}
    }
    return [...ids];
  }
  return {refresh,message,online,close:()=>{clearInterval(timer);io.close();}};
}
