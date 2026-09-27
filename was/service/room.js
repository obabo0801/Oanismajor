import { randomUUID } from "node:crypto";
import * as db from "#db";
import * as media from "#config/media";
import * as events from "#service/events";
import * as settings from "#shared/settings";
import { validId } from "#shared/chatting";
import * as role from "#shared/role";

const fail = (status) => {
  throw Object.assign(new Error("Room unavailable"), { status, code: "unavailable" });
};

const pair = (a, b) => [a, b].sort();

export const policy = async (uid, peer) => {
  const row = await db.get(
    `
      SELECT EXISTS(SELECT 1
      FROM account.block
      WHERE uid = ?
        AND peer = ?) AS blocked, EXISTS(SELECT 1
      FROM account.block
      WHERE uid = ?
        AND peer = ?) AS other
    `,
    [uid, peer, peer, uid]
  );

  return { blocked: Boolean(row.blocked), unavailable: Boolean(row.blocked || row.other) };
};

const active = `deletion IS NULL AND erased = 0 AND NOT EXISTS
  (SELECT 1 FROM moderation.block WHERE moderation.block.uid = account.profile.uid OR moderation.block.ip = account.profile.ip)`;

export const find = async (user, id, writable = false) => {
  if (!validId(id)) fail(400);
  const row = await db.get(
    `
      SELECT r.*, m."left", m.reason, m.pinned, m.muted, m.deputy, c.uid AS contact
      FROM messenger.room r
      JOIN messenger.member m ON m.room = r.id
      LEFT JOIN messenger.contact c ON c.room = r.id
      JOIN account.profile u ON u.uid = m.uid
      WHERE r.id = ?
        AND m.uid = ?
        AND (c.room IS NULL
          OR c.uid = u.uid
          OR (u.role IN (?, ?)
            AND u.erased = 0
            AND u.deletion IS NULL))
    `,
    [id, user.uid, role.root, role.admin]
  );

  if (!row || (writable && (row.closed || row.left))) fail(404);

  return row;
};

const eligible = async (uid, members) => {
  const user = await db.get(
    `
      SELECT uid, settings
      FROM account.profile
      WHERE uid = ?
        AND ${active}
    `,
    [uid]
  );

  if (!user || !settings.read(user.settings).message) return false;
  for (const member of members) if ((await policy(uid, member)).unavailable) return false;

  return true;
};

const record = async (id, type, actor, targets = [], value = "") => {
  const users = await members(id);
  const people = [actor, ...targets];
  const snapshots = [];

  for (const uid of people) {
    const user =
      users.find((item) => item.uid === uid) ||
      (await db.get(
        `
          SELECT id, name, verified
          FROM account.profile
          WHERE uid = ?
        `,
        [uid]
      ));

    snapshots.push({ id: user.id, name: user.verified ? user.name || "" : "" });
  }

  const system = { type, actor: snapshots[0], targets: snapshots.slice(1), value };
  const token = randomUUID();
  const time = new Date().toISOString();

  await db.run(
    `
      INSERT INTO messenger.message(id, sender, recipient, room, text, system,
        time)
      VALUES(?, ?, ?, ?, '', ?, ?)
    `,
    [token, actor, actor, id, JSON.stringify(system), time]
  );

  const recipients = new Set(users.filter((item) => !item.left).map((item) => item.uid));

  recipients.add(actor);
  if (type === "remove") targets.forEach((uid) => recipients.add(uid));
  for (const uid of recipients)
    await db.run(
      `
        INSERT INTO messenger.receipt(message, uid, read)
        VALUES(?, ?, ?)
      `,
      [token, uid, time]
    );

  return { token, room: id, kind: "message", system, text: "", time };
};

const select = async (user, targets, current = [user]) => {
  const ids = Array.isArray(targets) ? targets : [targets];

  if (
    !ids.length ||
    ids.length > 50 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))
  )
    fail(400);
  const peers = [];

  for (const id of ids) {
    const peer = await db.get(
      `
        SELECT uid
        FROM account.profile
        WHERE id = ?
      `,
      [id]
    );

    if (
      !peer ||
      [...current, ...peers].some((item) => item.uid === peer.uid) ||
      !(await eligible(
        peer.uid,
        [...current, ...peers].map((item) => item.uid)
      ))
    )
      fail(409);

    peers.push(peer);
  }

  return peers;
};

export const create = async (user, targets) => {
  if (typeof targets === "string") return ensure(user, targets);

  if (Array.isArray(targets) && targets.length === 1) return ensure(user, targets[0]);
  const result = await db.transaction(async () => {
    const peers = await select(user, targets);
    const id = randomUUID();

    await db.run(
      `
        INSERT INTO messenger.room(id, first, second, multiple, owner)
        VALUES(?, ?, ?, 1, ?)
      `,
      [id, user.uid, peers[0].uid, user.uid]
    );

    for (const member of [user, ...peers])
      await db.run(
        `
          INSERT INTO messenger.member(room, uid)
          VALUES(?, ?)
        `,
        [id, member.uid]
      );

    return {
      id,
      event: await record(
        id,
        "invite",
        user.uid,
        peers.map((item) => item.uid)
      )
    };
  });

  await notify(result.id, result.event);

  return { id: result.id };
};

