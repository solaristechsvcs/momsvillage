let ownChildren=[];
function childIcon(gender){
 if(gender==='undisclosed')return '<svg class="child-icon" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="#f6edff"/><path d="M10 48a22 22 0 0 1 44 0" fill="none" stroke="#eb6a80" stroke-width="7"/><path d="M17 48a15 15 0 0 1 30 0" fill="none" stroke="#f7bf62" stroke-width="7"/><path d="M24 48a8 8 0 0 1 16 0" fill="none" stroke="#80cbb1" stroke-width="7"/><circle cx="11" cy="50" r="8" fill="white"/><circle cx="53" cy="50" r="8" fill="white"/></svg>';
 const blue=gender==='boy',color=blue?'#488bc6':'#d9699d',bg=blue?'#e7f3ff':'#ffebf4';
 return `<svg class="child-icon" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="${bg}"/><circle cx="32" cy="24" r="12" fill="${color}"/><path d="M12 57c0-16 8-22 20-22s20 6 20 22" fill="${color}"/><circle cx="28" cy="24" r="1.5" fill="white"/><circle cx="36" cy="24" r="1.5" fill="white"/><path d="M28 29q4 4 8 0" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
}
function childAge(c){
 if(c.age_value===null||c.age_value===undefined)return 'Rather not say';
 if(c.age_unit==='years'&&c.age_value===0)return 'Under 1 year';
 return c.age_value+' '+(c.age_unit==='months'?(c.age_value===1?'month':'months'):(c.age_value===1?'year':'years'))+' old';
}
function childCards(rows,editable=false){
 return rows.map(c=>`<article class="child-card">${childIcon(c.gender)}<div><h3>${esc(c.name??'Rather not say')}</h3><p><strong>Age:</strong> ${esc(childAge(c))}</p><p><strong>Gender:</strong> ${esc(({boy:'Boy',girl:'Girl',undisclosed:'Rather not say'})[c.gender])}</p>${editable?`<small>${c.shared?'Shared with approved members':'Only you can see this entry'}</small><div class="buttons"><button type="button" class="secondary" data-child-action="edit" data-id="${c.id}">Edit</button><button type="button" class="subtle" data-child-action="delete" data-id="${c.id}">Remove</button></div>`:''}</div></article>`).join('');
}
async function childrenSection(){
 ownChildren=await api('/profile/children');
 return '<section class="card children-section"><div class="page-heading"><div><h2>Children</h2><p>Optional details about your family.</p></div><button type="button" data-child-action="add">Add child</button></div><p class="hint">Each entry is private by default. You can share an entry with approved members. First names or nicknames are enough; you can choose Rather not say for each field. Ages are entered manually.</p><div class="children-grid">'+(childCards(ownChildren,true)||'<p class="muted">No children added yet.</p>')+'</div></section>';
}
function childEditor(c={}){
 const nameKnown=c.name!==null&&c.name!==undefined,ageKnown=c.age_value!==null&&c.age_value!==undefined;
 const option=(value,label,selected)=>`<option value="${value}" ${selected?'selected':''}>${label}</option>`;
 modal(c.id?'Edit child':'Add child',`<form data-children-form="save"><input type="hidden" name="id" value="${c.id??''}"><label for="child-name-mode">Name</label><select name="name_mode" id="child-name-mode">${option('undisclosed','Rather not say',!nameKnown)}${option('name','Add a name or nickname',nameKnown)}</select>${field('child_name','Name or nickname',{value:c.name??'',max:80,required:false})}<label for="child-age-mode">Age</label><select name="age_mode" id="child-age-mode">${option('undisclosed','Rather not say',!ageKnown)}${option('years','Age in years',c.age_unit==='years')}${option('months','Age in months (under 2)',c.age_unit==='months')}</select><label for="child-age">Age value</label><input id="child-age" name="age_value" type="number" min="0" max="120" step="1" value="${c.age_value??''}"><label for="child-gender">Gender</label><select name="gender" id="child-gender">${option('undisclosed','Rather not say / rainbow',!c.gender||c.gender==='undisclosed')}${option('boy','Boy / blue',c.gender==='boy')}${option('girl','Girl / pink',c.gender==='girl')}</select><div data-child-preview>${childIcon(c.gender??'undisclosed')}</div><label class="check"><input type="checkbox" name="shared" ${c.shared?'checked':''}><span>Show this entry on my profile to approved members</span></label><p class="hint">Leaving sharing off keeps the entry private. You can edit or remove it later.</p><p class="form-error" role="alert"></p><button class="form-submit" type="submit">Save child</button></form>`);
 childFields(document.querySelector('[data-children-form="save"]'));
}
function childFields(f){
 f.elements.child_name.disabled=f.elements.name_mode.value==='undisclosed';
 f.elements.child_name.required=!f.elements.child_name.disabled;
 f.elements.age_value.disabled=f.elements.age_mode.value==='undisclosed';
 f.elements.age_value.required=!f.elements.age_value.disabled;
 f.elements.age_value.max=f.elements.age_mode.value==='months'?'23':'120';
 f.querySelector('[data-child-preview]').innerHTML=childIcon(f.elements.gender.value);
}
document.addEventListener('change',event=>{const f=event.target.closest('[data-children-form="save"]');if(f)childFields(f);});
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-child-action]');if(!b)return;
 const c=ownChildren.find(c=>c.id===Number(b.dataset.id));
 if(b.dataset.childAction==='add')childEditor();
 if(b.dataset.childAction==='edit'&&c)childEditor(c);
 if(b.dataset.childAction==='delete'&&c)modal('Remove child entry?',`<form data-children-form="delete"><input name="id" type="hidden" value="${c.id}"><p>This removes the entry for ${esc(c.name??'this child')} from your saved details and profile.</p><p class="form-error" role="alert"></p><button class="form-submit danger" type="submit">Remove entry</button></form>`);
});
document.addEventListener('submit',async event=>{
 const f=event.target.closest('[data-children-form]');if(!f)return;event.preventDefault();
 const submit=f.querySelector('[type="submit"]');submit.disabled=true;f.querySelector('.form-error').textContent='';
 try{
  const data=Object.fromEntries(new FormData(f));
  if(f.dataset.childrenForm==='delete')await api('/profile/children/'+data.id,'DELETE');
  else{
   const body={name:data.name_mode==='undisclosed'?null:data.child_name,age_value:data.age_mode==='undisclosed'?null:Number(data.age_value),age_unit:data.age_mode==='undisclosed'?null:data.age_mode,gender:data.gender,shared:data.shared==='on'};
   await api('/profile/children'+(data.id?'/'+data.id:''),data.id?'PATCH':'POST',body);
  }
  closeModal();notice('Children details updated.');await load();
 }catch(error){f.querySelector('.form-error').textContent=error.message;}
 finally{submit.disabled=false;}
});

function sharedChildrenSection(rows){
 if(!rows?.length)return '';
 return '<span class="children-badges" aria-label="Children">'+rows.map(c=>{
  let age='Rather not say';
  if(c.age_value!==null&&c.age_value!==undefined)age=c.age_unit==='months'?(c.age_value>=12?Math.floor(c.age_value/12)+'y'+(c.age_value%12?c.age_value%12+'m':''):c.age_value+'m'):c.age_value+'y';
  const detail=(c.name??'Name: Rather not say')+' · Age: '+childAge(c)+' · Gender: '+({boy:'Boy',girl:'Girl',undisclosed:'Rather not say'})[c.gender];
  return `<span class="child-age-badge ${c.gender==='boy'?'boy':c.gender==='girl'?'girl':'rainbow'}" title="${esc(detail)}" aria-label="${esc(detail)}">${c.gender==='undisclosed'?childIcon('undisclosed'):''}${esc(age)}</span>`;
 }).join('')+'</span>';
}

