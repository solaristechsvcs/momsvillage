export const assignableBadges = { developer: 'Developer', founding_member: 'Founding Member', tester: 'Tester' };

// Fixed internal aliases only: never pass request data to this SQL fragment.
export function badgeColumns(alias = 'u') {
  return `${alias}.is_admin AS staff_badge, ` + Object.keys(assignableBadges).map(badge => `EXISTS(SELECT 1 FROM user_badges ub WHERE ub.user_id=${alias}.id AND ub.badge='${badge}') AS ${badge}_badge`).join(', ');
}

export async function initializeBadgeStorage(db, database) {
  const connection = await db.getConnection(), lock = `mv-badges-${database}`.slice(0, 64);
  let acquired = false;
  try {
    const [[result]] = await connection.execute('SELECT GET_LOCK(?,10) AS acquired', [lock]);
    acquired = Number(result.acquired) === 1;
    if (!acquired) throw new Error('Badge migration is busy. Retry startup.');
    const [[column]] = await connection.query("SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_badges' AND COLUMN_NAME='badge'");
    if (column?.DATA_TYPE === 'enum') await connection.query('ALTER TABLE user_badges MODIFY badge VARCHAR(32) NOT NULL');
  } finally {
    try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [lock]); }
    finally { connection.release(); }
  }
}
