import { randomUUID } from "node:crypto";
import * as files from "#service/file";
import sharp from "sharp";
import * as db from "#db";
import connect from "#db/connect";
import store from "#service/image";
import { maxPixels } from "#service/image/transform";
import { accept } from "#service/ogq";
import * as rules from "#shared/attach";
import maximum from "#shared/upload";
import * as path from "#config/path";
import * as media from "#config/media";
import hash from "#config/hash";
import record from "#service/upload";
import * as convert from "#service/convert";

const temporary = connect("runtime");

const mime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

const fail = (status) => {
  throw Object.assign(new Error("Invalid attachment"), { status });
};

const receipt = async (user, item) => {
  const token = randomUUID();
  const expires = Date.now() + 30 * 60_000;

  await temporary.run(
    `
      INSERT INTO runtime.attachment (token, uid, item, expires)
      VALUES (?, ?, ?::jsonb, ?)
    `,
    [token, user.uid, JSON.stringify(item), expires]
  );

  return { token, expires };
};

export const upload = async (user, data, type, adjustment, filename) => {
  if (
    (!Buffer.isBuffer(data) && !(filename !== undefined && data?.file && data?.digest)) ||
    !data.length ||
    (filename === undefined && !rules.types.includes(type))
  )
    fail(415);

  if (data.length > maximum) fail(413);

  await temporary.run(
    `
      DELETE FROM runtime.attachment
      WHERE expires <= ?
    `,
    [Date.now()]
  );

  const count = await temporary.get(
    `
      SELECT count(*) AS total, count(*) FILTER (WHERE uid = ?) AS owned
      FROM runtime.attachment
    `,
    [user.uid]
  );

  if (count.total >= 1000 || count.owned >= 30) fail(429);

  if (filename !== undefined) {
    let name;

    try {
      name = decodeURIComponent(filename)
        .replace(/[/\\\x00-\x1f\x7f]/g, "")
        .trim();
    } catch {
      fail(400);
    }
    if (!name || name.length > 255) fail(400);
    const file = `${data.digest || hash(32, data)}.bin`;

    await files.save(data, path.upload("files", "original", file));
    await record(user.uid, `files/original/${file}`);

    const title = rules.mime(name).startsWith("audio/")
      ? await convert.inspect(path.upload("files", "original", file))
      : "";

    return receipt(user, {
      type: "file",
      name,
      ...(title && { title }),
      size: data.length,
      file: media.url("files", "original", file),
      mime: rules.mime(name)
    });
  }
  let metadata;

  try {
    metadata = await sharp(data, {
      animated: true,
      limitInputPixels: maxPixels,
      failOn: "error"
    }).metadata();
  } catch {
    fail(415);
  }

  if (mime[metadata.format] !== type) fail(415);
  let edit;

  if (adjustment !== undefined) {
    try {
      edit = JSON.parse(adjustment);
    } catch {
      fail(400);
    }

    if (
      !edit ||
      !["width", "height", "angle", "scale", "x", "y"].every(
        (key) => typeof edit[key] === "number" && Number.isFinite(edit[key])
      ) ||
      edit.width < (edit.shape === "original" ? 1 : 64) ||
      edit.width > 1024 ||
      edit.height < (edit.shape === "original" ? 1 : 64) ||
      edit.height > 1024 ||
      edit.scale < 1 ||
      edit.scale > 3 ||
      Math.abs(edit.x) > 1 ||
      Math.abs(edit.y) > 1 ||
      !["square", "original"].includes(edit.shape)
    )
      fail(400);

    if (edit.shape === "original") {
      const swap = metadata.orientation >= 5 && metadata.orientation <= 8;
      const width = swap ? metadata.height : metadata.width;
      const height = swap ? metadata.width : metadata.pageHeight || metadata.height;
      const ratio = Math.min(1, 1024 / Math.max(width, height));

      edit.width = Math.max(1, Math.round(width * ratio));
      edit.height = Math.max(1, Math.round(height * ratio));
    }

    edit = Object.fromEntries(
      ["width", "height", "shape", "angle", "scale", "x", "y"].map((key) => [key, edit[key]])
    );
  }

  const saved = await store(data, "images", {
    uid: user.uid,
    width: 1280,
    height: 1280,
    fit: "inside",
    quality: 85,
    ...(edit && { edit })
  });

  if (!saved) fail(415);
  const item = {
    type: type === "image/gif" ? "gif" : "image",
    image: saved.original,
    preview: saved.cache,
    mime: type,
    size: data.length,
    ...(edit && { edit })
  };

  return receipt(user, item);
};

