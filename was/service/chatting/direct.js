import * as crypto from "node:crypto";
import * as ids from "#config/uid";
import * as mention from "#shared/mention";
import secret from "#config/env";
import * as attachment from "#service/chatting/attach";
import * as db from "#db";
import * as settings from "#shared/settings";
import * as events from "#service/events";
import * as media from "#config/media";
import { validId } from "#shared/chatting";
import * as role from "#shared/role";
import * as room from "#service/room";
import * as contact from "#service/contact";

const fail = (status, code) => {
  throw Object.assign(new Error(code), { status, code });
};

const person = (row) => ({
  id: row.id,
  name: row.verified ? row.name || "" : "",
  avatar: media.resolve(row.avatar)
});

const signature = (item) =>
  crypto
    .createHmac("sha256", secret)
    .update(
      "whisper:v1:" +
        JSON.stringify([
          item.token,
          item.id,
          item.recipient,
          item.name,
          item.text,
          item.time,
          item.verified
        ])
    )
    .digest("hex");

export const send = async (
  user,
  kind,
  id,
  text,
  { attachments = [], audio = null, broadcast = true } = {}
) => {
  if (
    !["whisper", "message"].includes(kind) ||
    !(kind === "message"
      ? id === "contact" || validId(id) || /^[a-f0-9]{32}$/.test(id)
      : /^[a-f0-9]{32}$/.test(id)) ||
    typeof text !== "string" ||
    (!text.trim() && !attachments.length && !audio) ||
    (kind === "whisper" && (attachments.length || audio)) ||
    text.length > 2000
  )
    fail(400, "invalid");

  text = mention.omit(text, user.id || ids.publicId(user.uid));
  if (!text.trim() && !attachments.length && !audio) fail(400, "invalid");

  if (kind === "message") {
    const current = id === "contact" || validId(id) ? id : (await room.ensure(user, id)).id;

    return sendRoom(user, current, text, attachments, audio, broadcast);
  }

  const target = await db.get(
    `
      SELECT uid, id, settings
      FROM account.profile
      WHERE id = ?
        AND deletion IS NULL
        AND erased = 0
        AND NOT EXISTS (SELECT 1
        FROM moderation.block
        WHERE moderation.block.uid = account.profile.uid
          OR moderation.block.ip = account.profile.ip)
    `,
    [id]
  );

  if (!target || target.uid === user.uid) fail(404, "unavailable");

  if ((await room.policy(user.uid, target.uid)).unavailable) fail(409, "unavailable");

  if (!settings.read(target.settings)[kind]) fail(409, "refused");

  if (kind === "whisper" && events.state(target.uid) === "offline") fail(409, "offline");
  const sender = await db.get(
    `
      SELECT id, name, avatar, verified
      FROM account.profile
      WHERE uid = ?
        AND deletion IS NULL
        AND erased = 0
    `,
    [user.uid]
  );

  if (!sender) fail(403, "unavailable");

  const item = {
    token: crypto.randomUUID(),
    kind,
    ...person(sender),
    text: text.trim(),
    time: new Date().toISOString(),
    ...(attachments.length && { attachments }),
    ...(audio && { audio: media.resolve(audio) })
  };

  const fresh = await db.get(
    `
      SELECT settings
      FROM account.profile
      WHERE uid = ?
        AND deletion IS NULL
        AND erased = 0
    `,
    [target.uid]
  );

  if (!fresh || !settings.read(fresh.settings).whisper) fail(409, "refused");

  if ((await room.policy(user.uid, target.uid)).unavailable) fail(409, "unavailable");

  if (events.state(target.uid) === "offline") fail(409, "offline");

  if (kind === "whisper") {
    item.recipient = target.id;
    item.verified = Boolean(sender.verified);
    item.proof = signature(item);
  }

  events.send(target.uid, "direct", { ...item, own: false });
  events.send(user.uid, "direct", { ...item, own: true, peer: target.id });

  return { ...item, own: true, peer: target.id };
};

const output = (row, user) => ({
  token: row.id,
  room: row.room,
  kind: "message",
  ...(row.system && { system: JSON.parse(row.system) }),
  id: row.sid,
  name: row.verified ? row.name || "" : "",
  avatar: media.resolve(row.avatar),
  own: row.sender === user.uid,
  time: row.time,
  unseen: row.sender !== user.uid && !row.seen && !row.deleted,
  remaining: row.deleted ? 0 : Number(row.remaining || 0),
  ...(row.deleted && {
    deleted: true,
    ...(user.role === role.root && { retained: true, restorable: true })
  }),
  text: !row.deleted || user.role === role.root ? row.text : "",
  attachments: !row.deleted || user.role === role.root ? attachment.read(row.attachments) : [],
  ...((!row.deleted || user.role === role.root) && row.audio && { audio: media.resolve(row.audio) })
});

