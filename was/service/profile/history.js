import connect from "#db/connect";
import * as chat from "#service/chatting";
import * as history from "#shared/history";
import { publicName } from "#config/uid";
import * as db from "#db";
import * as snapshots from "#service/history";

const invalid = () => {
  throw Object.assign(new Error("Invalid history query"), { status: 400 });
};

const count = (value = "50") => {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    invalid();

  return Math.min(Number(value), 100);
};

export const chatting = async (user, uid, query) => {
  const page = await chat.list(
    user,
    { limit: count(query.limit), before: query.cursor, search: query.search, date: query.date },
    uid
  );

  const items = page.messages
    .reverse()
    .map(({ url, id, name, text, time, image, preview, attachments, audio, deleted }) => ({
      url,
      id,
      name,
      text,
      time,
      ...(image && { image }),
      ...(preview && { preview }),
      ...(attachments?.length && { attachments }),
      ...(audio && { audio }),
      ...(deleted && { deleted: true })
    }));

  return {
    items,
    next: page.more ? String(page.messages.at(-1).seq) : null,
    ...(page.total !== undefined && { total: page.total })
  };
};

const audit = connect("audit");

export const block = async (uid, query, sanctions = false) => {
  const filter = { ...history.filters(query), action: query.action ?? "" };

  if (
    typeof filter.action !== "string" ||
    (filter.action && !Object.hasOwn(history.actions, filter.action))
  )
    invalid();
  const limit = count(query.limit);

  let before = ["9999-12-31 23:59:59", 1, Number.MAX_SAFE_INTEGER];

  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== "string" || query.cursor.length > 200) invalid();

      before = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
      if (
        !Array.isArray(before) ||
        before.length !== 3 ||
        typeof before[0] !== "string" ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(before[0]) ||
        ![0, 1].includes(before[1]) ||
        !Number.isSafeInteger(before[2]) ||
        before[2] < 0
      )
        invalid();
    } catch {
      invalid();
    }
  }
  const source =
    `
      SELECT rowid AS seq, 0 AS kind, action, time, reason, handler, actor,
        NULL::text AS until, snapshot
      FROM audit.block
      WHERE uid = ?
    ` +
    (sanctions
      ? `
    UNION ALL SELECT rowid AS seq, 1 AS kind, action, time, reason, handler, actor,
    until, snapshot FROM audit.sanction WHERE uid = ?`
      : "");

  const conditions = [
    "(strpos(lower(coalesce(reason,'')),lower(?)) > 0 OR strpos(lower(coalesce(handler,'')),lower(?)) > 0)"
  ];

  const params = [uid, ...(sanctions ? [uid] : []), filter.search, filter.search];

  if (filter.action) {
    conditions.push("action = ?");
    params.push(filter.action);
  }

  if (filter.range) {
    conditions.push("time >= ? AND time < ?");
    params.push(...filter.range);
  }
  const where = conditions.join(" AND ");
  const summary = {};

  if (query.cursor === undefined && (filter.search || filter.range || filter.action)) {
    summary.total = (
      await audit.get(
        `
          SELECT count(*) AS total
          FROM (${source}) AS records
          WHERE ${where}
        `,
        params
      )
    ).total;
  }
  const rows = await audit.all(
    `
      SELECT *
      FROM (${source}) AS records
      WHERE ${where}
        AND (time, kind, seq) < (?, ?, ?)
      ORDER BY time DESC, kind DESC, seq DESC
      LIMIT ?
    `,
    [...params, ...before, limit + 1]
  );
  const more = rows.length > limit;
  const selected = rows.slice(0, limit);
  const handlers = new Map();
  const items = [];

  for (const item of selected) {
    const { actor, action, time, reason, handler, until, snapshot } = item;
    const row = { action, time, reason, handler, until, snapshot };

    if (actor && !handlers.has(actor)) {
      const user = await db.get(
        `
          SELECT id
          FROM account.profile
          WHERE uid = ?
        `,
        [actor]
      );

      handlers.set(actor, user?.id || "");
    }

    items.push({
      ...row,
      ...(handlers.get(actor) && { handlerId: handlers.get(actor) }),
      handler: publicName(row.handler),
      snapshot: snapshots.read(row.snapshot)
    });
  }
  const last = selected.at(-1);

  return {
    items,
    next: more
      ? Buffer.from(JSON.stringify([last.time, last.kind, last.seq])).toString("base64url")
      : null,
    ...summary
  };
};
