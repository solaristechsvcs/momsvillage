import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import sharp from 'sharp';

export const verificationSql = (alias='u') => 'EXISTS(SELECT 1 FROM member_verifications verified_status WHERE verified_status.user_id=' + alias + '.id AND verified_status.verified=TRUE)';
export function verificationSettings(config) {
  const raw=config.verification ?? {};
  const s={...raw,enabled:raw.enabled === true,region:raw.region ?? 'us-east-1',browserRoleArn:raw.browserRoleArn ?? '',encryptionKey:raw.encryptionKey ?? '',threshold:raw.autoApproveThreshold ?? 95,retentionHours:raw.retentionHours ?? 72};
  const valid = /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(s.region) && /^arn:aws(?:-us-gov|-cn)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(s.browserRoleArn) && /^[a-fA-F0-9]{64}$/.test(s.encryptionKey) && Number.isFinite(s.threshold) && s.threshold>0 && s.threshold<=100 && Number.isInteger(s.retentionHours) && s.retentionHours>=1 && s.retentionHours<=168;
  return {...s,ready:s.enabled === true && valid};
}
export function sealEvidence(images,key,aad) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(images),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);
}
export function openEvidence(buffer,key,aad) {
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),buffer.subarray(0,12));
  decipher.setAuthTag(buffer.subarray(12,28));decipher.setAAD(Buffer.from(aad));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString('utf8'));
}
export async function cleanImage(bytes) {
  if (!bytes || bytes.byteLength>8*1024*1024) throw new Error('InvalidImage');
  const image=sharp(Buffer.from(bytes),{limitInputPixels:25000000,animated:false});
  const meta=await image.metadata();
  if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages ?? 1)>1) throw new Error('InvalidImage');
  return (await image.rotate().resize(960,960,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer()).toString('base64');
}