async function sendRoom(user, id, text, attachments, audio, broadcast) {
  const item = await db.transaction(async () => {
    if (id === "contact") id = (await contact.ensure(user)).id;

    await contact.sync(id);

    const current = await room.read(user, id);

    if (!current.available) fail(409, "unavailable");

    const users = (await room.members(id)).filter((item) => !item.left && !item.erased);
    const sender = users.find((item) => item.uid === user.uid);
    const recipient = users.find((item) => item.uid !== user.uid);

    if (!sender || sender.deletion) fail(403, "unavailable");
    const token = crypto.randomUUID();
    const time = new Date().toISOString();

    await db.run(
      `
        INSERT INTO messenger.message(id, sender, recipient, room, text, attachments,
          audio, time)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        token,
        user.uid,
        recipient?.uid || user.uid,
        id,
        text.trim(),
        JSON.stringify(attachments),
        audio,
        time
      ]
    );

    for (const member of users)
      await db.run(
        `
          INSERT INTO messenger.receipt(message, uid, read)
          VALUES(?, ?, ?)
        `,
        [token, member.uid, member.uid === user.uid ? time : null]
      );

    return {
      token,
      room: id,
      kind: "message",
      ...person(sender),
      text: text.trim(),
      time,
      attachments,
      ...(audio && { audio: media.resolve(audio) }),
      remaining: users.length - 1
    };
  });

  if (broadcast) await Promise.allSettled([deliver(user, item)]);

  return { ...item, own: true };
}

export async function deliver(user, item) {
  const users = await room.members(item.room);

  for (const member of users) {
    if (member.left) continue;
    const receipt = await db.get(
      `
        SELECT 1
        FROM messenger.receipt
        WHERE message = ?
          AND uid = ?
      `,
      [item.token, member.uid]
    );

    if (receipt)
      events.send(member.uid, "direct", {
        ...item,
        own: member.uid === user.uid,
        ...(member.muted && { muted: true })
      });
  }
}

export const list = async (user, id, before) => {
  if (before !== undefined && !/^\d+$/.test(before)) fail(400, "invalid");
  let current = id;

  if (id && !validId(id)) {
    const value = await room.preview(user, id);

    if (value.draft) {
      return { room: value, items: [], next: null };
    }

    current = value.id;
  }

  await contact.sync(current);
  if (current) await room.find(user, current);

  const rows = current
    ? await db.all(
        `
          SELECT m.*, u.id AS sid, u.name, u.avatar, u.verified, x.read AS seen,
            (SELECT count(*)
            FROM messenger.receipt r
            WHERE r.message = m.id
              AND r.uid <> m.sender
              AND r.read IS NULL) AS remaining
          FROM messenger.message m
          JOIN messenger.receipt x ON x.message = m.id
            AND x.uid = ?
          JOIN account.profile u ON u.uid = m.sender
          WHERE m.room = ?
            AND m.seq < ?
          ORDER BY m.seq DESC
          LIMIT 31
        `,
        [user.uid, current, Number(before) || Number.MAX_SAFE_INTEGER]
      )
    : await db.all(
        `
          SELECT r.id AS rid, rm.pinned, rm.muted, (SELECT id
            FROM messenger.message m
            JOIN messenger.receipt x ON x.message = m.id
            WHERE m.room = r.id
              AND x.uid = ?
              AND (c.room IS NULL
                OR m.system IS NULL
                OR (m.system::jsonb ->> 'type') <> 'leave')
            ORDER BY m.seq DESC
            LIMIT 1) AS token
          FROM messenger.room r
          JOIN messenger.member rm ON rm.room = r.id
          JOIN account.profile viewer ON viewer.uid = rm.uid
          LEFT JOIN messenger.contact c ON c.room = r.id
          WHERE rm.uid = ?
            AND rm."left" IS NULL
            AND (c.room IS NULL
              OR c.closed IS NULL)
            AND (c.room IS NULL
              OR EXISTS (
              SELECT 1
              FROM messenger.message m
              WHERE m.room = r.id
                AND m.system IS NULL ))
            AND (c.room IS NULL
              OR c.uid = viewer.uid
              OR (viewer.role IN (-2, -1)
                AND viewer.erased = 0
                AND viewer.deletion IS NULL))
            AND (r.multiple = 1
              OR EXISTS (
              SELECT 1
              FROM messenger.message m
              WHERE m.room = r.id
                AND m.system IS NULL ))
          ORDER BY (c.room IS NOT NULL) DESC, rm.pinned DESC, coalesce((SELECT max(seq)
              FROM messenger.message
              WHERE room = r.id), 0) DESC, r.id
          LIMIT 31
          OFFSET ?
        `,
        [user.uid, user.uid, Number(before) || 0]
      );
  const items = [];

  for (const row of rows.slice(0, 30)) {
    if (current) {
      items.push(output(row, user));
      continue;
    }

    const info = await room.read(user, row.rid);
    const last = row.token
      ? await db.get(
          `
            SELECT m.*, u.id AS sid, u.name, u.avatar, u.verified
            FROM messenger.message m
            JOIN account.profile u ON u.uid = m.sender
            WHERE m.id = ?
          `,
          [row.token]
        )
      : null;

    const unread = await db.get(
      `
        SELECT count(*) AS count
        FROM messenger.receipt x
        JOIN messenger.message m ON m.id = x.message
        WHERE m.room = ?
          AND x.uid = ?
          AND x.read IS NULL
          AND m.deleted IS NULL
      `,
      [row.rid, user.uid]
    );
    const peer = info.participants.find((item) => !item.self);

    items.push({
      ...(last ? output(last, user) : { text: "", time: "", kind: "message" }),
      room: info.id,
      roomInfo: info,
      peer: info.peer,
      peerName: peer?.name || "",
      peerAvatar: peer?.avatar || null,
      unread: unread.count,
      pinned: Boolean(row.pinned),
      muted: Boolean(row.muted)
    });
  }

  return {
    ...(current && { room: await room.read(user, current) }),
    items,
    next: rows.length > 30 ? String(current ? rows[29].seq : (Number(before) || 0) + 30) : null
  };
};

export const read = async (user, id, token) => {
  const current = validId(id) ? id : (await room.ensure(user, id)).id;

  await room.find(user, current);

  const changed = await db.transaction(async () => {
    const edge = token
      ? await db.get(
          `
            SELECT m.seq
            FROM messenger.message m
            JOIN messenger.receipt x ON x.message = m.id
            WHERE m.id = ?
              AND m.room = ?
              AND x.uid = ?
          `,
          [token, current, user.uid]
        )
      : { seq: Number.MAX_SAFE_INTEGER };

    if (!edge) fail(404, "unavailable");
    const rows = await db.all(
      `
        UPDATE messenger.receipt
        SET read = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS')
        WHERE uid = ?
          AND read IS NULL
          AND message IN (SELECT id
          FROM messenger.message
          WHERE room = ?
            AND seq <= ?)
        RETURNING message
      `,
      [user.uid, current, edge.seq]
    );

    for (const row of rows)
      await db.run(
        `
          UPDATE messenger.message
          SET read = coalesce(read, to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
              'YYYY-MM-DD HH24:MI:SS'))
          WHERE id = ?
        `,
        [row.message]
      );

    return rows;
  });

  events.send(user.uid, "direct-read", { room: current });
  for (let index = 0; index < changed.length; index += 256) {
    const tokens = changed.slice(index, index + 256).map((item) => item.message);
    const counts = {};

    for (const token of tokens)
      counts[token] = (
        await db.get(
          `
            SELECT count(*) AS count
            FROM messenger.receipt r
            JOIN messenger.message m ON m.id = r.message
            WHERE r.message = ?
              AND r.uid <> m.sender
              AND r.read IS NULL
          `,
          [token]
        )
      ).count;
    for (const member of await room.members(current))
      events.send(member.uid, "direct-read", { room: current, tokens, counts });
  }
};

export const unread = async (user) =>
  db.get(
    `
      SELECT count(DISTINCT m.room) AS count
      FROM messenger.receipt x
      JOIN messenger.message m ON m.id = x.message
      JOIN messenger.member r ON r.room = m.room
        AND r.uid = x.uid
      JOIN account.profile u ON u.uid = x.uid
      LEFT JOIN messenger.contact c ON c.room = m.room
      WHERE x.uid = ?
        AND x.read IS NULL
        AND m.deleted IS NULL
        AND r."left" IS NULL
        AND (c.room IS NULL
          OR c.closed IS NULL)
        AND (c.room IS NULL
          OR c.uid = u.uid
          OR (u.role IN (-2, -1)
            AND u.erased = 0
            AND u.deletion IS NULL))
    `,
    [user.uid]
  );

export const capture = async (user, token, items) => {
  if (!Array.isArray(items) || !items.length || items.length > 500) fail(400, "invalid");
  const reporter = await db.get(
    `
      SELECT id
      FROM account.profile
      WHERE uid = ?
    `,
    [user.uid]
  );

  if (!reporter) fail(403, "unavailable");
  const seen = new Set();

  for (const item of items) {
    if (
      !item ||
      typeof item.proof !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.proof) ||
      !crypto.timingSafeEqual(
        Buffer.from(item.proof, "hex"),
        Buffer.from(signature(item), "hex")
      ) ||
      seen.has(item.token)
    )
      fail(400, "invalid");

    seen.add(item.token);
  }

  const target = items.find((item) => item.token === token);

  if (!target || target.recipient !== reporter.id || target.id === reporter.id)
    fail(403, "unavailable");

  if (
    items.some(
      (item) =>
        !(
          (item.id === reporter.id && item.recipient === target.id) ||
          (item.id === target.id && item.recipient === reporter.id)
        )
    )
  )
    fail(403, "unavailable");

  return {
    version: 1,
    kind: "whisper",
    subject: { id: target.id, name: target.name, verified: target.verified },
    messages: items
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((item) => ({
        url: item.token,
        id: item.id,
        name: item.name,
        verified: item.verified,
        text: item.text,
        time: item.time,
        target: item.token === token,
        images: []
      }))
  };
};

export const configure = async (user, id, action, value) => {
  const current = validId(id) ? id : (await room.ensure(user, id)).id;

  if (action === "leave") return room.leave(user, current);

  return room.configure(user, current, action, value);
};

export const restore = async (user, token) => {
  if (!validId(token)) fail(400, "invalid");

  if (user.role !== role.root) fail(403, "unavailable");
  const row = await db.transaction(async () => {
    const target = await db.get(
      `
        SELECT m.room, m.deleted
        FROM messenger.message m
        JOIN messenger.receipt x ON x.message = m.id
          AND x.uid = ?
        WHERE m.id = ?
          AND m.system IS NULL
      `,
      [user.uid, token]
    );

    if (!target) fail(404, "unavailable");

    await room.find(user, target.room, true);
    if (!target.deleted) fail(409, "unavailable");
    const result = await db.run(
      `
        UPDATE messenger.message
        SET deleted = NULL
        WHERE id = ?
          AND deleted IS NOT NULL
          AND EXISTS (SELECT 1
          FROM account.profile
          WHERE uid = ?
            AND role = ?
            AND deletion IS NULL
            AND erased = 0)
      `,
      [token, user.uid, role.root]
    );

    if (!result.changes) fail(403, "unavailable");

    return db.get(
      `
        SELECT m.*, u.id AS sid, u.name, u.avatar, u.verified, (SELECT count(*)
          FROM messenger.receipt x
          WHERE x.message = m.id
            AND x.uid <> m.sender
            AND x.read IS NULL) AS remaining
        FROM messenger.message m
        JOIN account.profile u ON u.uid = m.sender
        WHERE m.id = ?
      `,
      [token]
    );
  });

  const users = await db.all(
    `
      SELECT u.uid, u.role, x.read AS seen
      FROM messenger.receipt x
      JOIN account.profile u ON u.uid = x.uid
      JOIN messenger.member r ON r.uid = u.uid
        AND r.room = ?
        AND r."left" IS NULL
      LEFT JOIN messenger.contact c ON c.room = r.room
      WHERE x.message = ?
        AND u.erased = 0
        AND u.deletion IS NULL
        AND (c.room IS NULL
          OR c.uid = u.uid
          OR u.role IN (-2, -1))
    `,
    [row.room, token]
  );

  for (const recipient of users) {
    events.send(
      recipient.uid,
      "direct-restore",
      output({ ...row, seen: recipient.seen }, recipient)
    );

    events.send(recipient.uid, "direct-change", { room: row.room });
  }

  return output({ ...row, seen: users.find((item) => item.uid === user.uid)?.seen }, user);
};

export const remove = async (user, token) => {
  if (!validId(token)) fail(400, "invalid");
  const target = await db.get(
    `
      SELECT room
      FROM messenger.message
      WHERE id = ?
    `,
    [token]
  );

  if (!target) fail(404, "unavailable");

  await room.find(user, target.room);

  const row = await db.get(
    `
      UPDATE messenger.message
      SET deleted = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
        'YYYY-MM-DD HH24:MI:SS')
      WHERE id = ?
        AND sender = ?
        AND system IS NULL
        AND deleted IS NULL
        AND NOT EXISTS (SELECT 1
        FROM messenger.receipt r
        WHERE r.message = messenger.message.id
          AND r.uid <> messenger.message.sender
          AND r.read IS NOT NULL)
      RETURNING room, time
    `,
    [token, user.uid]
  );

  if (!row) fail(409, "unavailable");
  const users = await db.all(
    `
      SELECT u.uid, u.role
      FROM messenger.receipt r
      JOIN account.profile u ON u.uid = r.uid
      JOIN messenger.message m ON m.id = r.message
      LEFT JOIN messenger.contact c ON c.room = m.room
      WHERE r.message = ?
        AND (c.room IS NULL
          OR c.uid = u.uid
          OR (u.role IN (-2, -1)
            AND u.erased = 0
            AND u.deletion IS NULL))
    `,
    [token]
  );

  for (const member of users)
    events.send(member.uid, "direct-remove", {
      token,
      room: row.room,
      retained: member.role === role.root,
      time: row.time
    });

  return { retained: user.role === role.root };
};
