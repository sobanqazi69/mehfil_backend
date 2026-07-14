-- Unique public handle. Nullable: existing users have not picked one yet.
ALTER TABLE `users` ADD COLUMN `username` VARCHAR(30) NULL;
CREATE UNIQUE INDEX `users_username_key` ON `users`(`username`);
