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
    const [users] = await connection.execute('SELECT id,is_admin,banned FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE', [actorId, targetId]);
    const actor = users.find(u => u.id === actorId), target = users.find(u => u.id === targetId);
    if (!actor?.is_admin || actor.banned) reject(403, 'Administrator access required.');
    if (!target) reject(404, 'Member not found.');
    let changed = false, auditAction;
    if (action === 'role') {
      if (enabled && target.banned) reject(400, 'Restore this account before assigning administrator access.');
      if (!enabled && target.is_admin && !target.banned) {
        const [[count]] = await connection.execute('SELECT COUNT(*) AS total FROM users WHERE is_admin=TRUE AND banned=FALSE');
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
    } else if (action === 'developer') {
      if (enabled && target.banned) reject(400, 'Restore this account before assigning a Developer badge.');
      const [badges] = await connection.execute("SELECT 1 FROM user_badges WHERE user_id=? AND badge='developer'", [targetId]);
      changed = !!badges.length !== enabled;
      if (enabled) await connection.execute("INSERT IGNORE INTO user_badges(user_id,badge) VALUES(?,'developer')", [targetId]);
      else await connection.execute("DELETE FROM user_badges WHERE user_id=? AND badge='developer'", [targetId]);
      auditAction = enabled ? 'grant_developer' : 'revoke_developer';
    } else reject(400, 'Invalid account action.');
    if (changed) await connection.execute('INSERT INTO admin_audit(actor_id,target_id,action) VALUES(?,?,?)', [actorId, targetId, auditAction]);
    await connection.commit(); transaction = false;
  } catch (error) { if (transaction) await connection.rollback(); throw error; }
  finally {
    try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [lock]); }
    finally { connection.release(); }
  }
}
