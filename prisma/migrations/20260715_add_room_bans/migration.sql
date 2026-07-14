-- Kicked users are permanently banned from the room they were removed from.
CREATE TABLE `room_bans` (
    `room_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `banned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `room_bans_user_id_idx`(`user_id`),
    PRIMARY KEY (`room_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `room_bans` ADD CONSTRAINT `room_bans_room_id_fkey`
    FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `room_bans` ADD CONSTRAINT `room_bans_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
