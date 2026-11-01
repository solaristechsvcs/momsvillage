import bcrypt from 'bcryptjs';
export const authColumns=()=>"COALESCE((SELECT version FROM password_state WHERE user_id=u.id),0) AS auth_version,COALESCE((SELECT must_change FROM password_state WHERE user_id=u.id),FALSE) AS must_change_password,(SELECT expires_at FROM password_state WHERE user_id=u.id) AS password_expires_at";
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function updatePassword(db,{actorId,targetId,actorVersion,currentPassword,newPassword,reset=false}) {
 if(typeof newPassword!=='string'||newPassword.length<12||Buffer.byteLength(newPassword)>72) fail(400,'Use at least 12 characters and at most 72 UTF-8 bytes.');
 if(typeof currentPassword!=='string'||Buffer.byteLength(currentPassword)>200) fail(400,'Enter your current password.');
 if(reset&&actorId===targetId) fail(400,'Ask another administrator to reset your password.');
 const hash=await bcrypt.hash(newPassword,12),c=await db.getConnection();
 try {
  await c.beginTransaction();
  const [users]=await c.execute('SELECT u.id,u.password,u.is_admin,u.banned,m.status FROM users u LEFT JOIN membership_applications m ON m.user_id=u.id WHERE u.id IN (?,?) ORDER BY u.id FOR UPDATE',[actorId,targetId]);
  const actor=users.find(u=>u.id===actorId),target=users.find(u=>u.id===targetId);
  if(!actor||!target) fail(404,'Account not found.');
  for(const uid of [...new Set([actorId,targetId])].sort((a,b)=>a-b)) await c.execute('INSERT IGNORE INTO password_state(user_id) VALUES(?)',[uid]);
  const [states]=await c.execute('SELECT * FROM password_state WHERE user_id IN (?,?) ORDER BY user_id FOR UPDATE',[actorId,targetId]);
  const own=states.find(s=>s.user_id===actorId);
  if(own.version!==actorVersion) fail(401,'Please sign in again.');
  if(reset&&(!actor.is_admin||actor.banned||actor.status!=='approved'||own.must_change)) fail(403,'Administrator access required.');
  if(!reset&&(!own.must_change||!own.expires_at||new Date(own.expires_at)<=new Date())) fail(403,'Temporary password expired or unavailable. Contact an administrator.');
  if(!await bcrypt.compare(currentPassword,actor.password)) fail(403,'Your current password is incorrect.');
  if(await bcrypt.compare(newPassword,target.password)) fail(400,'Choose a different password.');
  await c.execute('UPDATE users SET password=? WHERE id=?',[hash,targetId]);
  await c.execute('UPDATE password_state SET version=version+1,must_change=?,expires_at=IF(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR),NULL) WHERE user_id=?',[reset,reset,targetId]);
  await c.execute('INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,?)',[actorId,targetId,reset?'password_reset':'password_changed']);
  const [[state]]=await c.execute('SELECT version FROM password_state WHERE user_id=?',[targetId]);
  await c.commit();return state.version;
 } catch(error){await c.rollback();throw error;}finally{c.release();}
}