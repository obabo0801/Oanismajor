import * as cluster from "#service/cluster";
import { randomUUID } from "node:crypto";
import * as db from "../../db/index.js";
import * as ids from "#config/uid";
import * as media from "../config/media.js";
import * as role from "../../lib/role.js";
import * as rules from "../../lib/chatting.js";
import * as events from "./events.js";
import { filters } from "../../lib/history.js";
import { read } from "./chatting/attach.js";
import * as mentions from "../../lib/mention.js";
import * as push from "./push.js";
import * as settings from "#shared/settings";
import { locale } from "#service/locale";
import * as rooms from "./chatting/room.js";
import { initial } from "#shared/room";

const fail = (status) => {
  throw Object.assign(new Error("Chatting request rejected"), { status });
};

export const viewer = async (uid, ip, development = false) => {
  const user = await db.get(
    `
      SELECT uid, role, verified, (SELECT muted
        FROM moderation.sanction
        WHERE uid = account.profile.uid) AS muted, (SELECT notice
        FROM moderation.sanction
        WHERE uid = account.profile.uid) AS notice
      FROM account.profile
      WHERE uid = ?
        AND deletion IS NULL
        AND erased = 0
        AND NOT EXISTS (SELECT 1
        FROM moderation.block
        WHERE uid = account.profile.uid
          OR ip = ?)
        AND NOT EXISTS (SELECT 1
        FROM moderation.sanction
        WHERE uid = account.profile.uid
          AND kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS'))
    `,
    [uid, ip]
  );

  if (!user) fail(403);

  if (process.env.MAINTENANCE === "true" && !development && !role.staff(user.role)) fail(503);

  return user;
};

const blocked = `EXISTS (
  SELECT 1 FROM moderation.block WHERE moderation.block.uid = account.profile.uid OR moderation.block.ip = account.profile.ip
)`;

const select = `
  SELECT chatting.message.*, account.profile.id AS public, account.profile.name,
    account.profile.avatar, account.profile.verified, account.profile.role AS author_role,
    ${blocked} AS blocked
  FROM chatting.message
  LEFT JOIN account.profile ON account.profile.uid = chatting.message.uid
`;

export const visible = (user, table = "chatting.message") => {
  const deleted = user.role === role.root ? "TRUE" : "chatting.message.deleted IS NULL";

  const access = role.staff(user.role)
    ? "(chatting.message.system IS NOT NULL OR account.profile.uid IS NOT NULL)"
    : `((chatting.message.system IS NULL
        AND account.profile.uid IS NOT NULL
        AND NOT ${blocked})
      OR (chatting.message.system::jsonb ->> 'action') IN ('mute','kick','block'))`;

  const room = rooms.visible(user);

  return `(${access}) AND (${deleted}) AND (${room})`.replaceAll("chatting.message.", `${table}.`);
};

const removable = (viewer, target) =>
  viewer.uid === target.uid || viewer.role === role.root || role.manages(viewer, target);

const message = (row, user) => {
  if (row.system) {
    const { action, count } = JSON.parse(row.system);

    return {
      seq: row.seq,
      room: row.room,
      url: row.id,
      id: "",
      own: false,
      system: action,
      text: rules.notices[action].text,
      name: row.text,
      ...(count !== undefined && { count }),
      time: row.time
    };
  }

  return {
    seq: row.seq,
    room: row.room,
    url: row.id,
    id: row.public || ids.publicId(row.uid),
    name: row.verified ? row.name || "" : "",
    avatar: media.resolve(row.avatar),
    ...(row.audio && { audio: media.resolve(row.audio) }),
    text: row.text,
    mentioned: row.uid !== user.uid && mentions.ids(row.text).includes(ids.publicId(user.uid)),
    ...(row.attachments && { attachments: read(row.attachments) }),
    ...(row.image && {
      image: media.resolve(row.image),
      preview: media.resolve(row.preview || row.image)
    }),
    time: row.time,
    own: row.uid === user.uid,
    removable: !row.deleted && removable(user, { uid: row.uid, role: row.author_role }),
    ...(user.role === role.root &&
      row.deleted && { deleted: true, deletedAt: row.deleted, restorable: true }),
    ...(role.staff(user.role) && { blocked: Boolean(row.blocked) })
  };
};

export const system = async (write, user, action, count, time, room = initial) => {
  if (!Object.hasOwn(rules.notices, action)) fail(400);
  const id = randomUUID();
  const text = user.name || "";
  const data = JSON.stringify({ action, ...(action === "mute" && { count }) });
  const result = await write(
    `
      INSERT INTO chatting.message (id, room, uid, text, system, time)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING seq
    `,
    [id, room, user.uid, text, data, time]
  );

  return message({ seq: result.id, id, room, text, system: data, time });
};

