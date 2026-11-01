CREATE TABLE IF NOT EXISTS membership_applications (
 user_id INT UNSIGNED PRIMARY KEY, status ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
 eligibility_confirmed BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT NOT NULL, referral VARCHAR(200) NOT NULL DEFAULT '',
 policy_version VARCHAR(20) NOT NULL DEFAULT '', revision INT UNSIGNED NOT NULL DEFAULT 1,
 review_message VARCHAR(1500) NOT NULL DEFAULT '', reviewed_by INT UNSIGNED NULL, reviewed_at DATETIME NULL,
 submitted_at DATETIME NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(reviewed_by) REFERENCES users(id), INDEX queue(status,submitted_at,user_id)
);
CREATE TABLE IF NOT EXISTS membership_invitations (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, issuer_id INT UNSIGNED NOT NULL, code_hash CHAR(64) NOT NULL UNIQUE,
 suffix CHAR(6) NOT NULL, expires_at DATETIME NOT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE,
 used_by INT UNSIGNED NULL, used_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(issuer_id) REFERENCES users(id), FOREIGN KEY(used_by) REFERENCES users(id), INDEX issuer(issuer_id,expires_at)
);
CREATE TABLE IF NOT EXISTS membership_referrals (
 applicant_id INT UNSIGNED PRIMARY KEY, invitation_id INT UNSIGNED NOT NULL UNIQUE,
 FOREIGN KEY(applicant_id) REFERENCES users(id), FOREIGN KEY(invitation_id) REFERENCES membership_invitations(id)
);