export async function ensure(user, id) {
  const result = await db.transaction(async () => {
    if (!/^[a-f0-9]{32}$/.test(id)) fail(400);
    const peer = await db.get(
      `
        SELECT uid
        FROM account.profile
        WHERE id = ?
          AND erased = 0
      `,
      [id]
    );

    if (!peer || peer.uid === user.uid) fail(404);
    const members = pair(user.uid, peer.uid);

    const row = await db.get(
      `
        SELECT r.*
        FROM messenger.room r
        WHERE r.first = ?
          AND r.second = ?
          AND r.multiple = 0
          AND r.closed IS NULL
          AND NOT EXISTS (
          SELECT 1
          FROM messenger.member m
          WHERE m.room = r.id
            AND m."left" IS NOT NULL )
        ORDER BY r.rowid DESC
        LIMIT 1
      `,
      members
    );

    if (row) return row;

    if (!(await eligible(peer.uid, [user.uid]))) fail(409);
    const token = randomUUID();

    await db.run(
      `
        INSERT INTO messenger.room(id, first, second)
        VALUES(?, ?, ?)
      `,
      [token, ...members]
    );

    for (const uid of members)
      await db.run(
        `
          INSERT INTO messenger.member(room, uid)
          VALUES(?, ?)
        `,
        [token, uid]
      );

    return db.get(
      `
        SELECT *
        FROM messenger.room
        WHERE id = ?
      `,
      [token]
    );
  });

  return result;
}

export function members(id) {
  return db.all(
    `
      SELECT u.*, m."left", m.reason, m.muted, m.deputy
      FROM messenger.member m
      JOIN account.profile u ON u.uid = m.uid
      LEFT JOIN messenger.contact c ON c.room = m.room
      WHERE m.room = ?
        AND (c.room IS NULL
          OR c.uid = u.uid
          OR (u.role IN (?, ?)
            AND u.erased = 0
            AND u.deletion IS NULL))
    `,
    [id, role.root, role.admin]
  );
}

export const read = async (user, id) => {
  const row = await find(user, id);
  const users = await members(id);
  const target = users.find((item) => item.uid !== user.uid);
  const access =
    !row.multiple && target
      ? await policy(user.uid, target.uid)
      : { blocked: false, unavailable: false };
  const participants = users.filter((item) => !item.left && !item.erased);
  const requester = users.find((item) => item.uid === row.contact);
  const contact = row.contact
    ? await db.get(
        `
          SELECT u.id, u.name, u.verified, c.assigned
          FROM messenger.contact c
          LEFT JOIN account.profile u ON u.uid = c.handler
            AND (c.closed IS NOT NULL
              OR (u.role IN (?, ?)
                AND u.erased = 0
                AND u.deletion IS NULL))
          WHERE c.room = ?
        `,
        [role.root, role.admin, id]
      )
    : null;

  return {
    id: row.id,
    peer: !row.multiple ? target?.id : undefined,
    name: row.name || "",
    ...(contact && {
      contact: true,
      requester: {
        id: requester?.id || "",
        name: requester?.verified ? requester.name || "" : "",
        self: row.contact === user.uid
      },
      handler: contact.id
        ? { id: contact.id, name: contact.verified ? contact.name || "" : "" }
        : null,
      assigned: contact.id ? contact.assigned : null
    }),
    multiple: Boolean(row.multiple),
    owner: row.owner === user.uid,
    deputy: Boolean(row.multiple && row.deputy && !row.left),
    closed: Boolean(row.closed),
    departed: Boolean(row.left),
    blocked: access.blocked,
    available:
      !row.closed &&
      !row.left &&
      !access.unavailable &&
      (row.multiple || Boolean(target && !target.left && (await eligible(target.uid, [user.uid])))),
    muted: Boolean(row.muted),
    participants: participants.map((item) => ({
      id: item.id,
      name: item.verified ? item.name || "" : "",
      avatar: media.resolve(item.avatar),
      state: events.state(item.uid),
      self: item.uid === user.uid,
      verified: Boolean(item.verified),
      owner: row.owner === item.uid,
      deputy: Boolean(row.multiple && item.deputy && row.owner !== item.uid)
    }))
  };
};

