CREATE TABLE IF NOT EXISTS verification_attempts (
 id CHAR(36) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, provider_session_id VARCHAR(100) NULL UNIQUE,
 status ENUM('in_progress','pending_review','verified','rejected','expired','error','cancelled') NOT NULL,
 confidence DECIMAL(5,2) NULL, evidence MEDIUMBLOB NULL, image_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
 evidence_expires_at DATETIME NULL, session_expires_at DATETIME NOT NULL, credentials_issued INT UNSIGNED NOT NULL DEFAULT 0,
 consent_version VARCHAR(30) NOT NULL, consent_at DATETIME NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 review_message VARCHAR(1500) NOT NULL DEFAULT '', reviewed_by INT UNSIGNED NULL, reviewed_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(reviewed_by) REFERENCES users(id), INDEX owner(user_id,created_at), INDEX review(status,evidence_expires_at)
);
CREATE TABLE IF NOT EXISTS member_verifications (
 user_id INT UNSIGNED PRIMARY KEY, verified BOOLEAN NOT NULL DEFAULT FALSE, current_attempt_id CHAR(36) NULL,
 verified_at DATETIME NULL, method VARCHAR(30) NULL,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(current_attempt_id) REFERENCES verification_attempts(id)
);
