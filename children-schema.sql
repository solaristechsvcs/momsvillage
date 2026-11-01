CREATE TABLE IF NOT EXISTS profile_children (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id INT UNSIGNED NOT NULL,
 name VARCHAR(80) NULL,
 age_value TINYINT UNSIGNED NULL,
 age_unit ENUM('years','months') NULL,
 gender ENUM('boy','girl','undisclosed') NOT NULL DEFAULT 'undisclosed',
 shared BOOLEAN NOT NULL DEFAULT FALSE,
 INDEX owner(user_id,id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);