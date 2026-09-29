import { stat } from "node:fs/promises";
import * as audio from "#service/audio";
import * as db from "#db";
import * as path from "#config/path";
import * as media from "#config/media";
import * as attachment from "#service/chatting/attach";
import { visible } from "#service/chatting";
import metadata from "#service/metadata";
import * as rooms from "#service/room";
import * as publicroom from "./room.js";
import { parse } from "#shared/link";
import * as role from "#shared/role";
import * as rules from "#shared/chatting";
import * as formats from "#shared/attach";
import * as events from "#service/events";
import * as cluster from "#service/cluster";
import { viewer } from "#service/chatting";

const indexes = new Map();

async function changed(value, relay = true) {
  if (relay) await cluster.emit("attachment", value);
  return events.publish("chatting-attachment", async (client) => {
    try {
      const user = await viewer(client.uid, client.ip, client.development);

      if (value.private) {
        await rooms.read(user, value.room);

        const receipt = await db.get(
          `SELECT 1 FROM messenger.receipt WHERE message = ? AND uid = ?`,
          [value.id, user.uid]
        );

        return receipt ? value : null;
      }

      if (client.room !== value.room) return null;

      await publicroom.read(user, value.room);

      const row = await db.get(
        `SELECT entry.id FROM chatting.message entry
         LEFT JOIN account.profile ON account.profile.uid = entry.uid
         WHERE entry.id = ? AND entry.deleted IS NULL AND ${visible(user, "entry")}`,
        [value.id]
      );

      return row ? value : null;
    } catch {
      return null;
    }
  });
}

cluster.on("attachment", (value) => changed(value, false));