export const resolve = async (user, items = []) => {
  if (!Array.isArray(items) || items.length > rules.maximum) fail(400);

  const result = [];

  for (const value of items) {
    if (value?.provider === "giphy") {
      const item = rules.giphy(value);

      if (!item) fail(400);

      result.push(item);
      continue;
    }

    if (value?.type === "ogq") {
      const item = await accept(value);

      if (!item) fail(400);

      result.push(item);
      continue;
    }

    if (typeof value?.token !== "string") fail(400);
    const entry = await db.get(
      `
        SELECT uid, item
        FROM runtime.attachment
        WHERE token = ? AND uid = ? AND expires > ?
      `,
      [value.token, user.uid, Date.now()]
    );

    if (
      !entry ||
      entry.uid !== user.uid ||
      entry.item.type !== value.type ||
      typeof value.description !== "string" ||
      value.description.length > rules.description ||
      typeof value.spoiler !== "boolean"
    )
      fail(400);

    const extra = {};

    if (value.title !== undefined || value.cover !== undefined || value.artist !== undefined) {
      if (entry.item.type !== "file" || !/^(audio|video)\//.test(entry.item.mime || "")) fail(400);

      if (value.title !== undefined) {
        if (typeof value.title !== "string" || value.title.length > 255) fail(400);

        extra.title = value.title.trim();
      }

      if (value.cover === false) extra.cover = false;
      else if (value.cover !== undefined) {
        if (typeof value.cover !== "string") fail(400);
        const cover = await db.get(
          `SELECT item FROM runtime.attachment WHERE token = ? AND uid = ? AND expires > ?`,
          [value.cover, user.uid, Date.now()]
        );

        if (!cover || !["image", "gif"].includes(cover.item.type)) fail(400);

        extra.cover = cover.item.preview;
      }

      if (value.artist !== undefined) {
        if (
          !entry.item.mime.startsWith("audio/") ||
          typeof value.artist !== "string" ||
          value.artist.length > 255
        )
          fail(400);

        extra.artist = value.artist.trim();
      }
    }

    result.push({
      ...entry.item,
      ...extra,
      description: value.description.trim(),
      spoiler: value.spoiler
    });
  }

  return result;
};

export const consume = async (user, items) => {
  for (const item of items) {
    if (typeof item.token !== "string") continue;

    await db.run(
      `
        DELETE FROM runtime.attachment
        WHERE token IN (?, ?) AND uid = ?
      `,
      [item.token, item.cover || item.token, user.uid]
    );
  }
};

export const send = async (user, scope, token, items, work) => {
  if (
    token !== undefined &&
    (typeof token !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(token))
  )
    fail(400);

  return db.transaction(async () => {
    await db.run(
      `
        DELETE FROM runtime.request
        WHERE expires <= ?
      `,
      [Date.now()]
    );

    if (token) {
      const saved = await db.get(
        `
          SELECT result
          FROM runtime.request
          WHERE uid = ? AND scope = ? AND token = ?
        `,
        [user.uid, scope, token]
      );

      if (saved) {
        await db.run(
          `
            UPDATE runtime.request
            SET expires = ?
            WHERE uid = ? AND scope = ? AND token = ?
          `,
          [Date.now() + 86400000, user.uid, scope, token]
        );

        return saved.result;
      }
    }

    const result = await work(await resolve(user, items));

    await consume(user, items);
    if (token)
      await db.run(
        `
          INSERT INTO runtime.request (uid, scope, token, result, expires)
          VALUES (?, ?, ?, ?, ?)
        `,
        [user.uid, scope, token, JSON.stringify(result), Date.now() + 86400000]
      );

    return result;
  });
};

export const read = (value) => {
  try {
    const items = typeof value === "string" ? JSON.parse(value) : value;

    return rules.valid(items) ? items : [];
  } catch {
    return [];
  }
};
