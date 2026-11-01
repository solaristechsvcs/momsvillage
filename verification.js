import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { text,id } from './validation.js';
const uuid = value => {
  if(typeof value!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw Object.assign(new Error('Invalid verification attempt.'),{status:400});
  return value;
};
export function verificationRouter({service,requireApproved,requireAdmin}) {
  const router=Router();
  const limits=rateLimit({windowMs:60000,limit:40,keyGenerator:req=>String(req.user.id),standardHeaders:'draft-8',legacyHeaders:false});
  router.use(['/verification','/admin/verification'],(req,res,next)=>{res.set('Cache-Control','private, no-store').set('CDN-Cache-Control','no-store');res.vary('Cookie');next();});
  router.get('/verification',async(req,res)=>res.json(await service.status(req.user.id)));
  router.delete('/verification',async(req,res)=>res.json(await service.withdraw(req.user.id)));
  router.post('/verification/attempts',requireApproved,limits,async(req,res)=>{
    const result=await service.start(req.user.id,req.body?.consent);
    if(result.unavailable) return res.status(503).json({error:'Verification provider is unavailable. Please try again later.'});
    res.status(201).json(result);
  });
  router.get('/verification/attempts/:id',requireApproved,limits,async(req,res)=>res.json(await service.attempt(req.user.id,uuid(req.params.id))));
  router.post('/verification/attempts/:id/credentials',requireApproved,limits,async(req,res)=>res.json(await service.credentials(req.user.id,uuid(req.params.id))));
  router.post('/verification/attempts/:id/complete',requireApproved,limits,async(req,res)=>res.json(await service.complete(req.user.id,uuid(req.params.id))));
  router.get('/admin/verification',requireApproved,requireAdmin,async(req,res)=>res.json({enabled:service.settings.enabled === true,configured:service.settings.ready,threshold:service.settings.threshold,retention_hours:service.settings.retentionHours,attempts:await service.queue(req.query.status ?? 'pending_review')}));
  router.get('/admin/verification/attempts/:id/images/:index',requireApproved,requireAdmin,async(req,res)=>{
    if(!/^[0-2]$/.test(req.params.index)) return res.status(400).json({error:'Invalid review image.'});
    const image=await service.evidence(req.user.id,uuid(req.params.id),Number(req.params.index));
    res.type('image/jpeg').set('Content-Disposition','inline').send(image);
  });
  router.patch('/admin/verification/attempts/:id',requireApproved,requireAdmin,async(req,res)=>{
    const message=text(req.body?.message,1500);
    res.json(await service.review(req.user.id,uuid(req.params.id),id(req.body?.revision),req.body?.action,message));
  });
  router.patch('/admin/verification/members/:id/revoke',requireApproved,requireAdmin,async(req,res)=>res.json(await service.revoke(req.user.id,id(req.params.id),text(req.body?.message,1500))));
  return router;
}