export async function preview(user, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) fail(400);

  const peer = await db.get(
    `
      SELECT uid, id, name, avatar, verified
      FROM account.profile
      WHERE id = ?
        AND ${active}
    `,
    [id]
  );

  if (!peer || peer.uid === user.uid) fail(404);

  const ids = pair(user.uid, peer.uid);
  const row = await db.get(
    `
      SELECT r.id
      FROM messenger.room r
      WHERE r.first = ?
        AND r.second = ?
        AND r.multiple = 0
        AND r.closed IS NULL
        AND NOT EXISTS (
        SELECT 1
        FROM messenger.member m
        WHERE m.room = r.id
          AND m."left" IS NOT NULL )
      ORDER BY r.rowid DESC
      LIMIT 1
    `,
    ids
  );

  if (row) {
    return read(user, row.id);
  }

  const access = await policy(user.uid, peer.uid);

  return {
    id,
    peer: id,
    draft: true,
    name: "",
    multiple: false,
    owner: false,
    deputy: false,
    closed: false,
    departed: false,
    blocked: access.blocked,
    available: !access.unavailable && (await eligible(peer.uid, [user.uid])),
    muted: false,
    participants: [
      {
        id: peer.id,
        name: peer.verified ? peer.name || "" : "",
        avatar: media.resolve(peer.avatar),
        state: events.state(peer.uid),
        self: false,
        verified: Boolean(peer.verified),
        owner: false,
        deputy: false
      }
    ]
  };
}

export async function notify(id, event) {
  for (const user of await members(id)) {
    events.send(user.uid, "direct-state", { room: id });
    events.send(user.uid, "direct-change", { room: id });
    if (
      event &&
      (await db.get(
        `
          SELECT 1
          FROM messenger.receipt
          WHERE message = ?
            AND uid = ?
        `,
        [event.token, user.uid]
      ))
    )
      events.send(user.uid, "direct", { ...event, own: false, muted: true });
  }
}

export const search = async (user, query = "", id = "") => {
  if (typeof query !== "string" || query.length > 80) fail(400);
  const row = id ? await find(user, id, true) : null;

  if (row && (!row.multiple || (row.owner !== user.uid && !row.deputy))) fail(403);
  const current = id ? (await members(id)).filter((item) => !item.left) : [user];
  const term = query.trim();

  const users = await db.all(
    `
      SELECT uid, id, name, avatar, verified, settings
      FROM account.profile
      WHERE uid <> ?
        AND ${active}
        AND (strpos(lower(CASE WHEN verified THEN coalesce(name,
            '') ELSE '' END), lower(?)) > 0
          OR strpos(id, lower(?)) > 0)
      ORDER BY name, id
      LIMIT 50
    `,
    [user.uid, term, term]
  );
  const items = [];

  for (const candidate of users) {
    if (current.some((item) => item.uid === candidate.uid)) continue;
    const ended =
      !id &&
      (await db.get(
        `
          SELECT 1
          FROM messenger.room
          WHERE first = ?
            AND second = ?
            AND multiple = 0
            AND closed IS NOT NULL
        `,
        pair(user.uid, candidate.uid)
      ));

    const allowed =
      !ended &&
      (await eligible(
        candidate.uid,
        current.map((item) => item.uid)
      ));

    items.push({
      id: candidate.id,
      name: candidate.verified ? candidate.name || "" : "",
      avatar: media.resolve(candidate.avatar),
      verified: Boolean(candidate.verified),
      state: events.state(candidate.uid),
      available: Boolean(allowed)
    });
  }

  return { items };
};

export const invite = async (user, id, targets) => {
  const event = await db.transaction(async () => {
    const row = await find(user, id, true);

    if (row.contact || !row.multiple || (row.owner !== user.uid && !row.deputy)) fail(403);
    const users = (await members(id)).filter((item) => !item.left);
    const peers = await select(user, targets, users);

    for (const peer of peers)
      await db.run(
        `
          INSERT INTO messenger.member(room, uid)
          VALUES(?, ?)
          ON CONFLICT(room, uid)
          DO UPDATE SET "left" = NULL, reason = NULL, deputy = 0
        `,
        [id, peer.uid]
      );

    return record(
      id,
      "invite",
      user.uid,
      peers.map((item) => item.uid)
    );
  });

  await notify(id, event);

  return read(user, id);
};

