import { randomBytes } from "node:crypto";
import * as db from "#db";
import connect, { exclusive } from "#db/connect";
import * as path from "#config/path";
import * as evidence from "#service/evidence";
import * as events from "#service/events";
import * as profile from "#service/profile";
import * as media from "#config/media";
import * as history from "#service/history";
import * as rooms from "#service/room";
import * as attachment from "#service/chatting/attach";
import { publicId } from "#config/uid";

const temporary = connect("runtime");

const week = 7 * 86400000;
const jobs = new Map();

export const request = async (uid) => {
  const user = await db.get(
    `
      UPDATE account.profile
      SET deletion = COALESCE(deletion, ?), session = NULL, recovery = NULL,
        expires = NULL
      WHERE uid = ?
        AND verified
        AND erased = 0
      RETURNING id, deletion
    `,
    [Date.now() + week, uid]
  );

  if (!user) return null;

  await profile.disconnect(uid);
  events.disconnect(uid);
  await db.run(
    `
      UPDATE push.web
      SET connected = 0
      WHERE uid = ?
    `,
    [uid]
  );

  await db.run(
    `
      DELETE
      FROM push.fcm
      WHERE uid = ?
    `,
    [uid]
  );

  events.broadcast("online");

  return user;
};

export const challenge = async (uid) => {
  const token = randomBytes(32).toString("base64url");
  const result = await db.run(
    `
      UPDATE account.profile
      SET recovery = ?, expires = ?
      WHERE uid = ?
        AND deletion > ?
        AND erased = 0
    `,
    [token, Date.now() + 600000, uid, Date.now()]
  );

  return result.changes ? token : "";
};

export const pending = (token) =>
  typeof token === "string"
    ? db.get(
        `
          SELECT uid, deletion
          FROM account.profile
          WHERE recovery = ?
            AND expires > ?
            AND deletion > ?
            AND erased = 0
        `,
        [token, Date.now(), Date.now()]
      )
    : null;

export const restore = (token) =>
  typeof token === "string"
    ? db.get(
        `
          UPDATE account.profile
          SET deletion = NULL, recovery = NULL, expires = NULL, session = NULL
          WHERE recovery = ?
            AND expires > ?
            AND deletion > ?
            AND erased = 0
          RETURNING uid
        `,
        [token, Date.now(), Date.now()]
      )
    : null;

const logs = async (uid, collect = false, files) => {
  const records = [];
  const log = connect("audit");

  for (const name of ["access", "block", "sanction", "notify", "stt", "tts"]) {
    if (collect) {
      if (!["block", "sanction"].includes(name)) continue;
      const rows = await log.all(
        `
          SELECT rowid, action, reason, time
          FROM ${name}
          WHERE uid = ?
        `,
        [uid]
      );

      records.push(
        ...rows.map((row) => ({
          source: `audit/${name}/${row.rowid}`,
          kind: row.action,
          reason: row.reason,
          time: row.time
        }))
      );
    } else {
      await log.run(
        `
          DELETE
          FROM ${name}
          WHERE uid = ?
        `,
        [uid]
      );

      if (name === "notify" && files) {
        const rows = await log.all(`
          SELECT image, body, url
          FROM notify
        `);

        for (const row of rows)
          for (const value of [row.image, row.body, row.url])
            for (const file of value?.match(/[a-f0-9]{32}\.[a-z0-9]+/g) || []) files.add(file);
      }

      if (["block", "sanction"].includes(name)) {
        await log.run(
          `
            UPDATE ${name}
            SET actor = '', handler = ''
            WHERE actor = ?
          `,
          [uid]
        );

        const id = publicId(uid);
        const rows = await log.all(
          `
            SELECT rowid, snapshot
            FROM ${name}
            WHERE strpos(snapshot, ?) > 0
          `,
          [id]
        );

        for (const row of rows)
          await log.run(
            `
              UPDATE ${name}
              SET snapshot = ?
              WHERE rowid = ?
            `,
            [history.redact(row.snapshot, id), row.rowid]
          );
      }
    }
  }
  return records;
};

