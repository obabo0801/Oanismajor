import { randomUUID } from "node:crypto";
import { get, all, run } from "#db";
import * as media from "#config/media";
import * as role from "#shared/role";
import * as rules from "#shared/report";
import { validId } from "#shared/chatting";
import { filters } from "#shared/history";
import { read } from "#service/chatting/attach";
import * as history from "#service/history";
import * as direct from "#service/chatting/direct";
import * as rooms from "#service/chatting/room";

const fail = (status) => {
  throw Object.assign(new Error("Report request rejected"), { status });
};

const visible = `NOT EXISTS (
  SELECT 1 FROM moderation.block WHERE moderation.block.uid = target.uid OR moderation.block.ip = target.ip
)`;

export const save = async (user, ip, data = {}) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400);
  const { type, target, reason, detail = "" } = data;

  if (
    !["user", "message"].includes(type) ||
    typeof target !== "string" ||
    !target ||
    target.length > 100 ||
    !rules.reasons.includes(reason) ||
    typeof detail !== "string" ||
    detail.length > rules.length ||
    (type === "message" && !validId(target))
  )
    fail(400);

  const whisper =
    data.evidence === undefined ? null : await direct.capture(user, target, data.evidence);

  if (whisper && type !== "message") fail(400);
  const message = type === "message" && !whisper;

  if (message) await rooms.message(user, target);
  const subject = whisper?.subject.id || target;
  const from = message
    ? "chatting.message JOIN account.profile AS target ON target.uid = chatting.message.uid"
    : "account.profile AS target";

  const condition = message
    ? "chatting.message.id = ? AND chatting.message.system IS NULL"
    : "target.id = ?";

  const row = await get(
    `
      SELECT target.uid
      FROM ${from}
      WHERE ${condition}
        AND (?
          OR ${visible})
    `,
    [subject, Number(!message || role.staff(user.role))]
  );

  if (!row) fail(404);

  if (row.uid === user.uid) fail(403);
  const id = randomUUID();
  const snapshot =
    whisper ||
    (await history.capture(
      { get, all },
      { ...(message ? { message: target } : {}), uid: row.uid }
    ));

  snapshot.reporter = await get(
    `
      SELECT id, CASE WHEN verified THEN name ELSE '' END AS name
      FROM account.profile
      WHERE uid = ?
    `,
    [user.uid]
  );

  const result = await run(
    `
      INSERT INTO moderation.report (id, type, reporter, target, message,
        text, reason, detail, snapshot)
      SELECT ?, ?, actor.uid, target.uid, ${message ? "chatting.message.id, chatting.message.text" : whisper ? "?, ?" : "NULL, NULL"},
        ?, ?, ?
      FROM ${from}
      JOIN account.profile AS actor ON actor.uid = ?
      WHERE ${condition}
        AND actor.uid <> target.uid
        AND actor.deletion IS NULL
        AND actor.erased = 0
        AND NOT EXISTS (SELECT 1
        FROM moderation.block
        WHERE uid = actor.uid
          OR ip = ?)
        AND NOT EXISTS (SELECT 1
        FROM moderation.sanction
        WHERE uid = actor.uid
          AND kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
          'YYYY-MM-DD HH24:MI:SS'))
        AND (${message ? "actor.role IN (-2,-1)" : "TRUE"}
          OR ${visible})
    `,
    [
      id,
      type,
      ...(whisper ? [target, whisper.messages.find((item) => item.target).text] : []),
      reason,
      detail.trim(),
      JSON.stringify(snapshot),
      user.uid,
      subject,
      ip
    ]
  );

  if (!result.changes) fail(403);

  return { id };
};

export const list = async (user, query = {}, uid = null) => {
  if (!role.staff(user.role)) fail(403);
  const { search, range } = filters(query);
  const { before, type } = query;
  const count = query.limit ?? "50";

  if (
    (type !== undefined && !["user", "message"].includes(type)) ||
    typeof count !== "string" ||
    !/^[1-9]\d*$/.test(count) ||
    !Number.isSafeInteger(+count) ||
    (before !== undefined &&
      (typeof before !== "string" || !/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(+before)))
  )
    fail(400);
  const limit = Math.min(+count, 100);
  const selection = `FROM moderation.report
      JOIN account.profile AS target ON target.uid = moderation.report.target
      LEFT JOIN account.profile AS author ON author.uid = moderation.report.reporter
      LEFT JOIN chatting.message ON chatting.message.id = moderation.report.message
      WHERE (?::text IS NULL OR moderation.report.type = ?)
        AND (?::text IS NULL OR moderation.report.target = ?)
        AND (? = '' OR strpos(lower(COALESCE(moderation.report.text,'') || ' ' ||
          moderation.report.detail || ' ' || COALESCE(target.name,'') || ' ' ||
          COALESCE(author.name,'')), lower(?)) > 0)
        AND (?::text IS NULL OR (moderation.report.time >= ? AND moderation.report.time < ?))
        AND target.uid <> ? AND
        (target.role = 0 OR (? = -2 AND target.role = -1))`;

  const params = [
    type ?? null,
    type ?? null,
    uid,
    uid,
    search,
    search,
    range?.[0] ?? null,
    range?.[0] ?? null,
    range?.[1] ?? null,
    user.uid,
    user.role
  ];

  const total =
    before === undefined && (search || range || type)
      ? (
          await get(
            `
              SELECT COUNT(*) AS total ${selection}
            `,
            params
          )
        ).total
      : undefined;

  const rows = await all(
    `
      SELECT moderation.report.*, target.id AS public, target.name AS name,
        target.role AS role, author.name AS author, chatting.message.attachments,
        chatting.message.image, chatting.message.preview, chatting.message.deleted ${selection}
        AND report.seq < ?
      ORDER BY report.seq DESC
      LIMIT ?
    `,
    [...params, before === undefined ? Number.MAX_SAFE_INTEGER : +before, limit + 1]
  );
  const page = rows.slice(0, limit);

  return {
    items: page
      .filter((row) => role.manages(user, { uid: row.target, role: row.role }))
      .map((row) => {
        const snapshot = history.read(row.snapshot);

        return {
          id: row.id,
          type: row.type,
          target: row.public,
          name: snapshot?.subject?.name ?? row.name ?? "",
          reporter: snapshot?.reporter?.name ?? row.author ?? "",
          message: row.message,
          text: row.deleted && user.role !== role.root ? "" : row.text,
          attachments:
            row.deleted && user.role !== role.root
              ? []
              : row.attachments
                ? read(row.attachments)
                : [],
          ...(row.image &&
            (!row.deleted || user.role === role.root) && {
              image: media.resolve(row.image),
              preview: media.resolve(row.preview || row.image)
            }),
          reason: row.reason,
          detail: row.detail,
          ...(row.deleted && user.role === role.root && { deleted: true }),
          time: row.time,
          snapshot: !row.deleted || user.role === role.root ? snapshot : null,
          ...(row.deleted && user.role !== role.root && { withheld: true })
        };
      }),
    next: rows.length > limit ? String(page.at(-1).seq) : null,
    ...(total !== undefined && { total })
  };
};
