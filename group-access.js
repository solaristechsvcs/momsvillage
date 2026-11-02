import {Router} from 'express';
import {id} from './validation.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const groupVisibility=value=>{
 if(!['open','closed'].includes(value))fail(400,'Choose an Open or Closed group.');
 return value;
};
export const postAccessSql=(alias='p')=>`(${alias}.group_id IS NULL OR EXISTS(SELECT 1 FROM community_groups visible_group WHERE visible_group.id=${alias}.group_id AND (visible_group.visibility='open' OR EXISTS(SELECT 1 FROM memberships visible_member WHERE visible_member.group_id=visible_group.id AND visible_member.user_id=?))))`;
export async function requireGroupRead(query,groupId,userId){
 if(!groupId)return;
 const [row]=await query("SELECT g.visibility,EXISTS(SELECT 1 FROM memberships WHERE group_id=g.id AND user_id=?) AS joined FROM community_groups g WHERE g.id=?",[userId,groupId]);
 if(!row)fail(404,'Group not found.');
 if(row.visibility==='closed'&&!row.joined)fail(403,'Join this closed group to view its posts.');
}
export async function initializeGroupAccess(db,database){
 const c=await db.getConnection(),lock=('mv-group-access-'+database).slice(0,64);let acquired=false;
 try{
  const [[r]]=await c.execute('SELECT GET_LOCK(?,10) AS acquired',[lock]);acquired=Number(r.acquired)===1;if(!acquired)throw new Error('Group access migration is busy.');
  const [columns]=await c.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_groups' AND COLUMN_NAME='visibility'");
  if(!columns.length)await c.query("ALTER TABLE community_groups ADD COLUMN visibility ENUM('open','closed') NOT NULL DEFAULT 'open'");
  await c.query("CREATE TABLE IF NOT EXISTS group_join_requests(group_id INT UNSIGNED NOT NULL,user_id INT UNSIGNED NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(group_id,user_id),FOREIGN KEY(group_id) REFERENCES community_groups(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");
 }finally{try{if(acquired)await c.execute('SELECT RELEASE_LOCK(?)',[lock]);}finally{c.release();}}
}
export function groupAccessRouter({db,query}){
 const router=Router();
 async function transaction(groupId,work){
  const c=await db.getConnection(),run=async(sql,args=[])=> (await c.execute(sql,args))[0];
  try{await c.beginTransaction();const [g]=await run('SELECT * FROM community_groups WHERE id=? FOR UPDATE',[groupId]);if(!g)fail(404,'Group not found.');const result=await work(run,g);await c.commit();return result;}
  catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 router.post('/groups/:id/join',async(req,res)=>{
  if(typeof req.body.active!=='boolean')fail(400,'Choose whether to join or leave.');
  const result=await transaction(id(req.params.id),async(run,g)=>{
   if(!req.body.active){
    if(g.owner_id===req.user.id)fail(400,'Group owners must keep their membership.');
    await run('DELETE FROM memberships WHERE group_id=? AND user_id=?',[g.id,req.user.id]);
    await run('DELETE FROM group_join_requests WHERE group_id=? AND user_id=?',[g.id,req.user.id]);return {ok:true,status:'left'};
   }
   const [member]=await run('SELECT 1 FROM memberships WHERE group_id=? AND user_id=?',[g.id,req.user.id]);
   if(member)return {ok:true,status:'joined'};
   if(g.visibility==='closed'){await run('INSERT IGNORE INTO group_join_requests(group_id,user_id) VALUES(?,?)',[g.id,req.user.id]);return {ok:true,status:'pending'};}
   await run('INSERT IGNORE INTO memberships(group_id,user_id) VALUES(?,?)',[g.id,req.user.id]);
   await run('DELETE FROM group_join_requests WHERE group_id=? AND user_id=?',[g.id,req.user.id]);return {ok:true,status:'joined'};
  });res.json(result);
 });
 router.get('/groups/:id/requests',async(req,res)=>{
  const [g]=await query('SELECT owner_id FROM community_groups WHERE id=?',[id(req.params.id)]);
  if(!g)fail(404,'Group not found.');if(g.owner_id!==req.user.id)fail(403,'Group owner access required.');
  res.json(await query("SELECT r.user_id,r.created_at,u.name,u.avatar,u.city FROM group_join_requests r JOIN users u ON u.id=r.user_id JOIN membership_applications m ON m.user_id=u.id WHERE r.group_id=? AND u.banned=FALSE AND m.status='approved' ORDER BY r.created_at,r.user_id LIMIT 200",[id(req.params.id)]));
 });
 router.post('/groups/:id/requests/:userId',async(req,res)=>{
  if(!['approve','reject'].includes(req.body.action))fail(400,'Choose approve or reject.');
  await transaction(id(req.params.id),async(run,g)=>{
   if(g.owner_id!==req.user.id)fail(403,'Group owner access required.');
   const target=id(req.params.userId);
   const [request]=await run('SELECT 1 FROM group_join_requests WHERE group_id=? AND user_id=? FOR UPDATE',[g.id,target]);if(!request)fail(404,'Join request not found.');
   if(req.body.action==='approve'){
    const [user]=await run("SELECT u.banned,m.status FROM users u JOIN membership_applications m ON m.user_id=u.id WHERE u.id=?",[target]);
    if(!user||user.banned||user.status!=='approved')fail(400,'Only approved, active members can join.');
    await run('INSERT IGNORE INTO memberships(group_id,user_id) VALUES(?,?)',[g.id,target]);
   }
   await run('DELETE FROM group_join_requests WHERE group_id=? AND user_id=?',[g.id,target]);
  });res.json({ok:true});
 });
 return router;
}

export async function canReadGroupImage(query,url,userId,isAdmin){
 const [access]=await query(`SELECT EXISTS(SELECT 1 FROM posts p JOIN community_groups g ON g.id=p.group_id WHERE p.image=? AND g.visibility='closed') AS private_used,
 (EXISTS(SELECT 1 FROM users WHERE avatar=?) OR EXISTS(SELECT 1 FROM listings WHERE image=?) OR EXISTS(SELECT 1 FROM community_groups WHERE image=?) OR EXISTS(SELECT 1 FROM posts p WHERE p.image=? AND ${postAccessSql('p')})) AS accessible,
 EXISTS(SELECT 1 FROM reports r JOIN posts p ON p.id=r.target_id WHERE r.target_type='post' AND p.image=?) AS reported`,[url,url,url,url,url,userId,url]);
 return !access.private_used||!!access.accessible||(isAdmin&&!!access.reported);
}

