import { randomUUID } from "node:crypto";
import * as db from "#db";
import * as role from "#shared/role";
import { validId } from "#shared/chatting";

const fail = () => {
  throw Object.assign(new Error("Contact unavailable"), { status: 404 });
};

export const sync = async (id = "") => {
  await db.run(
    `
      UPDATE messenger.contact
      SET handler = NULL, assigned = NULL
      WHERE closed IS NULL
        AND handler IS NOT NULL
        AND (? = ''
          OR room = ?)
        AND NOT EXISTS (SELECT 1
        FROM account.profile
        WHERE uid = messenger.contact.handler
          AND role IN (?, ?)
          AND erased = 0
          AND deletion IS NULL)
    `,
    [id, id, role.root, role.admin]
  );

  await db.run(
    `
      INSERT INTO messenger.member(room, uid)
      SELECT c.room, u.uid
      FROM messenger.contact c
      JOIN account.profile u ON u.uid = c.uid
        OR u.role IN (?, ?)
      WHERE u.erased = 0
        AND u.deletion IS NULL
        AND c.closed IS NULL
        AND (? = ''
          OR c.room = ?)
      ON CONFLICT DO NOTHING
    `,
    [role.root, role.admin, id, id]
  );

  await db.run(
    `
      UPDATE messenger.member
      SET "left" = NULL, reason = NULL
      WHERE room IN (SELECT room
        FROM messenger.contact
        WHERE closed IS NULL
          AND (? = ''
            OR room = ?))
        AND uid IN (SELECT uid
        FROM account.profile
        WHERE role IN (?, ?)
          AND erased = 0
          AND deletion IS NULL)
        AND uid <> (SELECT uid
        FROM messenger.contact
        WHERE messenger.contact.room = messenger.member.room)
    `,
    [id, id, role.root, role.admin]
  );

  await db.run(
    `
      INSERT INTO messenger.receipt(message, uid, read)
      SELECT m.id, r.uid, NULL
      FROM messenger.message m
      JOIN messenger.contact c ON c.room = m.room
      JOIN messenger.member r ON r.room = c.room
      JOIN account.profile u ON u.uid = r.uid
      WHERE r."left" IS NULL
        AND u.erased = 0
        AND u.deletion IS NULL
        AND (u.uid = c.uid
          OR u.role IN (?, ?))
        AND (? = ''
          OR c.room = ?)
      ON CONFLICT DO NOTHING
    `,
    [role.root, role.admin, id, id]
  );
};

const resolve = async (user, id, create) => {
  const viewer = await db.get(
    `
      SELECT uid, role
      FROM account.profile
      WHERE uid = ?
        AND erased = 0
        AND deletion IS NULL
    `,
    [user.uid]
  );

  if (!viewer || (id && !validId(id))) fail();
  let row = await db.get(
    `
      SELECT *
      FROM messenger.contact
      WHERE ${id ? "room = ?" : "uid = ? AND closed IS NULL"}
    `,
    [id || user.uid]
  );

  if (id && (!row || (row.uid !== user.uid && !role.staff(viewer.role)))) fail();

  if (row?.closed) return { id: row.room };

  if (!row && !create) {
    return {
      id: "contact",
      contact: true,
      draft: true,
      available: true,
      requester: { self: true },
      handler: null,
      participants: []
    };
  }

  if (!row) {
    const room = randomUUID();

    await db.run(
      `
        INSERT INTO messenger.room(id, first, second, multiple)
        VALUES(?, ?, ?, 1)
      `,
      [room, user.uid, user.uid]
    );

    await db.run(
      `
        INSERT INTO messenger.contact(room, uid)
        VALUES(?, ?)
      `,
      [room, user.uid]
    );

    row = { room, uid: user.uid };
  }

  await sync(row.room);
  await db.run(
    `
      UPDATE messenger.member
      SET "left" = NULL, reason = NULL
      WHERE room = ?
        AND uid = ?
    `,
    [row.room, user.uid]
  );

  if (row.uid !== user.uid && role.staff(viewer.role)) {
    await db.run(
      `
        UPDATE messenger.contact
        SET handler = ?, assigned = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS')
        WHERE room = ?
          AND handler IS NULL
      `,
      [user.uid, row.room]
    );
  }

  return { id: row.room };
};

export const open = (user, id = "") => db.transaction(() => resolve(user, id, false));

export const ensure = (user) => resolve(user, "", true);
