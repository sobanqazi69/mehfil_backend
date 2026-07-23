-- Labelled bot accounts and auto-playing bot rooms.
ALTER TABLE `users` ADD COLUMN `is_bot` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `rooms` ADD COLUMN `is_bot_room` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `bot_playlist_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `room_id` INTEGER NOT NULL,
    `youtube_id` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `duration` INTEGER NOT NULL DEFAULT 240,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `bot_playlist_items_room_id_position_idx`(`room_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bot_playlist_items` ADD CONSTRAINT `bot_playlist_items_room_id_fkey`
    FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