const erase = async (uid) => {
  const user = await db.get(
    `
      SELECT *
      FROM account.profile
      WHERE uid = ?
        AND deletion <= ?
        AND erased = 0
    `,
    [uid, Date.now()]
  );

  if (!user) return;

  events.disconnect(uid);

  const records = await logs(uid, true);
  const reports = await db.all(
    `
      SELECT id, reason, time
      FROM moderation.report
      WHERE target = ?
    `,
    [uid]
  );

  records.push(
    ...reports.map((row) => ({
      source: `report/${row.id}`,
      kind: "report",
      reason: row.reason,
      time: row.time
    }))
  );

  const blocks = await db.all(
    `
      SELECT rowid, reason, time
      FROM moderation.block
      WHERE uid = ?
    `,
    [uid]
  );

  records.push(
    ...blocks.map((row) => ({
      source: `block/${row.rowid}`,
      kind: "block",
      reason: row.reason,
      time: row.time
    }))
  );

  await evidence.save(user, records);

  const retained = new Set();

  await logs(uid, false, retained);
  await evidence.forget(uid);

  const condition = `sender = ? OR (recipient = ? AND room IN
    (SELECT id FROM messenger.room WHERE multiple = 0))`;

  await db.transaction(async () => {
    await db.run(
      `
        DELETE
        FROM messenger.asset
        WHERE seq IN (SELECT seq
          FROM messenger.message
          WHERE ${condition})
      `,
      [uid, uid]
    );

    await db.run(
      `
        DELETE
        FROM messenger.receipt
        WHERE uid = ?
          OR message IN (SELECT id
          FROM messenger.message
          WHERE ${condition})
      `,
      [uid, uid, uid]
    );

    await db.run(
      `
        DELETE
        FROM messenger.message
        WHERE ${condition}
      `,
      [uid, uid]
    );
  });

  const files = await db.all(
    `
      SELECT file
      FROM account.file
      WHERE uid = ?
    `,
    [uid]
  );

  const chats = await db.all(
    `
      SELECT id, image, preview, audio, attachments
      FROM chatting.message
      WHERE uid = ?
    `,
    [uid]
  );
  const draft = JSON.parse(user.draft || "null");

  for (const file of new Set([
    ...files.map((item) => item.file),
    ...chats.flatMap((item) => [
      item.image,
      item.preview,
      item.audio,
      ...attachment.read(item.attachments).flatMap((item) => [item.image, item.preview, item.file])
    ]),
    user.image,
    user.avatar,
    draft?.image,
    draft?.avatar
  ])) {
    const url = media.resolve(file);
    const route = media.routes.find((item) => url.startsWith(`${item.prefix}/`));

    if (!route) continue;
    const name = url.slice(route.prefix.length + 1);

    if (!/^[a-f0-9]{32}\.(?:jpg|png|gif|webp|mp3|webm|ogg|m4a|bin)$/.test(name)) continue;

    if (retained.has(name)) continue;
    const shared = await db.get(
      `
        SELECT 1
        FROM account.profile
        WHERE uid <> ?
          AND (strpos(COALESCE(image, ''), ?) > 0
            OR strpos(COALESCE(avatar, ''), ?) > 0
            OR strpos(COALESCE(draft, ''), ?) > 0)
        UNION ALL
        SELECT 1
        FROM account.file
        WHERE uid <> ?
          AND strpos(file, ?) > 0
        UNION ALL
        SELECT 1
        FROM chatting.message
        WHERE uid <> ?
          AND (strpos(text, ?) > 0
            OR strpos(COALESCE(attachments, ''), ?) > 0
            OR strpos(COALESCE(image, ''), ?) > 0
            OR strpos(COALESCE(preview, ''), ?) > 0
            OR strpos(COALESCE(audio, ''), ?) > 0)
        UNION ALL
        SELECT 1
        FROM messenger.message
        WHERE (strpos(text, ?) > 0
            OR strpos(COALESCE(attachments, ''), ?) > 0
            OR strpos(COALESCE(audio, ''), ?) > 0)
        UNION ALL
        SELECT 1
        FROM storage.upload
        WHERE uid <> ?
          AND file = ?
        LIMIT 1
      `,
      [
        uid,
        name,
        name,
        name,
        uid,
        name,
        uid,
        name,
        name,
        name,
        name,
        name,
        name,
        name,
        name,
        uid,
        `${route.directory}/${name}`
      ]
    );

    if (!shared) await path.rm(path.upload(route.directory, name), { force: true });
  }

  await db.transaction(async () => {
    await db.run(
      `
        DELETE
        FROM chatting.asset
        WHERE seq IN (SELECT seq
          FROM chatting.message
          WHERE uid = ?)
      `,
      [uid]
    );

    await db.run(
      `
        DELETE
        FROM chatting.message
        WHERE uid = ?
      `,
      [uid]
    );
  });

  for (const { id } of chats) events.broadcast("chatting-remove", { id });

  await db.run(
    `
      DELETE
      FROM account.file
      WHERE uid = ?
    `,
    [uid]
  );

  for (const folder of ["stt", "tts"]) {
    const cached = await db.all(
      `
        SELECT file
        FROM storage.${folder}
        WHERE uid = ?
      `,
      [uid]
    );

    for (const { file } of cached) {
      if (!/^[a-f0-9]{32}\.(?:mp3|webm|ogg|m4a)$/.test(file)) continue;
      const shared = await db.get(
        `
          SELECT 1
          FROM storage.${folder}
          WHERE file = ?
            AND uid <> ?
          LIMIT 1
        `,
        [file, uid]
      );

      if (!shared) await path.rm(path[folder](file), { force: true });
    }
  }

  for (const table of [
    "push.web",
    "push.fcm",
    "moderation.sanction",
    "moderation.block",
    "account.authority",
    "storage.stt",
    "storage.tts",
    "storage.upload"
  ])
    await db.run(
      `
        DELETE
        FROM ${table}
        WHERE uid = ?
      `,
      [uid]
    );
  await db.run(
    `
      DELETE
      FROM moderation.report
      WHERE target = ?
        OR reporter = ?
    `,
    [uid, uid]
  );

  await db.run(
    `
      DELETE
      FROM messenger.conversation
      WHERE uid = ?
        OR peer = ?
    `,
    [uid, uid]
  );

  await db.run(
    `
      DELETE
      FROM account.block
      WHERE uid = ?
        OR peer = ?
    `,
    [uid, uid]
  );

  const memberships = await db.all(
    `
      SELECT room
      FROM messenger.member
      WHERE uid = ?
    `,
    [uid]
  );

  for (const { room } of memberships) {
    await db.transaction(async () => {
      const current = await db.get(
        `
          SELECT *
          FROM messenger.room
          WHERE id = ?
        `,
        [room]
      );

      const successor = await db.get(
        `
          SELECT m.uid
          FROM messenger.member m
          JOIN account.profile u ON u.uid = m.uid
          WHERE m.room = ?
            AND m.uid <> ?
            AND m."left" IS NULL
            AND u.erased = 0
            AND u.deletion IS NULL
          ORDER BY m.uid
          LIMIT 1
        `,
        [room, uid]
      );

      if (!current) return;

      if (!current.multiple || !successor)
        await db.run(
          `
            UPDATE messenger.room
            SET closed = coalesce(closed, to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
                'YYYY-MM-DD HH24:MI:SS'))
            WHERE id = ?
          `,
          [room]
        );

      if (current.owner === uid) {
        await db.run(
          `
            UPDATE messenger.room
            SET owner = ?
            WHERE id = ?
          `,
          [successor?.uid || null, room]
        );

        if (successor)
          await db.run(
            `
              UPDATE messenger.member
              SET deputy = 0
              WHERE room = ?
                AND uid = ?
            `,
            [room, successor.uid]
          );
      }

      await db.run(
        `
          UPDATE messenger.member
          SET "left" = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS'), reason = 'account', deputy = 0
          WHERE room = ?
            AND uid = ?
        `,
        [room, uid]
      );
    });

    await rooms.notify(room);
  }

  const snapshots = await db.all(
    `
      SELECT seq, snapshot
      FROM moderation.report
      WHERE strpos(snapshot, ?) > 0
    `,
    [user.id]
  );

  for (const row of snapshots)
    await db.run(
      `
        UPDATE moderation.report
        SET snapshot = ?
        WHERE seq = ?
      `,
      [history.redact(row.snapshot, user.id), row.seq]
    );
  for (const table of ["moderation.block", "account.authority"])
    await db.run(
      `
        UPDATE ${table}
        SET actor = NULL, handler = NULL
        WHERE actor = ?
      `,
      [uid]
    );
  await db.run(
    `
      UPDATE account.profile
      SET google = NULL, soop = NULL, email = NULL, name = NULL, avatar = NULL, image = NULL,
        draft = NULL, consent = NULL, settings = NULL, renamed = NULL,
        session = NULL, recovery = NULL, expires = NULL, deletion = NULL,
        setup = 0, role = 0, ip = '', initial = NULL, lang = NULL, date = '',
        erased = 1
      WHERE uid = ?
        AND deletion <= ?
    `,
    [uid, Date.now()]
  );

  await db.run(
    `
      DELETE
      FROM account.profile
      WHERE uid = ?
        AND erased = 1
        AND NOT EXISTS (SELECT 1
        FROM chatting.message
        WHERE chatting.message.uid = account.profile.uid)
    `,
    [uid]
  );

  events.broadcast("profile-update", { id: user.id });
};