export const manage = async (user, id, action, value) => {
  const event = await db.transaction(async () => {
    const row = await find(user, id, true);

    if (
      row.contact ||
      !row.multiple ||
      (row.owner !== user.uid && !(row.deputy && action === "remove"))
    )
      fail(403);

    if (action === "name") {
      if (typeof value !== "string" || !value.trim() || value.length > 60) fail(400);

      await db.run(
        `
          UPDATE messenger.room
          SET name = ?
          WHERE id = ?
        `,
        [value.trim(), id]
      );

      return record(id, "name", user.uid, [], value.trim());
    }

    if (action === "end") {
      await db.run(
        `
          UPDATE messenger.room
          SET closed = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS')
          WHERE id = ?
        `,
        [id]
      );

      return record(id, "end", user.uid);
    }

    if (!["remove", "owner", "deputy", "revoke"].includes(action)) fail(400);
    const peer = await db.get(
      `
        SELECT m.uid, m.deputy
        FROM messenger.member m
        JOIN account.profile u ON u.uid = m.uid
        WHERE m.room = ?
          AND u.id = ?
          AND m."left" IS NULL
      `,
      [id, value]
    );

    if (!peer || peer.uid === user.uid) fail(409);

    if (row.owner !== user.uid && (peer.uid === row.owner || peer.deputy)) fail(403);

    if (["owner", "deputy"].includes(action) && !(await eligible(peer.uid, []))) fail(409);

    if (action === "deputy" || action === "revoke") {
      const deputy = action === "deputy";

      if (Boolean(peer.deputy) === deputy) fail(409);

      await db.run(
        `
          UPDATE messenger.member
          SET deputy = ?
          WHERE room = ?
            AND uid = ?
        `,
        [Number(deputy), id, peer.uid]
      );

      return record(id, action, user.uid, [peer.uid]);
    }

    await db.run(
      `
        UPDATE messenger.member
        SET deputy = 0
        WHERE room = ?
          AND uid = ?
      `,
      [id, peer.uid]
    );

    if (action === "owner")
      await db.run(
        `
          UPDATE messenger.room
          SET owner = ?
          WHERE id = ?
        `,
        [peer.uid, id]
      );
    else
      await db.run(
        `
          UPDATE messenger.member
          SET "left" = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS'), reason = 'removed'
          WHERE room = ?
            AND uid = ?
        `,
        [id, peer.uid]
      );

    return record(id, action, user.uid, [peer.uid]);
  });

  await notify(id, event);

  return read(user, id);
};

export const leave = async (user, id) => {
  const result = await db.transaction(async () => {
    const row = await find(user, id);

    if (row.contact) {
      if (row.closed) return null;

      await db.run(
        `
          UPDATE messenger.contact
          SET closed = coalesce(closed, to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
              'YYYY-MM-DD HH24:MI:SS'))
          WHERE room = ?
        `,
        [id]
      );

      await db.run(
        `
          UPDATE messenger.room
          SET closed = coalesce(closed, to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
              'YYYY-MM-DD HH24:MI:SS'))
          WHERE id = ?
        `,
        [id]
      );

      return record(id, "contact", user.uid);
    }

    if (row.left) {
      return null;
    }

    const others = (await members(id)).filter((item) => !item.left && item.uid !== user.uid);

    if (row.multiple && row.owner === user.uid && others.length) {
      throw Object.assign(new Error("Transfer ownership first"), { status: 409, code: "owner" });
    }

    if (row.multiple && !row.contact && !others.length) {
      await db.run(
        `
          UPDATE messenger.room
          SET closed = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS')
          WHERE id = ?
        `,
        [id]
      );
    }

    await db.run(
      `
        UPDATE messenger.member
        SET "left" = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS'), reason = 'leave', deputy = 0
        WHERE room = ?
          AND uid = ?
      `,
      [id, user.uid]
    );

    return record(id, "leave", user.uid);
  });

  await notify(id, result);

  return read(user, id);
};

export const configure = async (user, id, action, value) => {
  await find(user, id);
  if (!["pin", "mute"].includes(action) || typeof value !== "boolean") fail(400);
  const column = action === "pin" ? "pinned" : "muted";

  await db.run(
    `
      UPDATE messenger.member
      SET ${column} = ?
      WHERE room = ?
        AND uid = ?
    `,
    [Number(value), id, user.uid]
  );

  events.send(user.uid, "direct-change", { room: id });
};

export const block = async (user, id, value) => {
  if (typeof value !== "boolean" || !/^[a-f0-9]{32}$/.test(id)) fail(400);
  const peer = await db.get(
    `
      SELECT uid
      FROM account.profile
      WHERE id = ?
    `,
    [id]
  );

  if (!peer || peer.uid === user.uid) fail(404);

  if (value)
    await db.run(
      `
        INSERT INTO account.block(uid, peer)
        VALUES(?, ?)
        ON CONFLICT DO NOTHING
      `,
      [user.uid, peer.uid]
    );
  else
    await db.run(
      `
        DELETE
        FROM account.block
        WHERE uid = ?
          AND peer = ?
      `,
      [user.uid, peer.uid]
    );
  const own = await db.get(
    `
      SELECT id
      FROM account.profile
      WHERE uid = ?
    `,
    [user.uid]
  );

  for (const [uid, target] of [
    [user.uid, id],
    [peer.uid, own?.id]
  ]) {
    events.send(uid, "profile-update", { id: target });
    events.send(uid, "direct-state", {});
  }
};
