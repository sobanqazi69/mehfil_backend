-- Host-mute is separate from self-mute: a user cannot unmute themselves out of it.
ALTER TABLE `room_members` ADD COLUMN `muted_by_host` BOOLEAN NOT NULL DEFAULT false;
