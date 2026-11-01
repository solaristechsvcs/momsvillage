async function announcementAdminPage(){
 const a=await api('/admin/announcement');
 return heading('Sitewide announcement','Publish a public banner across the site, including sign-in and verification pages.')+`<section class="card"><p class="hint">Only one banner is shown at a time. Do not include private member information. Updates appear on open pages within 30 seconds.</p><form data-announcement-form="save"><input type="hidden" name="revision" value="${a.revision}">${field('title','Heading (optional)',{max:100,required:false,value:a.title})}${field('body','Announcement text',{type:'textarea',max:1000,required:false,value:a.body})}<label for="announcement-tone">Banner style</label><select id="announcement-tone" name="tone">${['info','important','maintenance'].map(t=>`<option value="${t}" ${a.tone===t?'selected':''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select><label class="check"><input type="checkbox" name="enabled" ${a.enabled?'checked':''}><span>Publish this banner for everyone</span></label><p class="form-error" role="alert"></p><button type="submit" class="form-submit">Save announcement</button></form>${a.enabled?`<button type="button" class="danger" data-announcement-remove data-revision="${a.revision}">Remove published banner</button>`:'<p class="hint">No banner is currently published.</p>'}</section>`;
}
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-announcement-remove]');if(!b)return;
 modal('Remove sitewide banner?',`<form data-announcement-form="remove"><input type="hidden" name="revision" value="${b.dataset.revision}"><p>The banner will be removed for everyone. Its text remains available as a draft.</p><p class="form-error" role="alert"></p><button type="submit" class="form-submit danger">Remove banner</button></form>`);
});
document.addEventListener('submit',async event=>{
 const f=event.target.closest('[data-announcement-form]');if(!f)return;event.preventDefault();
 const submit=f.querySelector('[type="submit"]');submit.disabled=true;f.querySelector('.form-error').textContent='';
 try{
  const data=Object.fromEntries(new FormData(f));
  await api('/admin/announcement',f.dataset.announcementForm==='remove'?'DELETE':'PUT',{revision:Number(data.revision),title:data.title,body:data.body,tone:data.tone,enabled:data.enabled==='on'});
  closeModal();notice('Announcement updated.');await load();
  if(typeof refreshSiteAnnouncement==='function')await refreshSiteAnnouncement();
 }catch(error){f.querySelector('.form-error').textContent=error.message;}
 finally{submit.disabled=false;}
});