const integer = (value) => {
  if (!["string", "number"].includes(typeof value)) fail(400);

  if (!/^(0|[1-9]\d*)$/.test(String(value))) fail(400);
  const number = Number(value);

  if (!Number.isSafeInteger(number)) fail(400);

  return number;
};

export const restriction = (user) => {
  const notice = user.notice ? JSON.parse(user.notice) : null;

  return {
    until: user.muted || null,
    ...(notice && {
      handler: ids.publicName(notice.handler),
      reason: notice.reason || "",
      seconds: notice.seconds
    })
  };
};

export const list = async (user, query = {}, uid) =>
  db.read(async () => {
    if (user.room) await rooms.read(user, user.room);
    const { search } = filters(query);
    const count = query.limit === undefined ? rules.size : integer(query.limit);

    if (!count || (query.before !== undefined && query.after !== undefined)) fail(400);
    const limit = Math.min(count, rules.maximum);
    const high = (
      await db.get(
        `
      SELECT COALESCE(MAX(seq), 0) AS seq
      FROM chatting.message
      WHERE (?::uuid IS NULL OR room = ?::uuid)
    `,
        [user.room || null, user.room || null]
      )
    ).seq;
    const conditions = [visible(user), "chatting.message.seq <= ?"];
    const params = [high];

    if (user.room) {
      conditions.push("chatting.message.room = ?");
      params.push(user.room);
    }
    const forward = query.after !== undefined;

    if (query.live === "1" && !user.verified && !role.staff(user.role) && uid === undefined) {
      return {
        messages: [],
        muted: user.muted || null,
        restriction: restriction(user),
        history: false,
        more: false,
        cursor: high
      };
    }

    if (uid !== undefined) {
      conditions.push("chatting.message.uid = ? AND chatting.message.system IS NULL");

      params.push(uid);
    }

    if (query.before !== undefined || forward) {
      conditions.push(`chatting.message.seq ${forward ? ">" : "<"} ?`);
      params.push(integer(forward ? query.after : query.before));
    }

    if (query.date !== undefined) {
      const range = rules.date(query.date);

      if (!range) fail(400);

      conditions.push("chatting.message.time >= ? AND chatting.message.time < ?");
      params.push(...range);
    }

    if (search) {
      conditions.push("strpos(lower(chatting.message.text), lower(?)) > 0");
      params.push(search);
    }

    const total =
      uid !== undefined &&
      query.before === undefined &&
      !forward &&
      (search || query.date !== undefined)
        ? (
            await db.get(
              `
              SELECT COUNT(*) AS total
              FROM chatting.message
              JOIN account.profile ON account.profile.uid = chatting.message.uid
              WHERE ${conditions.join(" AND ")}
            `,
              params
            )
          ).total
        : undefined;

    const rows = await db.all(
      `${select} WHERE ${conditions.join(" AND ")}
      ORDER BY chatting.message.seq ${forward ? "ASC" : "DESC"} LIMIT ?`,
      [...params, limit + 1]
    );
    const more = rows.length > limit;
    const page = rows.slice(0, limit);

    if (!forward) page.reverse();

    return {
      messages: page.map((row) => message(row, user)),
      muted: user.muted || null,
      restriction: restriction(user),
      history: Boolean(user.verified || role.staff(user.role)),
      ...(total !== undefined && { total }),
      more,
      cursor: forward && more ? page.at(-1).seq : high
    };
  });

export const recent = async (user, query = {}) =>
  db.read(async () => {
    if (user.room) await rooms.read(user, user.room);

    if (user.verified || role.staff(user.role)) return list(user, query);

    const high = (
      await db.get(
        `
      SELECT COALESCE(MAX(seq), 0) AS seq
      FROM chatting.message
      WHERE (?::uuid IS NULL OR room = ?::uuid)
    `,
        [user.room || null, user.room || null]
      )
    ).seq;

    const conditions = [
      visible(user),
      "chatting.message.seq <= ?",
      "chatting.message.time >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul') + '-30 minutes'::interval, 'YYYY-MM-DD HH24:MI:SS')"
    ];
    const params = [high];

    if (user.room) {
      conditions.push("chatting.message.room = ?");
      params.push(user.room);
    }

    if (query.before !== undefined && query.after !== undefined) fail(400);
    for (const key of ["before", "after"]) {
      if (query[key] === undefined) continue;

      conditions.push(`chatting.message.seq ${key === "before" ? "<" : ">"} ?`);
      params.push(integer(query[key]));
    }

    const forward = query.after !== undefined;
    const rows = await db.all(
      `${select} WHERE ${conditions.join(" AND ")}
      ORDER BY chatting.message.seq ${forward ? "ASC" : "DESC"} LIMIT ?`,
      [...params, rules.maximum + 1]
    );
    const page = rows.slice(0, rules.maximum);
    const more = rows.length > rules.maximum;

    if (!forward) page.reverse();

    return {
      messages: page.map((row) => message(row, user)),
      muted: user.muted || null,
      restriction: restriction(user),
      history: false,
      more: forward && more,
      next: !forward && more ? page[0].seq : null,
      cursor: forward && more ? page.at(-1).seq : high
    };
  });

