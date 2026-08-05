-- Mic seats: only a seated user may speak.

ALTER TABLE `rooms` ADD COLUMN `max_seats` INTEGER NOT NULL DEFAULT 5;

CREATE TABLE `room_seats` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `room_id` INTEGER NOT NULL,
  `seat_no` INTEGER NOT NULL,
  `user_id` INTEGER NULL,
  `role` ENUM('HOST', 'SPEAKER') NOT NULL DEFAULT 'SPEAKER',
  `is_muted` BOOLEAN NOT NULL DEFAULT false,
  `is_locked` BOOLEAN NOT NULL DEFAULT false,
  `occupied_at` DATETIME(3) NULL,

  UNIQUE INDEX `room_seats_room_id_seat_no_key`(`room_id`, `seat_no`),
  INDEX `room_seats_room_id_user_id_idx`(`room_id`, `user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `room_seats` ADD CONSTRAINT `room_seats_room_id_fkey`
  FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `room_seats` ADD CONSTRAINT `room_seats_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill seats for every existing room so no room is left without slots.
INSERT INTO `room_seats` (`room_id`, `seat_no`, `role`)
SELECT r.`id`, n.`seat_no`, IF(n.`seat_no` = 0, 'HOST', 'SPEAKER')
FROM `rooms` r
CROSS JOIN (SELECT 0 AS `seat_no` UNION ALL SELECT 1 UNION ALL SELECT 2
            UNION ALL SELECT 3 UNION ALL SELECT 4) n;
