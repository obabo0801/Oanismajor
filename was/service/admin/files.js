import * as fs from "node:fs/promises";
import { sep, extname } from "node:path";
import * as path from "#config/path";
import * as db from "#db";
import * as media from "#config/media";

const roots = { upload: path.upload, tts: path.tts, stt: path.stt };
const images = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const audio = new Set([".mp3", ".webm", ".ogg", ".m4a", ".wav"]);
const type = (name) =>
  images.has(extname(name))
    ? "image"
    : audio.has(extname(name))
      ? "audio"
      : extname(name) === ".bin"
        ? "file"
        : "";

const invalid = () => {
  throw Object.assign(new Error("Invalid file query"), { status: 400 });
};

async function resolve(kind, name = "") {
  if (!Object.hasOwn(roots, kind) || typeof name !== "string" || name.length > 500) invalid();

  if (name && !name.split("/").every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part)))
    invalid();
  const root = await fs.realpath(roots[kind]());
  const file = roots[kind](...name.split("/"));
  const real = await fs.realpath(file);
  const stat = await fs.lstat(file);

  if ((real !== root && !real.startsWith(`${root}${sep}`)) || stat.isSymbolicLink()) invalid();
  return { file: real, stat };
}

export async function content(kind, name) {
  if (typeof name !== "string" || !name || !type(name)) invalid();
  const target = await resolve(kind, name);

  if (!target.stat.isFile()) invalid();
  return target.file;
}

const people = async (records) => {
  const users = [];

  for (const record of records) {
    const user = await db.get(
      `
        SELECT id, avatar, verified, CASE WHEN verified THEN name ELSE '' END AS name
        FROM account.profile
        WHERE uid = ?
          AND erased = 0
      `,
      [record.uid]
    );

    users.push({
      id: user?.id || "",
      name: user?.name || "",
      avatar: media.resolve(user?.avatar),
      verified: Boolean(user?.verified),
      time: record.time || ""
    });
  }
  return users;
};

async function metadata(kind, file) {
  if (kind !== "upload") {
    const record = await db.get(
      `
        SELECT uid, text, time${kind === "tts" ? ", voice" : ""}
        FROM storage.${kind}
        WHERE file = ?
        ORDER BY time, rowid
        LIMIT 1
      `,
      [file.split("/").at(-1)]
    );

    return record
      ? { text: record.text, time: record.time, voice: record.voice, users: await people([record]) }
      : { users: [] };
  }
  const recorded = await db.all(
    `
      SELECT uid, time
      FROM storage.upload
      WHERE file = ? OR file = ?
      ORDER BY time
    `,
    [file, file.replace(/^(images|users)\/cache\//, "$1/resizing/")]
  );

  const route = media.routes.find((item) => file.startsWith(`${item.directory}/`));

  if (!route) return { users: await people(recorded), related: [] };
  const name = file.slice(route.directory.length + 1);
  const urls = [`${route.prefix}/${name}`, `${route.legacy}/${name}`];
  const records = [];

  for (const url of urls) {
    records.push(
      ...(await db.all(
        `
          SELECT uid
          FROM account.file
          WHERE file = ?
          UNION
          SELECT uid
          FROM account.profile
          WHERE image = ?
            OR avatar = ?
          UNION
          SELECT uid
          FROM chatting.message
          WHERE image = ?
            OR preview = ?
            OR audio = ?
            OR strpos(COALESCE(attachments, ''), ?) > 0
          UNION
          SELECT sender AS uid
          FROM messenger.message
          WHERE audio = ?
            OR strpos(COALESCE(attachments, ''), ?) > 0
        `,
        [url, url, url, url, url, url, JSON.stringify(url), url, JSON.stringify(url)]
      ))
    );
  }
  const unique = [...new Map(records.map((item) => [item.uid, item])).values()];

  return { users: await people(recorded), related: await people(unique) };
}

export async function details(kind, file) {
  if (typeof file !== "string" || !file || !type(file)) invalid();
  const { stat } = await resolve(kind, file);

  if (!stat.isFile()) invalid();
  return { size: stat.size, time: stat.mtime.toISOString(), ...(await metadata(kind, file)) };
}

export const list = (kind, options) =>
  db.read(async () => {
    const folder = options.folder || "";
    const search = options.q || "";
    const page = options.page || "0";

    if (typeof search !== "string" || search.length > 200 || !/^\d{1,7}$/.test(page)) invalid();
    let target;

    try {
      target = await resolve(kind, folder);
    } catch (error) {
      if (error.code === "ENOENT") return { items: [], total: 0 };
      throw error;
    }
    if (!target.stat.isDirectory()) invalid();
    const matches = new Set(
      kind !== "upload" && search
        ? (
            await db.all(
              `
              SELECT file
              FROM storage.${kind}
              WHERE strpos(lower(text), lower(?)) > 0
            `,
              [search]
            )
          ).map((item) => item.file)
        : []
    );

    const entries = (await fs.readdir(target.file, { withFileTypes: true })).filter(
      (item) =>
        (item.isDirectory() || (item.isFile() && type(item.name))) &&
        (item.name.toLowerCase().includes(search.toLowerCase()) || matches.has(item.name))
    );

    const dates = new Map(
      kind === "upload"
        ? []
        : (
            await db.all(`
            SELECT file, MIN(time) AS time
            FROM storage.${kind}
            GROUP BY file
          `)
          ).map((item) => [item.file, item.time])
    );
    const ordered = [];

    for (let index = 0; index < entries.length; index += 16) {
      const batch = await Promise.all(
        entries.slice(index, index + 16).map(async (item) => {
          const name = [folder, item.name].filter(Boolean).join("/");

          let stat;

          try {
            stat = await fs.lstat(`${target.file}${sep}${item.name}`);
          } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
          }
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return null;
          const date = stat.isFile() ? dates.get(item.name) : null;
          const stamp = date ? Date.parse(`${date.replace(" ", "T")}+09:00`) : NaN;

          return { item, name, stat, stamp: Number.isFinite(stamp) ? stamp : stat.mtimeMs };
        })
      );

      ordered.push(...batch.filter(Boolean));
    }
    ordered.sort(
      (a, b) =>
        Number(b.item.isDirectory()) - Number(a.item.isDirectory()) ||
        (a.item.isFile() ? b.stamp - a.stamp : 0) ||
        a.item.name.localeCompare(b.item.name)
    );

    const selected = ordered.slice(Number(page) * 30, Number(page) * 30 + 30);
    const records = new Map();
    const names = selected.filter(({ stat }) => stat.isFile()).map(({ item }) => item.name);

    if (kind !== "upload" && names.length) {
      const rows = await db.all(
        `
        SELECT file, text, time
        FROM storage.${kind}
        WHERE file IN (${names.map(() => "?").join(",")})
        ORDER BY time, rowid
      `,
        names
      );

      for (const row of rows) if (!records.has(row.file)) records.set(row.file, row);
    }
    const items = [];

    for (const { item, name, stat } of selected) {
      const record = records.get(item.name);

      items.push({
        name: item.name,
        file: name,
        type: item.isDirectory() ? "folder" : type(item.name),
        size: stat.size,
        time: stat.mtime.toISOString(),
        ...(record && { text: record.text, time: record.time })
      });
    }
    return { items, total: ordered.length };
  });
