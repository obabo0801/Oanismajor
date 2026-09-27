import * as db from "#db";
import * as media from "#config/media";
import * as data from "./admin/data.js";
import * as settings from "#shared/settings";

export const recipients = async () => {
  const users = await db.all(`
    SELECT id, name, avatar, date, settings, verified
    FROM account.profile
    WHERE erased = 0
      AND deletion IS NULL
      AND id IS NOT NULL
      AND (EXISTS (SELECT 1
        FROM push.web
        WHERE push.web.uid = account.profile.uid
          AND active = 1
          AND connected = 1)
        OR EXISTS (SELECT 1
        FROM push.fcm
        WHERE push.fcm.uid = account.profile.uid
          AND device = 'wearable'))
      AND NOT EXISTS (SELECT 1
      FROM moderation.block
      WHERE moderation.block.uid = account.profile.uid
        OR moderation.block.ip = account.profile.ip)
    ORDER BY date DESC, id
  `);

  return users
    .filter((user) => {
      const options = settings.read(user.settings);

      return options.notification && options.web;
    })
    .map(({ settings: value, ...user }) => ({
      ...user,
      name: user.verified ? user.name || "" : "",
      avatar: media.resolve(user.avatar),
      verified: Boolean(user.verified)
    }));
};

export const devices = async (user) => {
  const rows = await db.all(
    `
      SELECT name, device, os, browser, active, connected, time, registered,
        'web' AS kind
      FROM push.web
      WHERE uid = ?
      UNION ALL
      SELECT NULL, device, NULL, NULL, 1, 1, time, registered, 'fcm'
      FROM push.fcm
      WHERE uid = ?
    `,
    [user.uid, user.uid]
  );
  const options = settings.read(user.settings);

  return rows.map((device) => ({
    ...device,
    receiving: Boolean(
      options.notification &&
      options.web &&
      device.active &&
      device.connected &&
      (device.kind === "web" || device.device === "wearable")
    )
  }));
};

const invalid = () => {
  throw Object.assign(new Error("Invalid management query"), { status: 400 });
};

const query = (value = "") => {
  if (typeof value !== "string" || value.length > 200) invalid();

  return value.trim();
};

const offset = (value = "0") => {
  if (!/^\d{1,7}$/.test(String(value))) invalid();

  return Number(value) * 30;
};

export const catalogue = (options = {}) => data.catalogue(options);

const browse = async (connection, table, columns, options, date, order = "rowid") => {
  const search = query(options.q);
  const field = query(options.field);
  const value = query(options.value);
  const start = offset(options.page);

  if (field && !columns.includes(field)) invalid();
  const conditions = [];
  const values = [];

  if (date) {
    conditions.push("replace(substr(time, 1, 10), '-', '') = ?");
    values.push(date);
  }

  if (search) {
    conditions.push(
      `(${columns
        .map((key) => `strpos(lower(coalesce(CAST("${key}" AS TEXT),'')),lower(?)) > 0`)
        .join(" OR ")})`
    );

    values.push(...columns.map(() => search));
  }

  if (field) {
    conditions.push(`CAST("${field}" AS TEXT) = ?`);
    values.push(value);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const count = await connection.get(
    `
      SELECT count(*) AS total
      FROM ${table}${where}
    `,
    values
  );

  const items = await connection.all(
    `
      SELECT ${columns.map((key) => `"${key}"`).join(",")}
      FROM ${table}${where}
      ORDER BY "${order}" DESC
      LIMIT 30
      OFFSET ?
    `,
    [...values, start]
  );

  return { columns, items, total: count.total };
};

export const list = (table, options) =>
  data.read(table, options, (connection, target, columns, order) =>
    browse(connection, target, columns, options, undefined, order)
  );

export const users = async (options) =>
  db.read(async () => {
    const search = query(options.q);
    const start = offset(options.page);
    const where = `erased = 0 AND (strpos(lower(coalesce(name,'')),lower(?)) > 0
    OR strpos(id,?) > 0)`;

    const count = await db.get(
      `
      SELECT count(*) AS total
      FROM account.profile
      WHERE ${where}
    `,
      [search, search]
    );

    const rows = await db.all(
      `
      SELECT id, name, avatar, verified
      FROM account.profile
      WHERE ${where}
      ORDER BY date DESC, id
      LIMIT 30
      OFFSET ?
    `,
      [search, search, start]
    );

    return {
      total: count.total,
      items: rows.map((row) => ({
        id: row.id,
        name: row.verified ? row.name || "" : "",
        avatar: media.resolve(row.avatar),
        verified: Boolean(row.verified)
      }))
    };
  });
