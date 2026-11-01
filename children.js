import {Router} from 'express';
import {id,text} from './validation.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function sharedChildren(query,owner,viewer){
 return query("SELECT c.name,c.age_value,c.age_unit,c.gender FROM profile_children c JOIN users u ON u.id=c.user_id JOIN membership_applications m ON m.user_id=u.id WHERE c.user_id=? AND c.shared=TRUE AND u.banned=FALSE AND m.status='approved' AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=?) OR (b.user_id=? AND b.blocked_id=?)) ORDER BY c.id",[owner,owner,viewer,viewer,owner]);
}
export function childInput(body){
 const name=body.name===null?null:text(body.name,80);
 const age=body.age_value,unit=body.age_unit,gender=body.gender;
 if(age===null){if(unit!==null)fail(400,'Choose Rather not say for age.');}
 else if(!Number.isInteger(age)||!['years','months'].includes(unit)||age<0||age>(unit==='months'?23:120))fail(400,'Enter an age of 0–120 years or 0–23 months.');
 if(!['boy','girl','undisclosed'].includes(gender))fail(400,'Choose boy, girl, or Rather not say.');
 if(typeof body.shared!=='boolean')fail(400,'Choose whether to share this entry.');
 return {name,age,unit,gender,shared:body.shared};
}
export function childrenRouter({db,query}){
 const router=Router();
 router.get('/profile/children',async(req,res)=>res.json(await query('SELECT id,name,age_value,age_unit,gender,shared FROM profile_children WHERE user_id=? ORDER BY id',[req.user.id])));
 async function transaction(userId,work){
  const c=await db.getConnection();const run=async(sql,args=[])=> (await c.execute(sql,args))[0];
  try{await c.beginTransaction();await run('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const result=await work(run);await c.commit();return result;}
  catch(error){await c.rollback();throw error;}finally{c.release();}
 }
 router.post('/profile/children',async(req,res)=>{
  const v=childInput(req.body);
  const child=await transaction(req.user.id,async run=>{
   const [count]=await run('SELECT COUNT(*) AS total FROM profile_children WHERE user_id=?',[req.user.id]);
   if(Number(count.total)>=20)fail(400,'You can add up to 20 children.');
   return run('INSERT INTO profile_children(user_id,name,age_value,age_unit,gender,shared) VALUES(?,?,?,?,?,?)',[req.user.id,v.name,v.age,v.unit,v.gender,v.shared]);
  });res.status(201).json({id:child.insertId});
 });
 router.patch('/profile/children/:id',async(req,res)=>{
  const childId=id(req.params.id),v=childInput(req.body);
  await transaction(req.user.id,async run=>{
   const [row]=await run('SELECT id FROM profile_children WHERE id=? AND user_id=? FOR UPDATE',[childId,req.user.id]);
   if(!row)fail(404,'Child entry not found.');
   await run('UPDATE profile_children SET name=?,age_value=?,age_unit=?,gender=?,shared=? WHERE id=? AND user_id=?',[v.name,v.age,v.unit,v.gender,v.shared,childId,req.user.id]);
  });res.json({ok:true});
 });
 router.delete('/profile/children/:id',async(req,res)=>{
  const result=await query('DELETE FROM profile_children WHERE id=? AND user_id=?',[id(req.params.id),req.user.id]);
  if(!result.affectedRows)fail(404,'Child entry not found.');res.json({ok:true});
 });
 return router;
}
