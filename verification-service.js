import { randomUUID } from 'node:crypto';
import { sealEvidence,openEvidence,cleanImage } from './verification-utils.js';

const failure=(status,message)=>{throw Object.assign(new Error(message),{status});};
export class VerificationService {
  constructor(db,settings,provider) { this.db=db;this.settings=settings;this.provider=provider; }
  async query(sql,args=[]) { return (await this.db.execute(sql,args))[0]; }
  async purge() {
    await this.query("UPDATE verification_attempts SET status=IF(status='pending_review','expired',status),evidence=NULL,image_count=0,revision=revision+1 WHERE evidence_expires_at<=UTC_TIMESTAMP() AND evidence IS NOT NULL");
    await this.query("UPDATE verification_attempts SET status='expired',revision=revision+1 WHERE status='in_progress' AND session_expires_at<=UTC_TIMESTAMP()");
  }
  async tx(userId,work,{actorId=null,approved=true}={}) {
    const connection=await this.db.getConnection();
    const execute=async(sql,args=[]) => (await connection.execute(sql,args))[0];
    try {
      await connection.beginTransaction();
      const ids=[...new Set([userId,...(actorId?[actorId]:[])])].sort((a,b)=>a-b);
      const users=await execute('SELECT u.id,u.banned,u.is_admin,m.status AS membership_status FROM users u JOIN membership_applications m ON m.user_id=u.id WHERE u.id IN ('+ids.map(()=>'?').join(',')+') ORDER BY u.id FOR UPDATE',ids);
      const user=users.find(u=>u.id===userId),actor=users.find(u=>u.id===actorId);
      if(!user) failure(404,'Member not found.');
      if(actorId && (!actor?.is_admin || actor.banned || actor.membership_status!=='approved')) failure(403,'Administrator access required.');
      if(approved && (user.banned || user.membership_status!=='approved')) failure(403,'Approved membership is required.');
      await execute('INSERT IGNORE INTO member_verifications(user_id) VALUES(?)',[userId]);
      const [record]=await execute('SELECT * FROM member_verifications WHERE user_id=? FOR UPDATE',[userId]);
      const result=await work(execute,record,user);
      await connection.commit();return result;
    } catch(error) {await connection.rollback();throw error;}
    finally {connection.release();}
  }
  async status(userId) {
    await this.purge();
    const [row]=await this.query('SELECT v.verified,v.verified_at,v.method,a.id,a.status,a.review_message,a.session_expires_at FROM member_verifications v LEFT JOIN verification_attempts a ON a.id=v.current_attempt_id WHERE v.user_id=?',[userId]);
    return {enabled:this.settings.ready,configured:this.settings.ready,optional:true,verified:!!row?.verified,status:row?.verified?'verified':row?.status === 'verified' ? 'revoked' : row?.status ?? 'not_started',attempt_id:row?.id ?? null,verified_at:row?.verified_at ?? null,method:row?.method ?? null,review_message:row?.review_message ?? '',retention_hours:this.settings.retentionHours};
  }
  async start(userId,consent) {
    if(consent!==true) failure(400,'Consent is required before starting the camera check.');
    if(!this.settings.ready || !this.provider) failure(503,'Optional verification is not available yet.');
    await this.purge();
    return this.tx(userId,async(execute,record)=>{
      if(record.verified) failure(409,'You are already verified.');
      if(record.current_attempt_id) {
        const [active]=await execute('SELECT status FROM verification_attempts WHERE id=? FOR UPDATE',[record.current_attempt_id]);
        if(active && ['in_progress','pending_review'].includes(active.status)) failure(409,'Finish or cancel your current verification attempt first.');
      }
      const [counts]=await execute('SELECT COUNT(*) AS total FROM verification_attempts WHERE user_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)',[userId]);
      if(Number(counts.total)>=3) failure(429,'You can start up to three verification attempts per day.');
      const id=randomUUID();
      await execute("INSERT INTO verification_attempts(id,user_id,status,session_expires_at,consent_version,consent_at) VALUES(?,?,'in_progress',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 MINUTE),'liveness-v1',UTC_TIMESTAMP())",[id,userId]);
      await execute('UPDATE member_verifications SET current_attempt_id=? WHERE user_id=?',[id,userId]);
      try {
        const sessionId=await this.provider.create(id);
        await execute('UPDATE verification_attempts SET provider_session_id=? WHERE id=?',[sessionId,id]);
        return {id};
      } catch {
        await execute("UPDATE verification_attempts SET status='error',review_message='The verification provider is unavailable. Please try again later.' WHERE id=?",[id]);
        return {unavailable:true};
      }
    });
  }
  async attempt(userId,id) {
    await this.purge();
    const [a]=await this.query('SELECT a.id,a.status,a.provider_session_id,a.session_expires_at FROM verification_attempts a JOIN member_verifications v ON v.current_attempt_id=a.id WHERE a.id=? AND a.user_id=?',[id,userId]);
    if(!a) failure(404,'Verification attempt not found.');
    if(a.status!=='in_progress' || !this.settings.ready) failure(409,'This camera session is no longer available. Check your verification status.');
    return {id:a.id,sessionId:a.provider_session_id,region:this.settings.region,expiresAt:a.session_expires_at};
  }
  async credentials(userId,id) {
    if(!this.settings.ready || !this.provider) failure(503,'Verification is unavailable.');
    await this.purge();
    return this.tx(userId,async(execute,record)=>{
      const [a]=await execute('SELECT * FROM verification_attempts WHERE id=? AND user_id=? FOR UPDATE',[id,userId]);
      if(!a || record.current_attempt_id!==id) failure(404,'Verification attempt not found.');
      if(a.status!=='in_progress' || new Date(a.session_expires_at)<=new Date()) failure(409,'This session has expired.');
      if(a.credentials_issued>=2) failure(429,'Start a new camera attempt to retry.');
      let credentials;
      try {credentials=await this.provider.credentials(id);} catch {failure(503,'Camera authorization is unavailable. Please try again later.');}
      await execute('UPDATE verification_attempts SET credentials_issued=credentials_issued+1 WHERE id=?',[id]);
      return credentials;
    });
  }
  async complete(userId,id) {
    if(!this.settings.ready || !this.provider) failure(503,'Verification is unavailable.');
    await this.purge();
    return this.tx(userId,async(execute,record)=>{
      const [a]=await execute('SELECT * FROM verification_attempts WHERE id=? AND user_id=? FOR UPDATE',[id,userId]);
      if(!a || record.current_attempt_id!==id) failure(404,'Verification attempt not found.');
      if(a.status!=='in_progress') return {status:a.status};
      if(new Date(a.session_expires_at)<=new Date()) {
        await execute("UPDATE verification_attempts SET status='expired',revision=revision+1 WHERE id=?",[id]);return {status:'expired'};
      }
      let result;
      try {result=await this.provider.result(a.provider_session_id);} catch {failure(503,'The camera result is temporarily unavailable. Retry checking this attempt shortly.');}
      if(result.sessionId!==a.provider_session_id) failure(502,'The verification provider returned an invalid result.');
      if(['CREATED','IN_PROGRESS'].includes(result.status)) return {status:'in_progress'};
      const confidence=result.confidence;
      if(result.status!=='SUCCEEDED' || typeof confidence!=='number' || !Number.isFinite(confidence) || confidence<0 || confidence>100) {
        const status=result.status==='EXPIRED'?'expired':'error';
        await execute("UPDATE verification_attempts SET status=?,review_message='The check could not be completed. Please retry with a new camera session.',revision=revision+1 WHERE id=?",[status,id]);
        return {status};
      }
      let reference;
      try {reference=await cleanImage(result.reference);} catch {
        await execute("UPDATE verification_attempts SET status='error',review_message='No usable reference image was returned. Please retry.',revision=revision+1 WHERE id=?",[id]);return {status:'error'};
      }
      if(confidence>=this.settings.threshold && this.settings.autoApprove!==false) {
        await execute("UPDATE verification_attempts SET status='verified',confidence=?,evidence=NULL,image_count=0,revision=revision+1 WHERE id=?",[confidence,id]);
        await execute("UPDATE member_verifications SET verified=TRUE,verified_at=UTC_TIMESTAMP(),method='aws_liveness' WHERE user_id=? AND current_attempt_id=?",[userId,id]);
        await execute("INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,'verification_auto_pass')",[userId,userId]);
        return {status:'verified'};
      }
      const images=[reference];
      for(const bytes of (result.audit ?? []).slice(0,2)) {try {images.push(await cleanImage(bytes));} catch { /* Keep the usable reference frame. */ }}
      const evidence=sealEvidence(images,this.settings.encryptionKey,id+':'+userId);
      if(evidence.length>2*1024*1024) failure(502,'Verification images were too large to review. Please retry.');
      await execute("UPDATE verification_attempts SET status='pending_review',confidence=?,evidence=?,image_count=?,evidence_expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? HOUR),revision=revision+1 WHERE id=?",[confidence,evidence,images.length,this.settings.retentionHours,id]);
      return {status:'pending_review'};
    });
  }
  async withdraw(userId) {
    return this.tx(userId,async(execute,record)=>{
      if(!record.current_attempt_id && !record.verified) return {ok:true};
      await execute("UPDATE verification_attempts SET evidence=NULL,image_count=0,status=IF(status IN ('in_progress','pending_review'),'cancelled',status),revision=revision+1 WHERE user_id=?",[userId]);
      await execute('UPDATE member_verifications SET verified=FALSE,current_attempt_id=NULL,verified_at=NULL,method=NULL WHERE user_id=?',[userId]);
      await execute("INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,'verification_withdraw')",[userId,userId]);
      return {ok:true};
    },{approved:false});
  }
  async queue(status='pending_review') {
    if(!['pending_review','verified','rejected','expired','error'].includes(status)) failure(400,'Invalid verification status.');
    await this.purge();
    return this.query('SELECT a.id,a.user_id,a.status,a.confidence,a.image_count,a.evidence_expires_at,a.revision,a.created_at,a.review_message,u.name,u.email,v.verified FROM verification_attempts a JOIN users u ON u.id=a.user_id JOIN member_verifications v ON v.current_attempt_id=a.id WHERE a.status=?'+(status==='verified'?' AND v.verified=TRUE':'')+' ORDER BY a.created_at DESC LIMIT 100',[status]);
  }
  decode(a) {
    if(!a.evidence || !a.evidence_expires_at || new Date(a.evidence_expires_at)<=new Date()) failure(409,'Review images have expired. Ask the member to retry.');
    if(!/^[a-fA-F0-9]{64}$/.test(this.settings.encryptionKey)) failure(503,'The verification image key is not configured.');
    try {return openEvidence(a.evidence,this.settings.encryptionKey,a.id+':'+a.user_id);} catch {failure(503,'Verification images cannot be opened. Check the encryption key.');}
  }
  async evidence(actorId,id,index) {
    await this.purge();
    const [owner]=await this.query('SELECT user_id FROM verification_attempts WHERE id=?',[id]);
    if(!owner) failure(404,'Verification image not found.');
    return this.tx(owner.user_id,async(execute,record)=>{
      const [a]=await execute('SELECT * FROM verification_attempts WHERE id=? FOR UPDATE',[id]);
      if(record.current_attempt_id!==id || a.status!=='pending_review') failure(404,'Verification image not found.');
      const images=this.decode(a);
      if(!images[index]) failure(404,'Verification image not found.');
      await execute("INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,'verification_image_view')",[actorId,owner.user_id]);
      return Buffer.from(images[index],'base64');
    },{actorId,approved:false});
  }
  async review(actorId,id,revision,action,message) {
    if(!['approve','reject'].includes(action)) failure(400,'Invalid review decision.');
    await this.purge();
    const [owner]=await this.query('SELECT user_id FROM verification_attempts WHERE id=?',[id]);
    if(!owner) failure(404,'Verification attempt not found.');
    return this.tx(owner.user_id,async(execute,record,user)=>{
      const [a]=await execute('SELECT * FROM verification_attempts WHERE id=? FOR UPDATE',[id]);
      if(record.current_attempt_id!==id || a.status!=='pending_review' || a.revision!==revision) failure(409,'This review changed or expired. Refresh the queue.');
      if(action==='approve') {
        if(user.banned || user.membership_status!=='approved') failure(400,'The member must be approved and unsuspended.');
        this.decode(a);
        await execute("UPDATE member_verifications SET verified=TRUE,verified_at=UTC_TIMESTAMP(),method='manual_review' WHERE user_id=?",[user.id]);
      }
      await execute('UPDATE verification_attempts SET status=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP(),review_message=?,evidence=NULL,image_count=0,revision=revision+1 WHERE id=?',[action==='approve'?'verified':'rejected',actorId,message,id]);
      await execute('INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,?)',[actorId,user.id,action==='approve'?'verification_manual_pass':'verification_reject']);
      return {ok:true};
    },{actorId,approved:false});
  }
  async revoke(actorId,userId,message) {
    return this.tx(userId,async(execute,record)=>{
      if(!record.verified) failure(409,'This member is not currently verified.');
      await execute('UPDATE member_verifications SET verified=FALSE,verified_at=NULL,method=NULL WHERE user_id=?',[userId]);
      if(record.current_attempt_id) await execute('UPDATE verification_attempts SET review_message=?,revision=revision+1 WHERE id=?',[message,record.current_attempt_id]);
      await execute("INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,'verification_revoke')",[actorId,userId]);
      return {ok:true};
    },{actorId,approved:false});
  }
}