export const around = async (user, id) =>
  db.read(async () => {
    if (!rules.validId(id)) fail(400);
    const row = await db.get(`${select} WHERE chatting.message.id = ? AND ${visible(user)}`, [id]);

    if (!row) fail(404);

    await rooms.message(user, id, user.room);

    const current = { ...user, room: row.room };
    const before = await list(current, { before: row.seq, limit: 20 });
    const after = await list(current, { after: row.seq, limit: 20 });

    return {
      messages: [...before.messages, message(row, user), ...after.messages],
      muted: user.muted || null,
      restriction: restriction(user),
      history: Boolean(user.verified || role.staff(user.role)),
      before: before.more,
      after: after.more,
      cursor: before.cursor
    };
  });

export const writable = async (user) => {
  if (user.room) await rooms.read(user, user.room, true);
  const mute = await db.get(
    `
      SELECT muted, notice
      FROM moderation.sanction
      WHERE uid = ?
        AND muted > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
        'YYYY-MM-DD HH24:MI:SS')
    `,
    [user.uid]
  );

  if (mute)
    throw Object.assign(new Error("Chatting muted"), {
      status: 423,
      until: mute.muted,
      restriction: restriction(mute)
    });
};

export const save = async (user, ip, text, image = null, audio = null, attachments = []) =>
  db.transaction(async () => {
    await rooms.read(user, user.room, true);
    if (
      typeof text !== "string" ||
      (!text.trim() && !image && !audio && !attachments.length) ||
      text.length > rules.length
    )
      fail(400);

    await writable(user);

    const id = randomUUID();
    const result = await db.run(
      `
      INSERT INTO chatting.message (id, room, uid, text, image, preview, audio, attachments)
      SELECT ?, ?, uid, ?, ?, ?, ?, ?
      FROM account.profile
      WHERE uid = ?
        AND NOT EXISTS (SELECT 1
        FROM moderation.block
        WHERE uid = account.profile.uid
          OR ip = ?)
        AND NOT EXISTS (SELECT 1
        FROM moderation.sanction
        WHERE uid = account.profile.uid
          AND (muted > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS')
            OR kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS')))
    `,
      [
        id,
        user.room,
        mentions.omit(text.trim(), user.id || ids.publicId(user.uid)),
        image?.original || null,
        image?.cache || null,
        audio,
        attachments.length ? JSON.stringify(attachments) : null,
        user.uid,
        ip
      ]
    );

    if (!result.changes) fail(403);
    const row = await db.get(`${select} WHERE chatting.message.id = ?`, [id]);

    return message(row, user);
  });

export const deliver = async (id, skip, relay = true) => {
  if (relay) await cluster.emit("chatting", { id, skip });

  await events.publish("chatting", async (client) => {
    if (client.uid === skip || !client.room) return null;
    const user = await viewer(client.uid, client.ip, client.development);
    const row = await db.get(`${select} WHERE chatting.message.id = ? AND ${visible(user)}`, [id]);

    if (!row || row.room !== client.room) return null;

    await rooms.read(user, row.room);
    return message(row, user);
  });

  if (relay) await Promise.allSettled([notify(id)]);
};

export const suggest = async (query = "", lang = "ko", uid) => {
  if (typeof query !== "string" || query.length > 80) fail(400);
  const anonymous = (locale(lang) || locale("ko"))?.["profile.anonymous"] || "{id}";

  const rows = await db.all(
    `
      SELECT uid, id, CASE WHEN verified THEN name END AS name,
        avatar, verified
      FROM account.profile
      WHERE id IS NOT NULL
        AND NOT ${blocked}
        AND NOT EXISTS (SELECT 1
        FROM moderation.sanction
        WHERE uid = account.profile.uid
          AND kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS'))
      ORDER BY name
    `
  );

  return {
    items: mentions
      .rank(
        rows
          .filter((user) => user.uid !== uid && events.state(user.uid) !== "offline")
          .map((user) => ({
            ...user,
            label: user.name || anonymous.replace("{id}", user.id.slice(0, 8)),
            value: user.id
          })),
        query
      )
      .map(({ uid, id, name, avatar, verified }) => ({
        id,
        name: name || "",
        verified: Boolean(verified),
        avatar: media.resolve(avatar),
        state: events.state(uid)
      }))
  };
};

