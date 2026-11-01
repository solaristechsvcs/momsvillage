(()=> {
 let dismissed=null,busy=false;
 try{dismissed=sessionStorage.getItem('mv-announcement-dismissed');}catch{}
 async function refresh(){
  if(busy||document.hidden)return;busy=true;
  try{
   const response=await fetch('/api/announcement',{cache:'no-store'});
   if(!response.ok)return;
   const {announcement:a}=await response.json();
   let root=document.getElementById('site-announcement');
   if(!a||typeof a.body!=='string'||!a.body||String(a.revision)===dismissed){root?.remove();return;}
   if(!root){root=document.createElement('aside');root.id='site-announcement';root.setAttribute('aria-label','Site announcement');document.body.prepend(root);}
   if(root.dataset.revision===String(a.revision))return;
   root.dataset.revision=String(a.revision);root.className='site-announcement '+(['info','important','maintenance'].includes(a.tone)?a.tone:'info');
   root.replaceChildren();const content=document.createElement('div');
   if(a.title){const title=document.createElement('strong');title.textContent=a.title;content.append(title);}
   const body=document.createElement('p');body.textContent=a.body;content.append(body);
   const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss announcement');
   close.addEventListener('click',()=>{dismissed=String(a.revision);try{sessionStorage.setItem('mv-announcement-dismissed',dismissed);}catch{}root.remove();});
   root.append(content,close);
  }catch{/* Keep the current banner during a connection interruption. */}
  finally{busy=false;}
 }
 window.refreshSiteAnnouncement=refresh;
 void refresh();setInterval(()=>void refresh(),30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
})();