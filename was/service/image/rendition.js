import sharp from "sharp";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { sep } from "node:path";
import * as path from "#config/path";
import { routes } from "#config/media";
import media from "#service/media";
import { maxPixels } from "#service/image/transform";
import * as rules from "#shared/rendition";

const tasks = new Map();
const queue = [];
const maximum = 2;
const capacity = 32;

let running = 0;

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

const regular = async (file) => {
  try {
    const stat = await fs.lstat(file);

    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;

    throw error;
  }
};

const advance = () => {
  while (running < maximum && queue.length) {
    const task = queue.shift();

    running += 1;
    Promise.resolve()
      .then(task.run)
      .then(task.resolve, task.reject)
      .finally(() => {
        running -= 1;
        advance();
      });
  }
};

const schedule = (run, priority) =>
  new Promise((resolve, reject) => {
    if (queue.length >= capacity) {
      reject(Object.assign(new Error("Image queue full"), { status: 503 }));
      return;
    }

    const task = { run, resolve, reject };

    if (priority) queue.unshift(task);
    else queue.push(task);

    advance();
  });

export default async function rendition(id, size, automatic = false) {
  if (!/^[a-f0-9]{32}$/.test(id) || !rules.sizes.includes(size)) {
    fail(400, "Invalid image size");
  }

  const location = await media(id);
  const route = routes.find(
    (item) => !item.directory.startsWith("audio/") && location.startsWith(`${item.prefix}/`)
  );
  const name = location.split("/").at(-1);

  if (!route || !/^[a-f0-9]{32}\.(gif|jpg|png|webp)$/.test(name)) {
    fail(404, "Missing image");
  }

  const input = path.upload(route.directory, name);
  const stat = await fs.lstat(input).catch((error) => {
    if (error.code === "ENOENT") fail(404, "Missing image");

    throw error;
  });

  if (!stat.isFile() || stat.isSymbolicLink()) fail(404, "Missing image");

  if (!stat.size || stat.size > 128 * 1024 * 1024) {
    fail(413, "Image file too large");
  }

  const directory = await fs.realpath(path.upload(route.directory));
  const source = await fs.realpath(input);

  if (!source.startsWith(`${directory}${sep}`)) fail(404, "Invalid image");

  const folder = path.upload("images", "cache");
  const output = path.upload("images", "cache", `${id}-${size}.webp`);

  if (!automatic && (await regular(output))) return output;

  const key = `${id}:${size}:${Number(automatic)}`;

  if (tasks.has(key)) return tasks.get(key);

  const task = schedule(async () => {
    if (automatic) {
      const info = await sharp(source, { failOn: "error", limitInputPixels: maxPixels })
        .metadata()
        .catch((error) => {
          error.status ||= 422;
          throw error;
        });

      const dimensions = {
        bytes: stat.size,
        width: info.width,
        height: info.pageHeight || info.height,
        pages: info.pages || 1
      };

      if (!rules.large(dimensions)) return source;
    }

    await fs.mkdir(folder, { recursive: true });
    if (await regular(output)) return output;

    const temporary = `${output}.${randomUUID()}.tmp`;

    try {
      await sharp(source, {
        page: 0,
        pages: 1,
        animated: false,
        failOn: "error",
        limitInputPixels: maxPixels
      })
        .autoOrient()
        .resize(size, size, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: size === 160 ? 70 : 82, effort: 3 })
        .timeout({ seconds: 15 })
        .toFile(temporary);

      await fs.rename(temporary, output);

      return output;
    } catch (error) {
      if (!error.status) error.status = 422;

      throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }, size > 160);

  tasks.set(key, task);
  try {
    return await task;
  } finally {
    if (tasks.get(key) === task) tasks.delete(key);
  }
}