export async function edit(user, id, data = {}) {
  const fail = (status) => {
    throw Object.assign(new Error("Invalid attachment"), { status });
  };

  if (!data || !rules.validId(id) || typeof data.file !== "string") fail(400);

  if (typeof data.title !== "string" || data.title.length > 255) fail(400);
  const privateRoom = data.room || "";

  if (privateRoom) await rooms.read(user, privateRoom);
  else await publicroom.read(user, user.room);
  const schema = privateRoom ? "messenger" : "chatting";
  const owner = privateRoom ? "sender" : "uid";
  const value = await db.transaction(async () => {
    const row = await db.get(
      `SELECT attachments FROM ${schema}.message
       WHERE id = ? AND room = ? AND ${owner} = ? AND deleted IS NULL FOR UPDATE`,
      [id, privateRoom || user.room, user.uid]
    );

    if (!row) fail(404);
    const entries = attachment.read(row.attachments);
    const item = entries.find((entry) => entry.type === "file" && entry.file === data.file);

    if (!item || !/^(audio|video)\//.test(formats.mime(item.name))) fail(400);

    item.title = data.title.trim();
    if (data.artist !== undefined) {
      if (
        !formats.mime(item.name).startsWith("audio/") ||
        typeof data.artist !== "string" ||
        data.artist.length > 255
      )
        fail(400);

      item.artist = data.artist.trim();
    }

    if (data.spoiler !== undefined) {
      if (!formats.mime(item.name).startsWith("video/") || typeof data.spoiler !== "boolean")
        fail(400);

      item.spoiler = data.spoiler;
    }

    if (data.cover === false) item.cover = false;
    else if (data.cover !== undefined) {
      if (typeof data.cover !== "string") fail(400);
      const cover = await db.get(
        `SELECT item FROM runtime.attachment WHERE token = ? AND uid = ? AND expires > ?`,
        [data.cover, user.uid, Date.now()]
      );

      if (!cover || !["image", "gif"].includes(cover.item.type)) fail(400);

      item.cover = cover.item.preview;
    }

    await db.run(`UPDATE ${schema}.message SET attachments = ?::jsonb WHERE id = ?`, [
      JSON.stringify(entries),
      id
    ]);

    return { id, room: privateRoom || user.room, private: Boolean(privateRoom), item };
  });

  await changed(value);
  return value;
}

export async function caption(user, id, room = "") {
  if (!rules.validId(id)) throw Object.assign(new Error("Invalid message"), { status: 400 });

  if (room) await rooms.read(user, room);
  else await publicroom.read(user, user.room);
  const row = await db.get(
    room
      ? `SELECT entry.audio, entry.text, entry.sender AS uid
         FROM messenger.message entry
         WHERE entry.id = ? AND entry.room = ? AND entry.deleted IS NULL
           AND EXISTS (SELECT 1 FROM messenger.receipt r WHERE r.message = entry.id AND r.uid = ?)`
      : `SELECT entry.audio, entry.text, entry.uid
         FROM chatting.message entry
         LEFT JOIN account.profile ON account.profile.uid = entry.uid
         WHERE entry.id = ? AND entry.room = ? AND entry.deleted IS NULL AND ${visible(user, "entry")}`,
    room ? [id, room, user.uid] : [id, user.room]
  );

  if (!row?.audio) throw Object.assign(new Error("Message unavailable"), { status: 404 });
  const result = await audio.caption(media.resolve(row.audio), row.uid);

  return { ...result, text: row.text || result.text };
}

const bytes = async (url) => {
  const route = media.routes.find((item) => url.startsWith(`${item.prefix}/`));
  const name = url.split("/").at(-1);

  if (!route || !/^[a-f0-9-]+\.[a-z0-9]+$/i.test(name)) return null;
  try {
    return (await stat(path.upload(route.directory, name))).size;
  } catch {
    return null;
  }
};

async function index(source, state) {
  const schema = source === "message" ? "messenger" : "chatting";

  let cursor = source === "message" ? 0 : state.cursor;

  const high = (
    await db.get(`
      SELECT COALESCE(MAX(seq), 0) AS seq
      FROM ${schema}.message
    `)
  ).seq;

  while (cursor < high) {
    const rows = await db.all(
      `
        SELECT *
        FROM ${schema}.message
        WHERE seq > ?
          AND seq <= ? ${source === "message" ? "AND NOT EXISTS (SELECT 1 FROM messenger.asset a WHERE a.seq = messenger.message.seq AND a.slot = -1)" : ""}
        ORDER BY seq
        LIMIT 100
      `,
      [cursor, high]
    );

    if (!rows.length) break;
    for (const row of rows) {
      const items = attachment
        .read(row.attachments)
        .filter((item) => item.image || item.type === "file")
        .map((item) =>
          item.type === "file"
            ? { kind: "file", url: item.file, name: item.name }
            : { kind: "image", url: item.image, preview: item.preview }
        );

      if (row.image && !items.some((item) => item.url === media.resolve(row.image)))
        items.push({
          kind: "image",
          url: media.resolve(row.image),
          preview: media.resolve(row.preview || row.image)
        });

      if (row.audio) items.push({ kind: "file", url: media.resolve(row.audio) });
      const links = new Set();

      for (const item of parse(row.text || "")) {
        if (!item.url || !/^https?:/i.test(item.url) || links.has(item.url)) continue;

        links.add(item.url);
        items.push({ kind: "link", url: item.url, name: item.text });
      }

      for (const [slot, item] of items.entries()) {
        const url = media.resolve(item.url);

        await db.run(
          `
            INSERT INTO ${schema}.asset (seq, slot, kind, url, preview, name, size)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
          `,
          [
            row.seq,
            slot,
            item.kind,
            url,
            item.preview || null,
            item.name || (item.kind === "file" ? url.split("/").at(-1) : null),
            item.kind === "link" ? null : await bytes(url)
          ]
        );
      }

      if (source === "message")
        await db.run(
          `
            INSERT INTO messenger.asset (seq, slot, kind, url)
            VALUES(?, -1, 'indexed', '')
            ON CONFLICT DO NOTHING
          `,
          [row.seq]
        );

      cursor = row.seq;
      state.cursor = cursor;
    }
  }
}

export const list = async (user, query, room = "") => {
  if (room) await rooms.read(user, room);
  else await publicroom.read(user, user.room);
  const source = room ? "message" : "chatting";
  const kind = query.kind || "image";
  const before = query.before === undefined ? null : query.before;

  if (
    !["media", "image", "file", "link"].includes(kind) ||
    (before !== null && !/^\d+:\d+$/.test(before))
  )
    throw Object.assign(new Error("Invalid asset query"), { status: 400 });

  if (!indexes.has(source)) indexes.set(source, { cursor: 0 });
  const state = indexes.get(source);

  state.pending ||= index(source, state).finally(() => {
    state.pending = undefined;
  });

  await state.pending;

  const extensions = Object.keys(formats.formats).filter((key) => key !== "__proto__");
  const pattern = `\\.(${extensions.join("|")})$`;
  const selected = `(a.kind = 'image' OR (a.kind = 'file' AND a.name ~* ?))`;
  const filter =
    kind === "media"
      ? selected
      : kind === "file"
        ? `a.kind = 'file' AND NOT ${selected}`
        : "a.kind = ?";

  const base = room
    ? `FROM messenger.asset a JOIN messenger.message entry ON entry.seq = a.seq
      LEFT JOIN account.profile ON account.profile.uid = entry.sender
      WHERE ${filter} AND ${user.role === role.root ? "TRUE" : "entry.deleted IS NULL"}
      AND entry.room = ?
      AND EXISTS (SELECT 1 FROM messenger.receipt x
        WHERE x.message = entry.id AND x.uid = ?)`
    : `FROM chatting.asset a JOIN chatting.message entry ON entry.seq = a.seq
      LEFT JOIN account.profile ON account.profile.uid = entry.uid
      WHERE ${filter} AND ${visible(user, "entry")} AND entry.room = ?`;

  const params = [
    kind === "media" || kind === "file" ? pattern : kind,
    ...(room ? [room, user.uid] : [user.room])
  ];

  const totals = await db.get(
    `
      SELECT COUNT(*) AS count, SUM(a.size) AS size, COUNT(*) FILTER (WHERE a.size IS NULL) AS unknown ${base}
    `,
    params
  );
  const edge = before?.split(":").map(Number);
  const rows = await db.all(
    `
      SELECT a.*, entry.time, entry.id AS token, entry.deleted AS removed, entry.attachments,
        entry.audio AS speech,
        entry.text AS content, ${room ? "entry.sender" : "entry.uid"} AS owner,
        account.profile.role AS rank, ${
          room
            ? `NOT EXISTS (SELECT 1 FROM messenger.receipt r
        WHERE r.message = entry.id AND r.uid <> entry.sender
        AND r.read IS NOT NULL)`
            : "1"
        } AS unread,
        CASE WHEN account.profile.erased = 0 THEN account.profile.id END AS author,
        CASE WHEN account.profile.erased = 0
        AND account.profile.verified THEN account.profile.name END AS label,
        CASE WHEN account.profile.erased = 0 THEN account.profile.avatar END AS avatar,
        (account.profile.erased = 0
          AND account.profile.verified) AS verified ${base} ${edge ? "AND (a.seq < ? OR a.seq = ? AND a.slot < ?)" : ""}
      ORDER BY a.seq DESC, a.slot DESC
      LIMIT 25
    `,
    [...params, ...(edge ? [edge[0], edge[0], edge[1]] : [])]
  );
  const items = rows.slice(0, 24);

  return {
    count: totals.count,
    size: totals.unknown ? null : totals.size || 0,
    items: await Promise.all(
      items.map(async (row) => {
        const {
          seq,
          slot,
          author,
          label,
          avatar,
          verified,
          token,
          removed,
          owner,
          rank,
          unread,
          content,
          attachments,
          speech,
          ...item
        } = row;

        const attached = attachment
          .read(attachments)
          .find((entry) => (entry.file || entry.image) === item.url);

        return {
          ...item,
          ...(speech && media.resolve(speech) === item.url
            ? { channel: (await audio.caption(item.url, owner)).channel || "media" }
            : {}),
          ...(attached
            ? {
                title: attached.title,
                artist: attached.artist,
                cover: attached.cover,
                spoiler: attached.spoiler
              }
            : {}),
          kind:
            item.kind === "file" && /^(image|audio|video)\//.test(formats.mime(item.name))
              ? formats.mime(item.name).split("/")[0]
              : item.kind,
          ...(item.kind === "file" &&
            item.url.endsWith(".bin") && {
              url: `${item.url}?${new URLSearchParams({ name: item.name || "download" })}`
            }),
          id: `${seq}:${slot}`,
          record: {
            url: room ? "" : token,
            token: room ? token : "",
            room: room || user.room,
            private: Boolean(room),
            kind: room ? "message" : "",
            id: author || "",
            own: owner === user.uid,
            deleted: Boolean(removed),
            retained: Boolean(removed && user.role === role.root),
            restorable: Boolean(removed && user.role === role.root),
            removable:
              !removed &&
              (room
                ? owner === user.uid && Boolean(unread)
                : owner === user.uid ||
                  user.role === role.root ||
                  role.manages(user, { uid: owner, role: rank })),
            unread: Boolean(unread),
            time: item.time,
            text: content || ""
          },
          sender: {
            id: author || "",
            name: label || "",
            avatar: media.resolve(avatar || ""),
            verified: Boolean(verified)
          }
        };
      })
    ),
    next: rows.length > 24 ? `${items.at(-1).seq}:${items.at(-1).slot}` : null
  };
};

export const preview = async (user, id, room = "") => {
  if (room) await rooms.read(user, room);
  else await publicroom.read(user, user.room);

  if (!/^\d+:\d+$/.test(id)) throw Object.assign(new Error("Invalid asset"), { status: 400 });
  const row = await db.get(
    room
      ? `
        SELECT a.url
        FROM messenger.asset a
        JOIN messenger.message ON messenger.message.seq = a.seq
        WHERE a.seq = ?
          AND a.slot = ?
          AND a.kind = 'link'
          AND messenger.message.deleted IS NULL
          AND messenger.message.room = ?
          AND EXISTS (SELECT 1
          FROM messenger.receipt x
          WHERE x.message = messenger.message.id
            AND x.uid = ?)
      `
      : `
        SELECT a.url
        FROM chatting.asset a
        JOIN chatting.message entry ON entry.seq = a.seq
        LEFT JOIN account.profile ON account.profile.uid = entry.uid
        WHERE a.seq = ?
          AND a.slot = ?
          AND a.kind = 'link'
          AND entry.deleted IS NULL
          AND ${visible(user, "entry")}
          AND entry.room = ?
      `,
    [...id.split(":"), ...(room ? [room, user.uid] : [user.room])]
  );

  if (!row) throw Object.assign(new Error("Missing asset"), { status: 404 });

  return metadata(row.url);
};
