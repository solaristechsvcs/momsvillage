import { assignableBadges } from './badges.js';

// Preserve the effective admin access of installations upgrading from email allowlists.
export async function initializeAdminRoles(db, config) {
  const connection = await db.getConnection(), lock = `mv-admin-${config.mysql.database}`.slice(0, 64);
  let acquired = false, transaction = false;
  try {
    const [[result]] = await connection.execute('SELECT GET_LOCK(?,10) AS acquired', [lock]);
    acquired = Number(result.acquired) === 1;
    if (!acquired) throw new Error('Administrator migration is busy. Retry startup.');
    await connection.beginTransaction(); transaction = true;
    const [done] = await connection.execute("SELECT 1 FROM app_migrations WHERE name='database-admin-roles-v1'");
    if (!done.length) {
      const allowed = new Set((config.adminEmails ?? []).map(email => email.toLowerCase()));
      const [users] = await connection.execute('SELECT id,email FROM users WHERE is_admin=TRUE FOR UPDATE');
      for (const user of users) if (!allowed.has(user.email.toLowerCase())) await connection.execute('UPDATE users SET is_admin=FALSE WHERE id=?', [user.id]);
      await connection.execute("INSERT INTO app_migrations(name) VALUES('database-admin-roles-v1')");
    }
    await connection.commit(); transaction = false;
  } catch (error) { if (transaction) await connection.rollback(); throw error; }
  finally {
    try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [lock]); }
    finally { connection.release(); }
  }
}

// Serialize role changes across app processes and re-check the acting admin inside the lock.
export async function changeMemberAccess(db, database, actorId, targetId, action, enabled) {
  const connection = await db.getConnection();
  const lock = `mv-admin-${database}`.slice(0, 64);
  let acquired = false, transaction = false;
  const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
  try {
    const [[result]] = await connection.execute('SELECT GET_LOCK(?,10) AS acquired', [lock]);
    acquired = Number(result.acquired) === 1;
    if (!acquired) reject(503, 'Account administration is busy. Try again shortly.');
    await connection.beginTransaction(); transaction = true;
    const [users] = await connection.execute('SELECT u.id,u.is_admin,u.banned,a.status AS membership_status FROM users u LEFT JOIN membership_applications a ON a.user_id=u.id WHERE u.id IN (?,?) ORDER BY u.id FOR UPDATE', [actorId, targetId]);
    const actor = users.find(u => u.id === actorId), target = users.find(u => u.id === targetId);
    if (!actor?.is_admin || actor.banned || actor.membership_status !== 'approved') reject(403, 'Administrator access required.');
    if (!target) reject(404, 'Member not found.');
    let changed = false, auditAction;
    if (action === 'role') {
      if (enabled && (target.banned || target.membership_status !== 'approved')) reject(400, 'Approve and restore this membership before assigning administrator access.');
      if (!enabled && target.is_admin && !target.banned) {
        const [[count]] = await connection.execute("SELECT COUNT(*) AS total FROM users u JOIN membership_applications a ON a.user_id=u.id WHERE u.is_admin=TRUE AND u.banned=FALSE AND a.status=\'approved\'");
        if (Number(count.total) <= 1) reject(400, 'You cannot remove the last active administrator. Assign another administrator first.');
      }
      await connection.execute('UPDATE users SET is_admin=? WHERE id=?', [enabled, targetId]);
      changed = !!target.is_admin !== enabled;
      auditAction = enabled ? 'grant_admin' : 'revoke_admin';
    } else if (action === 'suspension') {
      if (enabled && target.is_admin) reject(400, 'Revoke administrator access before suspending this account.');
      await connection.execute('UPDATE users SET banned=? WHERE id=?', [enabled, targetId]);
      changed = !!target.banned !== enabled;
      auditAction = enabled ? 'suspend' : 'restore';
    } else if (action === 'developer' || action.startsWith('badge:')) {
      const badge = action === 'developer' ? 'developer' : action.slice(6);
      if (!Object.hasOwn(assignableBadges, badge)) reject(400, 'Invalid badge.');
      if (enabled && (target.banned || target.membership_status !== 'approved')) reject(400, 'Approve and restore this membership before assigning a badge.');
      const [badges] = await connection.execute('SELECT 1 FROM user_badges WHERE user_id=? AND badge=?', [targetId, badge]);
      changed = !!badges.length !== enabled;
      if (enabled) await connection.execute('INSERT IGNORE INTO user_badges(user_id,badge) VALUES(?,?)', [targetId, badge]);
      else await connection.execute('DELETE FROM user_badges WHERE user_id=? AND badge=?', [targetId, badge]);
      auditAction = `${enabled ? 'grant' : 'revoke'}_${badge}`;
    } else reject(400, 'Invalid account action.');
    if (changed) await connection.execute('INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,?)', [actorId, targetId, auditAction]);
    await connection.commit(); transaction = false;
  } catch (error) { if (transaction) await connection.rollback(); throw error; }
  finally {
    try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [lock]); }
    finally { connection.release(); }
  }
}
