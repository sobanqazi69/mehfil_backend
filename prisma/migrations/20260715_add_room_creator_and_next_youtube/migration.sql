-- Add creator_id and next_youtube_id to rooms.
-- Both exist in schema.prisma and are used by the app (room.controller.js, room.socket.js)
-- but were never captured in a migration.

-- creator_id is NOT NULL in the model; existing rows are backfilled from host_id,
-- so add it nullable, backfill, then tighten.
ALTER TABLE `rooms` ADD COLUMN `creator_id` INTEGER NULL;
UPDATE `rooms` SET `creator_id` = `host_id` WHERE `creator_id` IS NULL;
ALTER TABLE `rooms` MODIFY `creator_id` INTEGER NOT NULL;

ALTER TABLE `rooms` ADD COLUMN `next_youtube_id` VARCHAR(50) NULL;