async function notify(id) {
  if (!push.enabled) return;
  const row = await db.get(`${select} WHERE chatting.message.id = ?`, [id]);

  if (!row || row.deleted || row.system || row.blocked) return;
  const ids = mentions.ids(row.text);

  const recipients = await db.all(
    `
      SELECT uid, id, ip, lang, settings
      FROM account.profile
      WHERE (id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"})
          OR (settings::jsonb ->> 'chat') = 'true')
        AND uid <> ?
        AND NOT ${blocked}
        AND NOT EXISTS (SELECT 1
        FROM moderation.sanction
        WHERE uid = account.profile.uid
          AND kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS'))
    `,
    [...ids, row.uid]
  );

  await Promise.allSettled(
    recipients.map(async (user) => {
      if (!settings.allows(settings.read(user.settings), ids.includes(user.id), true)) return;

      if (events.viewing(user.uid)) return;

      const recipient = await viewer(user.uid, user.ip);

      await rooms.read(recipient, row.room);

      const rows = await db.all(
        `
          SELECT endpoint, data
          FROM push.web
          WHERE uid = ?
            AND active = 1
            AND connected = 1
        `,
        [user.uid]
      );

      const anonymous = (locale(user.lang) || locale("ko"))?.["profile.anonymous"] || "{id}";

      await push.send(rows, {
        title:
          row.verified && row.name ? row.name : anonymous.replace("{id}", row.public.slice(0, 8)),
        body: mentions.plain(row.text).slice(0, 180),
        url: `/rooms/${row.room}?message=${id}`,
        tag: `mention:${id}`
      });
    })
  );
}

const removed = async (id, relay = true) => {
  if (relay) await cluster.emit("removed", { id });
  return events.publish("chatting-remove", async (client) => {
    const user = await viewer(client.uid, client.ip, client.development);
    const room = await rooms.message(user, id);

    if (client.room !== room.id) return null;

    if (user.role !== role.root) {
      return { id };
    }

    const row = await db.get(`${select} WHERE chatting.message.id = ?`, [id]);

    return row ? { id, message: message(row, user) } : { id };
  });
};

export const restore = async (user, id) => {
  if (!rules.validId(id)) fail(400);

  await rooms.message(user, id, user.room);

  if (user.role !== role.root) fail(403);
  const row = await db.transaction(async () => {
    const target = await db.get(
      `
        SELECT deleted
        FROM chatting.message
        WHERE id = ?
          AND system IS NULL
      `,
      [id]
    );

    if (!target) fail(404);

    if (!target.deleted) fail(409);
    const result = await db.run(
      `
        UPDATE chatting.message
        SET deleted = NULL, handler = NULL
        WHERE id = ?
          AND deleted IS NOT NULL
          AND system IS NULL
          AND EXISTS (SELECT 1
          FROM account.profile
          WHERE uid = ?
            AND role = ?
            AND deletion IS NULL
            AND erased = 0)
      `,
      [id, user.uid, role.root]
    );

    if (!result.changes) fail(403);

    return db.get(`${select} WHERE chatting.message.id = ?`, [id]);
  });

  await restored(id);

  return message(row, user);
};

export const remove = async (viewer, id) => {
  if (!rules.validId(id)) {
    fail(400);
  }

  await rooms.message(viewer, id, viewer.room);

  const target = await db.get(
    `
      SELECT chatting.message.uid, chatting.message.deleted, account.profile.role
      FROM chatting.message
      LEFT JOIN account.profile ON account.profile.uid = chatting.message.uid
      WHERE chatting.message.id = ?
        AND chatting.message.system IS NULL
    `,
    [id]
  );

  if (!target) {
    fail(404);
  }

  if (!removable(viewer, target)) {
    fail(403);
  }

  if (!target.deleted) {
    await db.run(
      `
        UPDATE chatting.message
        SET deleted = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS'), handler = ?
        WHERE id = ?
          AND deleted IS NULL
      `,
      [viewer.uid, id]
    );
  }

  await removed(id);

  return { id, retained: viewer.role === role.root };
};

async function restored(id, relay = true) {
  if (relay) await cluster.emit("restored", { id });
  return events.publish("chatting-restore", async (client) => {
    const recipient = await viewer(client.uid, client.ip, client.development);
    const room = await rooms.message(recipient, id);

    if (client.room !== room.id) return null;
    const current = await db.get(
      `${select} WHERE chatting.message.id = ? AND ${visible(recipient)}`,
      [id]
    );

    return current ? message(current, recipient) : null;
  });
}
cluster.on("chatting", ({ id, skip }) => deliver(id, skip, false));
cluster.on("removed", ({ id }) => removed(id, false));
cluster.on("restored", ({ id }) => restored(id, false));
