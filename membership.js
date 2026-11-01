import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import { id, text } from './validation.js';

export const membershipPolicy = {
  version: 'mothers-v1',
  text: 'Moms Village is a private community for mothers aged 18 and older, including adoptive, foster and stepmothers. Fathers and applicants who do not meet this membership policy are not eligible. Membership eligibility is self-declared and reviewed by administrators.',
  confirmation: 'I am a mother, I am at least 18 years old, and I meet the mothers-only membership policy.'
};
export const approvedMemberSql = (alias = 'u') => "EXISTS(SELECT 1 FROM membership_applications access_check WHERE access_check.user_id=" + alias + ".id AND access_check.status='approved')";
export const membershipStatus = user => user.banned ? 'suspended' : user.membership_status ?? 'pending';

export async function initializeMembership(db) {
  await db.query("INSERT IGNORE INTO membership_applications(user_id,status,reason,review_message) SELECT id,IF(is_admin=TRUE,'approved','pending'),'',IF(is_admin=TRUE,'Administrator access retained during membership rollout.','Please submit your membership application for administrator review.') FROM users");
}
function applicationInput(body, fail) {
  if (body.eligibility_confirmed !== true) fail(400, 'Confirm that you meet the mothers-only membership policy.');
  return { reason: text(body.application_reason, 1500), referral: text(body.referral ?? '', 200, false) };
}
async function transaction(db, work) {
  const connection = await db.getConnection();
  const execute = async (sql, values = []) => (await connection.execute(sql, values))[0];
  try { await connection.beginTransaction(); const result = await work(execute); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
async function redeemInvitation(execute, rawCode, applicantId, fail) {
  const code = text(rawCode, 100);
  if (!/^[a-f0-9]{48}$/.test(code)) fail(400, 'Invitation code is invalid, expired, revoked, or already used.');
  const hash = createHash('sha256').update(code).digest('hex');
  const [invitation] = await execute('SELECT * FROM membership_invitations WHERE code_hash=? FOR UPDATE', [hash]);
  if (!invitation || invitation.revoked || invitation.used_by || new Date(invitation.expires_at) <= new Date()) fail(400, 'Invitation code is invalid, expired, revoked, or already used.');
  const [issuer] = await execute('SELECT u.id FROM users u WHERE u.id=? AND u.banned=FALSE AND ' + approvedMemberSql(), [invitation.issuer_id]);
  if (!issuer || invitation.issuer_id === applicantId) fail(400, 'This invitation is unavailable.');
  await execute('UPDATE membership_invitations SET used_by=?,used_at=UTC_TIMESTAMP() WHERE id=?', [applicantId, invitation.id]);
  await execute('INSERT INTO membership_referrals(applicant_id,invitation_id) VALUES(?,?)', [applicantId, invitation.id]);
}
export async function registerMembership({ db, body, passwordHash, email, name, requestedAdmin, config, fail }) {
  const input = requestedAdmin ? { reason: '', referral: '' } : applicationInput(body, fail);
  const invitation = text(body.invitation_code ?? '', 100, false);
  if (!requestedAdmin && config.membership?.inviteOnly === true && !invitation) fail(400, 'An invitation code is required to apply.');
  return transaction(db, async execute => {
    const result = await execute('INSERT INTO users(name,email,password,city,bio,is_admin) VALUES(?,?,?,?,?,?)', [name, email, passwordHash, text(body.city ?? '', 120, false), '', requestedAdmin]);
    await execute('INSERT INTO membership_applications(user_id,status,eligibility_confirmed,reason,referral,policy_version,submitted_at) VALUES(?,?,?,?,?,?,' + (requestedAdmin ? 'NULL' : 'UTC_TIMESTAMP()') + ')', [result.insertId, requestedAdmin ? 'approved' : 'pending', !requestedAdmin, input.reason, input.referral, requestedAdmin ? '' : membershipPolicy.version]);
    if (invitation && !requestedAdmin) await redeemInvitation(execute, invitation, result.insertId, fail);
    return result.insertId;
  });
}

export function membershipRouter({ db, query, config, fail, requireApproved, requireAdmin }) {
  const router = Router();
  const applyLimit = rateLimit({ windowMs: 3600000, limit: 10, keyGenerator: req => String(req.user.id), standardHeaders: 'draft-8', legacyHeaders: false });
  async function applicantRecord(userId) {
    const [application] = await query('SELECT user_id,status,eligibility_confirmed,reason,referral,policy_version,revision,review_message,reviewed_at,submitted_at FROM membership_applications WHERE user_id=?', [userId]);
    const [referral] = await query('SELECT 1 FROM membership_referrals WHERE applicant_id=?', [userId]);
    return { ...application, has_invitation: !!referral };
  }
  router.get('/membership', async (req, res) => res.json({ status: membershipStatus(req.user), application: await applicantRecord(req.user.id), policy: membershipPolicy, invite_only: config.membership?.inviteOnly === true }));
  router.put('/membership/application', applyLimit, async (req, res) => {
    const input = applicationInput(req.body, fail), code = text(req.body.invitation_code ?? '', 100, false);
    await transaction(db, async execute => {
      const [user] = await execute('SELECT id,banned FROM users WHERE id=? FOR UPDATE', [req.user.id]);
      if (user.banned) fail(403, 'Suspended accounts cannot submit applications.');
      const [application] = await execute('SELECT * FROM membership_applications WHERE user_id=? FOR UPDATE', [req.user.id]);
      if (!application || application.status === 'approved') fail(403, 'This account does not need an application.');
      const [referral] = await execute('SELECT 1 FROM membership_referrals WHERE applicant_id=?', [req.user.id]);
      if (code) {
        if (referral) fail(400, 'This application already has an invitation.');
        await redeemInvitation(execute, code, req.user.id, fail);
      }
      if (config.membership?.inviteOnly === true && !referral && !code) fail(400, 'An invitation code is required to apply.');
      await execute("UPDATE membership_applications SET status='pending',eligibility_confirmed=TRUE,reason=?,referral=?,policy_version=?,revision=revision+1,review_message='',reviewed_by=NULL,reviewed_at=NULL,submitted_at=UTC_TIMESTAMP() WHERE user_id=?", [input.reason, input.referral, membershipPolicy.version, req.user.id]);
    });
    res.json({ ok: true });
  });
  router.get('/invitations', requireApproved, async (req, res) => res.json(await query('SELECT id,suffix,expires_at,revoked,used_at,created_at FROM membership_invitations WHERE issuer_id=? ORDER BY id DESC LIMIT 100', [req.user.id])));
  router.post('/invitations', requireApproved, async (req, res) => {
    const code = randomBytes(24).toString('hex');
    await transaction(db, async execute => {
      const [issuer] = await execute('SELECT id,banned FROM users WHERE id=? FOR UPDATE', [req.user.id]);
      const [membership] = await execute("SELECT 1 FROM membership_applications WHERE user_id=? AND status='approved' FOR UPDATE", [req.user.id]);
      if (issuer.banned || !membership) fail(403, 'Approved membership is required.');
      const [counts] = await execute('SELECT SUM(revoked=FALSE AND used_by IS NULL AND expires_at>UTC_TIMESTAMP()) AS active,SUM(created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY)) AS recent FROM membership_invitations WHERE issuer_id=?', [req.user.id]);
      if (Number(counts.active) >= 5 || Number(counts.recent) >= 20) fail(429, 'You may have 5 active invitations and create up to 20 per week.');
      await execute('INSERT INTO membership_invitations(issuer_id,code_hash,suffix,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 14 DAY))', [req.user.id, createHash('sha256').update(code).digest('hex'), code.slice(-6)]);
    });
    res.status(201).json({ code, expires_in_days: 14 });
  });
  router.delete('/invitations/:id', requireApproved, async (req, res) => {
    await transaction(db, async execute => {
      const [actor] = await execute('SELECT u.id,u.is_admin,u.banned FROM users u WHERE u.id=? AND ' + approvedMemberSql() + ' FOR UPDATE', [req.user.id]);
      if (!actor || actor.banned) fail(403, 'Approved membership is required.');
      const [invitation] = await execute('SELECT * FROM membership_invitations WHERE id=? FOR UPDATE', [id(req.params.id)]);
      if (!invitation) fail(404, 'Invitation not found.');
      if (!actor.is_admin && invitation.issuer_id !== actor.id) fail(403, 'You can only revoke your own invitations.');
      if (invitation.used_by) fail(400, 'Used invitations cannot be revoked. Review the member application instead.');
      await execute('UPDATE membership_invitations SET revoked=TRUE WHERE id=?', [invitation.id]);
    });
    res.json({ ok: true });
  });
  router.get('/admin/invitations', requireApproved, requireAdmin, async (req, res) => res.json(await query('SELECT i.id,i.issuer_id,i.suffix,i.expires_at,i.revoked,i.used_at,i.created_at,u.name AS issuer_name FROM membership_invitations i JOIN users u ON u.id=i.issuer_id ORDER BY i.id DESC LIMIT 200')));
  router.get('/admin/membership-applications', requireApproved, requireAdmin, async (req, res) => {
    const status = req.query.status ?? 'pending';
    if (!['pending','approved','declined'].includes(status)) fail(400, 'Invalid application status.');
    const specific = req.query.user_id ? id(req.query.user_id) : null;
    res.json(await query('SELECT a.*,u.name,u.email,u.city,u.banned,u.is_admin,i.suffix AS invitation_suffix,v.name AS inviter_name,v.id AS inviter_id FROM membership_applications a JOIN users u ON u.id=a.user_id LEFT JOIN membership_referrals r ON r.applicant_id=a.user_id LEFT JOIN membership_invitations i ON i.id=r.invitation_id LEFT JOIN users v ON v.id=i.issuer_id WHERE ' + (specific ? 'a.user_id=?' : 'a.status=?') + ' ORDER BY a.submitted_at DESC,a.user_id DESC LIMIT 200', [specific ?? status]));
  });
  router.patch('/admin/membership-applications/:id', requireApproved, requireAdmin, async (req, res) => {
    const targetId = id(req.params.id), revision = id(req.body.revision), action = req.body.action;
    if (!['approve','decline','request_changes'].includes(action)) fail(400, 'Invalid review action.');
    const message = text(req.body.message ?? '', 1500, action !== 'approve');
    const connection = await db.getConnection(), lock = ('mv-admin-' + config.mysql.database).slice(0,64);
    let acquired = false, begun = false;
    try {
      const [[result]] = await connection.execute('SELECT GET_LOCK(?,10) AS acquired', [lock]); acquired = Number(result.acquired) === 1;
      if (!acquired) fail(503, 'Administration is busy. Try again shortly.');
      await connection.beginTransaction(); begun = true;
      const [users] = await connection.execute('SELECT id,is_admin,banned FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE', [req.user.id,targetId]);
      const actor = users.find(u => u.id === req.user.id), target = users.find(u => u.id === targetId);
      const [[actorMembership]] = await connection.execute('SELECT status FROM membership_applications WHERE user_id=? FOR UPDATE', [req.user.id]);
      if (!actor?.is_admin || actor.banned || actorMembership?.status !== 'approved') fail(403, 'Administrator access required.');
      if (!target) fail(404, 'Application not found.');
      const [[application]] = await connection.execute('SELECT * FROM membership_applications WHERE user_id=? FOR UPDATE', [targetId]);
      if (!application) fail(404, 'Application not found.');
      if (application.revision !== revision) fail(409, 'This application changed. Refresh the review queue before deciding.');
      if (target.is_admin && action !== 'approve') fail(400, 'Revoke administrator access before restricting this membership.');
      if (target.banned) fail(400, 'Restore the account before reviewing its membership.');
      if (action === 'approve' && !target.is_admin && (!application.eligibility_confirmed || !application.submitted_at || !application.reason.trim())) fail(400, 'The member must submit an eligibility confirmation and application first.');
      if (action === 'approve' && config.membership?.inviteOnly === true && !target.is_admin) {
        const [[referral]] = await connection.execute('SELECT 1 FROM membership_referrals WHERE applicant_id=?', [targetId]);
        if (!referral) fail(400, 'An invitation is required before approval.');
      }
      await connection.execute('UPDATE membership_applications SET status=?,review_message=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP(),revision=revision+1 WHERE user_id=?', [action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'pending',message,req.user.id,targetId]);
      await connection.execute('INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,?)', [req.user.id,targetId,'membership_' + action]);
      await connection.commit(); begun = false;
    } catch (error) { if (begun) await connection.rollback(); throw error; }
    finally { try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [lock]); } finally { connection.release(); } }
    res.json({ ok: true });
  });
  return router;
}