export const finalize = (uid) => {
  if (!jobs.has(uid))
    jobs.set(
      uid,
      exclusive(`account:${uid}`, () => erase(uid)).finally(() => jobs.delete(uid))
    );

  return jobs.get(uid);
};

let running;

export const clean = () =>
  (running ||= exclusive(
    "account:cleanup",
    async () => {
      await temporary.run(`
        DELETE
        FROM runtime.limiter
        WHERE expires <= clock_timestamp()
      `);

      await temporary.run(`
        DELETE
        FROM runtime.link
        WHERE expires <= clock_timestamp()
      `);

      await temporary.run(
        `
          DELETE
          FROM runtime.attachment
          WHERE expires <= ?
        `,
        [Date.now()]
      );

      const rows = await db.all(
        `
          SELECT uid
          FROM account.profile
          WHERE deletion <= ?
            AND erased = 0
        `,
        [Date.now()]
      );

      let failed = false;

      for (const { uid } of rows) {
        try {
          await finalize(uid);
        } catch {
          failed = true;
        }
      }

      await evidence.clean();
      await db.run(
        `
          UPDATE account.profile
          SET recovery = NULL, expires = NULL
          WHERE expires <= ?
        `,
        [Date.now()]
      );

      if (failed) throw new Error("Account cleanup incomplete");
    },
    false
  ).finally(() => {
    running = undefined;
  }));

export const start = async () => {
  void clean().catch(() => console.error("Account cleanup failed; retry scheduled"));
  setInterval(() => {
    clean().catch(() => console.error("Account cleanup failed; retry scheduled"));
  }, 60000).unref();
};
