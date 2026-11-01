import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

test('optional AI verification permissions, trusted results, encrypted review and revocation', {skip:process.env.MV_INTEGRATION!=='1',timeout:60000},async()=>{
  const mysql=(await import('mysql2/promise')).default;
  const root=await mysql.createConnection({host:'127.0.0.1',user:'root',password:'integration-only-password'});
  await root.query('CREATE DATABASE momsvillage_verification_test');
  const db=mysql.createPool({host:'127.0.0.1',user:'root',password:'integration-only-password',database:'momsvillage_verification_test',timezone:'Z',connectionLimit:10});
  let server;
  try {
    for(const file of ['schema.sql','social-schema.sql','membership-schema.sql','verification-schema.sql']) {
      const sql=await readFile(new URL('../'+file,import.meta.url),'utf8');
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.query(statement);
    }
    const sharp=(await import('sharp')).default;
    const image=await sharp({create:{width:40,height:40,channels:3,background:'#449977'}}).withMetadata({exif:{IFD0:{Artist:'Private metadata'}}}).jpeg().toBuffer();
    const {VerificationService}=await import('../verification-service.js');
    const {verificationSettings,openEvidence,verificationSql}=await import('../verification-utils.js');
    const {verificationRouter}=await import('../verification.js');
    const settings=verificationSettings({verification:{enabled:true,region:'us-east-1',browserRoleArn:'arn:aws:iam::123456789012:role/camera',encryptionKey:'ab'.repeat(32),autoApproveThreshold:95,retentionHours:72}});
    const results=new Map();
    const provider={
      async create(){const id=randomUUID();results.set(id,{sessionId:id,status:'SUCCEEDED',confidence:99,reference:image,audit:[image]});return id;},
      async result(id){return results.get(id);},
      async credentials(){return {accessKeyId:'temporary-test',secretAccessKey:'test-only',sessionToken:'test-token',expiration:new Date(Date.now()+900000).toISOString()};}
    };
    const service=new VerificationService(db,settings,provider);
    async function user(name,{admin=false,status='approved',banned=false}={}) {
      const [row]=await db.execute('INSERT INTO users(name,email,password,is_admin,banned,bio) VALUES(?,?,?,?,?,?)',[name,name+'@example.com','unused',admin,banned,'']);
      await db.execute('INSERT INTO membership_applications(user_id,status,eligibility_confirmed,reason) VALUES(?,?,TRUE,?)',[row.insertId,status,'Test member']);
      return row.insertId;
    }
    const admin=await user('admin',{admin:true}),member=await user('member'),other=await user('other'),pending=await user('pending',{status:'pending'});
    const express=(await import('express')).default,app=express();
    app.use(express.json());
    app.use(async(req,res,next)=>{
      const [rows]=await db.execute('SELECT u.*,m.status AS membership_status FROM users u JOIN membership_applications m ON m.user_id=u.id WHERE u.id=?',[Number(req.get('x-test-user'))||0]);
      if(!rows[0]) return res.status(401).json({error:'Sign in.'});
      req.user=rows[0];req.isAdmin=!!req.user.is_admin&&!req.user.banned&&req.user.membership_status==='approved';next();
    });
    const requireApproved=(req,res,next)=>!req.user.banned&&req.user.membership_status==='approved'?next():res.status(403).json({error:'Approved membership required.'});
    const requireAdmin=(req,res,next)=>req.isAdmin?next():res.status(403).json({error:'Admin required.'});
    app.use('/api',verificationRouter({service,requireApproved,requireAdmin}));
    app.use((error,req,res,next)=>res.status(error.status??500).json({error:error.message}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port;
    async function request(who,path,method='GET',body,status=200) {
      const response=await fetch(base+'/api'+path,{method,signal:AbortSignal.timeout(10000),headers:{'x-test-user':String(who),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      const data=response.headers.get('content-type')?.startsWith('application/json')?await response.json():{bytes:Buffer.from(await response.arrayBuffer()),type:response.headers.get('content-type')};
      assert.equal(response.status,status,path+':'+JSON.stringify(data));
      return data;
    }
    assert.equal((await request(member,'/verification')).optional,true);
    await request(pending,'/verification/attempts','POST',{consent:true},403);
    await request(member,'/verification/attempts','POST',{consent:false},400);
    const first=await request(member,'/verification/attempts','POST',{consent:true},201);
    await request(other,'/verification/attempts/'+first.id,'GET',undefined,404);
    await request(other,'/verification/attempts/'+first.id+'/credentials','POST',{},404);
    await request(member,'/verification/attempts/'+first.id+'/credentials','POST',{});
    await request(member,'/verification/attempts/'+first.id+'/credentials','POST',{});
    await request(member,'/verification/attempts/'+first.id+'/credentials','POST',{},429);
    const attempt=await service.attempt(member,first.id);
    results.set(attempt.sessionId,{...results.get(attempt.sessionId),confidence:12});
    const flagged=await request(member,'/verification/attempts/'+first.id+'/complete','POST',{confidence:100,verified:true,sessionId:'forged'});
    assert.equal(flagged.status,'pending_review');assert.equal((await service.status(member)).verified,false);
    await request(member,'/admin/verification','GET',undefined,403);
    const queue=await request(admin,'/admin/verification');assert.equal(queue.attempts.length,1);assert.equal(queue.attempts[0].confidence,'12.00');
    assert.equal(Object.hasOwn(queue.attempts[0],'evidence'),false);
    const [[stored]]=await db.execute('SELECT * FROM verification_attempts WHERE id=?',[first.id]);
    assert.ok(stored.evidence.length>0);assert.equal(stored.evidence.includes(image),false);
    assert.throws(()=>openEvidence(stored.evidence,'cd'.repeat(32),stored.id+':'+member));
    assert.throws(()=>openEvidence(stored.evidence,settings.encryptionKey,stored.id+':'+other));
    await request(member,'/admin/verification/attempts/'+first.id+'/images/0','GET',undefined,403);
    const evidence=await request(admin,'/admin/verification/attempts/'+first.id+'/images/0');
    assert.match(evidence.type,/^image\/jpeg/);assert.equal((await sharp(evidence.bytes).metadata()).exif,undefined);
    await request(admin,'/admin/verification/attempts/'+first.id,'PATCH',{revision:stored.revision+1,action:'approve',message:'Stale'},409);
    await request(member,'/admin/verification/attempts/'+first.id,'PATCH',{revision:stored.revision,action:'approve',message:'Not an admin'},403);
    await request(admin,'/admin/verification/attempts/'+first.id,'PATCH',{revision:stored.revision,action:'approve',message:'Reviewed human-presence evidence.'});
    assert.equal((await service.status(member)).verified,true);assert.equal((await service.status(member)).method,'manual_review');
    const [[cleared]]=await db.execute('SELECT evidence FROM verification_attempts WHERE id=?',[first.id]);assert.equal(cleared.evidence,null);
    await request(admin,'/admin/verification/attempts/'+first.id+'/images/0','GET',undefined,404);
    const [[badge]]=await db.query('SELECT '+verificationSql('u')+' AS verified FROM users u WHERE u.id=?',[member]);assert.equal(badge.verified,1);
    await request(other,'/verification','DELETE',{userId:member});assert.equal((await service.status(member)).verified,true);
    await request(admin,'/admin/verification/members/'+member+'/revoke','PATCH',{message:'Review revoked.'});
    assert.equal((await service.status(member)).verified,false);assert.equal((await service.status(member)).status,'revoked');

    const autoUser=await user('auto'),auto=await service.start(autoUser,true),autoMeta=await service.attempt(autoUser,auto.id);
    results.set(autoMeta.sessionId,{...results.get(autoMeta.sessionId),status:'IN_PROGRESS'});
    assert.equal((await service.complete(autoUser,auto.id)).status,'in_progress');
    results.set(autoMeta.sessionId,{...results.get(autoMeta.sessionId),status:'SUCCEEDED'});
    assert.equal((await service.complete(autoUser,auto.id)).status,'verified');
    const [[autoRow]]=await db.execute('SELECT evidence FROM verification_attempts WHERE id=?',[auto.id]);assert.equal(autoRow.evidence,null);
    const missingUser=await user('missing'),missing=await service.start(missingUser,true),missingMeta=await service.attempt(missingUser,missing.id);
    results.set(missingMeta.sessionId,{...results.get(missingMeta.sessionId),reference:undefined});
    assert.equal((await service.complete(missingUser,missing.id)).status,'error');assert.equal((await service.status(missingUser)).verified,false);
    const invalidUser=await user('invalid'),invalid=await service.start(invalidUser,true),invalidMeta=await service.attempt(invalidUser,invalid.id);
    results.set(invalidMeta.sessionId,{...results.get(invalidMeta.sessionId),confidence:null});
    assert.equal((await service.complete(invalidUser,invalid.id)).status,'error');
    const lowUser=await user('low'),low=await service.start(lowUser,true),lowMeta=await service.attempt(lowUser,low.id);
    results.set(lowMeta.sessionId,{...results.get(lowMeta.sessionId),confidence:40});await service.complete(lowUser,low.id);
    await db.execute('UPDATE verification_attempts SET evidence_expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[low.id]);
    await service.purge();
    const [[expired]]=await db.execute('SELECT * FROM verification_attempts WHERE id=?',[low.id]);assert.equal(expired.evidence,null);assert.equal(expired.status,'expired');
    await assert.rejects(service.review(admin,low.id,expired.revision,'approve','Expired'),{status:409});
    const privateUser=await user('private'),privateAttempt=await service.start(privateUser,true),privateMeta=await service.attempt(privateUser,privateAttempt.id);
    results.set(privateMeta.sessionId,{...results.get(privateMeta.sessionId),confidence:30});await service.complete(privateUser,privateAttempt.id);
    await db.execute("UPDATE membership_applications SET status='pending' WHERE user_id=?",[privateUser]);
    await request(privateUser,'/verification','DELETE');
    const [[withdrawn]]=await db.execute('SELECT status,evidence FROM verification_attempts WHERE id=?',[privateAttempt.id]);assert.equal(withdrawn.status,'cancelled');assert.equal(withdrawn.evidence,null);
    assert.equal((await service.status(privateUser)).verified,false);
    const budget=await user('budget');
    for(let n=0;n<3;n++){await service.start(budget,true);await service.withdraw(budget);}
    await assert.rejects(service.start(budget,true),{status:429});
    const disabled=new VerificationService(db,{...settings,enabled:false,ready:false},null);
    await assert.rejects(disabled.start(other,true),{status:503});
    assert.equal((await disabled.status(other)).verified,false);
    const [[audit]]=await db.query("SELECT COUNT(*) AS total FROM admin_audit WHERE action IN ('verification_image_view','verification_manual_pass','verification_revoke')");
    assert.ok(Number(audit.total)>=3);
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await db.end();await root.end();
  }
});

test('AWS browser credentials are restricted to starting a regional liveness session', {skip:process.env.MV_INTEGRATION!=='1'},async()=>{
  const {awsLivenessProvider}=await import('../liveness-provider.js');
  let policy;
  const provider=awsLivenessProvider({region:'us-east-1',browserRoleArn:'arn:aws:iam::123456789012:role/camera'},{
    rekognition:{send:async()=>({SessionId:randomUUID()})},
    sts:{send:async command=>{policy=JSON.parse(command.input.Policy);assert.equal(command.input.DurationSeconds,900);return {Credentials:{AccessKeyId:'test',SecretAccessKey:'secret',SessionToken:'token',Expiration:new Date()}};}}
  });
  const credentials=await provider.credentials(randomUUID());assert.equal(credentials.accessKeyId,'test');
  assert.equal(policy.Statement.length,1);assert.equal(policy.Statement[0].Action,'rekognition:StartFaceLivenessSession');
  assert.equal(policy.Statement[0].Condition.StringEquals['aws:RequestedRegion'],'us-east-1');
});
