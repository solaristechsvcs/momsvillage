import {Router} from 'express';
import {text,id} from './validation.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function announcementsRouter({db,query,requireAdmin}){
 const router=Router();
 router.get('/admin/announcement',requireAdmin,async(req,res)=>{
  const [row]=await query('SELECT title,body,tone,enabled,revision,updated_at FROM site_announcement WHERE id=1');res.json({...row,enabled:!!row.enabled});
 });
 async function save(req,remove=false){
  const revision=id(req.body.revision);
  const title=remove?'':text(req.body.title,100,false),body=remove?'':text(req.body.body,1000,false),tone=req.body.tone;
  if(!remove&&(!['info','important','maintenance'].includes(tone)||typeof req.body.enabled!=='boolean'))fail(400,'Choose an announcement style and visibility.');
  if(!remove&&req.body.enabled&&!body)fail(400,'Enter announcement text before publishing.');
  const c=await db.getConnection();
  try{
   await c.beginTransaction();
   const [[actor]]=await c.execute("SELECT u.is_admin,u.banned,m.status FROM users u JOIN membership_applications m ON m.user_id=u.id WHERE u.id=? FOR UPDATE",[req.user.id]);
   if(!actor?.is_admin||actor.banned||actor.status!=='approved')fail(403,'Administrator access required.');
   const [[current]]=await c.execute('SELECT revision,enabled FROM site_announcement WHERE id=1 FOR UPDATE');
   if(current.revision!==revision)fail(409,'Another administrator changed this announcement. Reload before saving.');
   if(remove)await c.execute('UPDATE site_announcement SET enabled=FALSE,revision=revision+1,updated_by=? WHERE id=1',[req.user.id]);
   else await c.execute('UPDATE site_announcement SET title=?,body=?,tone=?,enabled=?,revision=revision+1,updated_by=? WHERE id=1',[title,body,tone,req.body.enabled,req.user.id]);
   const action=remove?'announcement_remove':req.body.enabled?'announcement_publish':'announcement_draft';
   await c.execute('INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,?)',[req.user.id,req.user.id,action]);
   await c.commit();
  }catch(error){await c.rollback();throw error;}finally{c.release();}
 }
 router.put('/admin/announcement',requireAdmin,async(req,res)=>{await save(req);res.json({ok:true});});
 router.delete('/admin/announcement',requireAdmin,async(req,res)=>{await save(req,true);res.json({ok:true});});
 return router;
}
