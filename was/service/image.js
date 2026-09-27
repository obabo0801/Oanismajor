import sharp from "sharp";
import * as fs from "node:fs/promises";
import record from "#service/upload";

import * as path from "#config/path";
import hash from "#config/hash";
import * as media from "#config/media";
import { transform, maxPixels } from "#service/image/transform";

export { transform };

export async function prepare() {
  for (const folder of ["users", "images"]) {
    const source = path.upload(folder, "resizing");
    const target = path.upload(folder, "cache");

    let entries;

    try {
      if ((await fs.lstat(source)).isSymbolicLink()) continue;

      entries = await fs.readdir(source, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }

    await fs.mkdir(target, { recursive: true });
    if ((await fs.lstat(target)).isSymbolicLink()) throw new Error("Invalid image cache");

    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{32}\.webp$/.test(entry.name)) continue;
      const previous = path.upload(folder, "resizing", entry.name);
      const next = path.upload(folder, "cache", entry.name);

      try {
        await fs.link(previous, next);
      } catch (error) {
        if (error.code === "ENOENT") continue;

        if (error.code !== "EEXIST") throw error;

        if ((await fs.lstat(next)).isSymbolicLink()) throw new Error("Invalid image cache");
        const original = await fs.readFile(previous).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });

        if (!original) continue;
        const cached = await fs.readFile(next);

        if (!original.equals(cached)) throw new Error("Image cache conflict");
      }

      await fs.unlink(previous).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }

    await fs.rmdir(source).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
    });
  }
}

const extensions = { gif: "gif", jpeg: "jpg", png: "png", webp: "webp" };

const save = async (target, data) => {
  try {
    await path.writeFile(target, data, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
};

export default async function store(data, folder, options) {
  let source;
  let metadata;
  let original = data;

  try {
    if (options.edit) {
      original = await transform(data, options.edit, options.quality);

      if (!original) {
        return null;
      }
    }

    source = sharp(original, { animated: true, failOn: "error", limitInputPixels: maxPixels });

    metadata = await source.metadata();
  } catch {
    return null;
  }

  const extension = extensions[metadata.format];

  if (!extension) {
    return null;
  }

  const { quality } = options;
  const resize = { ...options };

  delete resize.quality;
  delete resize.edit;
  delete resize.uid;

  const animation =
    (metadata.pages || 1) > 1
      ? { loop: metadata.loop ?? 0, ...(metadata.delay ? { delay: metadata.delay } : {}) }
      : {};

  const resized = await source
    .clone()
    .autoOrient()
    .resize({ ...resize, withoutEnlargement: true })
    .webp({ quality, ...animation })
    .toBuffer();
  const orig = `${hash(32, original)}.${extension}`;
  const webp = `${hash(32, resized)}.webp`;
  const originals = path.upload(folder, "original");

  const cache = path.upload(folder, "cache");

  await Promise.all([
    path.mkdir(originals, { recursive: true }),
    path.mkdir(cache, { recursive: true })
  ]);

  await Promise.all([
    save(path.upload(folder, "original", orig), original),
    save(path.upload(folder, "cache", webp), resized)
  ]);

  await record(options.uid, `${folder}/original/${orig}`, `${folder}/cache/${webp}`);

  return { original: media.url(folder, "original", orig), cache: media.url(folder, "cache", webp) };
}
