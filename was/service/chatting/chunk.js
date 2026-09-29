import * as fs from "node:fs/promises";
import * as os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import * as path from "#config/path";
import hash from "#config/hash";
import maximum from "#shared/upload";
import * as attachment from "#service/chatting/attach";

const size = 3 * 1024 * 1024;
const root = path.upload(".pending");
const local =
  process.platform === "win32" &&
  process.env.NODE_ENV === "development" &&
  /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+\//i.test(root.replaceAll("\\", "/"));

const fail = (status, code = "invalid") => {
  throw Object.assign(new Error("Invalid upload"), { status, code });
};

const read = async (folder, name) => {
  try {
    return JSON.parse(await fs.readFile(`${folder}/${name}`, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;

    throw error;
  }
};

const write = async (folder, name, value) => {
  const file = `${folder}/${randomUUID()}`;

  try {
    await fs.writeFile(file, JSON.stringify(value), { flag: "wx" });
    await fs.rename(file, `${folder}/${name}`);
  } finally {
    await fs.rm(file, { force: true });
  }
};

const locate = (user, id) => {
  if (
    typeof id !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)
  )
    fail(400);

  return `${root}/${hash(32, user.uid)}-${id}`;
};

export async function status(user, id) {
  const folder = locate(user, id);
  const info = await read(folder, "info");

  if (!info) fail(404, "missing");
  const result = await read(folder, "result");

  if (result) {
    if (result.expires <= Date.now()) fail(410, "expired");

    return result;
  }

  const error = await read(folder, "error");

  if (error) return { failed: true, status: error.status, code: error.code };
  const lock = await fs.stat(`${folder}/lock`).catch((error) => {
    if (error.code === "ENOENT") return null;

    throw error;
  });

  if (!lock) fail(409, "incomplete");

  if (Date.now() - lock.mtimeMs > 60 * 60_000) fail(410, "expired");

  return { pending: true, offset: info.total, retry: 2 };
}

const clean = async () => {
  for (const entry of await fs.readdir(root).catch(() => [])) {
    const folder = `${root}/${entry}`;
    const stat = await fs.stat(folder).catch(() => null);

    if (!stat || stat.mtimeMs >= Date.now() - 60 * 60_000) continue;
    const lock = await fs.stat(`${folder}/lock`).catch(() => null);

    if (!lock || lock.mtimeMs < Date.now() - 60 * 60_000)
      await fs.rm(folder, { recursive: true, force: true });
  }
};

setInterval(() => void clean().catch(() => {}), 15 * 60_000).unref();

export default async function chunk(user, body, headers) {
  const id = headers.id;
  const offset = Number(headers.offset);
  const total = Number(headers.size);

  const folder = locate(user, id);

  if (!Number.isSafeInteger(total) || total <= size || total > maximum) fail(413);

  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total || offset % size) fail(400);

  if (!Buffer.isBuffer(body) || body.length !== Math.min(size, total - offset)) fail(400);

  if (!headers.name || headers.name.length > 2300) fail(400);

  await fs.mkdir(root, { recursive: true });

  const owner = hash(32, user.uid);

  try {
    await fs.access(folder);
  } catch {
    const entries = (
      await Promise.all(
        (await fs.readdir(root)).map(
          async (entry) =>
            await fs.access(`${root}/${entry}/result`).then(
              () => null,
              () => entry
            )
        )
      )
    ).filter(Boolean);

    if (
      entries.length >= 100 ||
      entries.filter((entry) => entry.startsWith(`${owner}-`)).length >= 3
    )
      fail(429);

    await fs.mkdir(folder, { recursive: true });
  }
  const metadata = JSON.stringify({ total, name: headers.name });

  try {
    await fs.writeFile(`${folder}/info`, metadata, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    if ((await fs.readFile(`${folder}/info`, "utf8")) !== metadata) fail(409, "conflict");
  }
  const saved = await read(folder, "result");

  if (saved) {
    if (saved.expires <= Date.now()) fail(410, "expired");

    return saved;
  }

  if (
    await fs.access(`${folder}/lock`).then(
      () => true,
      () => false
    )
  ) {
    if (headers.wait === true) return { pending: true, offset: total, retry: 2 };

    fail(409, "busy");
  }

  const temporary = `${folder}/${randomUUID()}`;

  try {
    await fs.writeFile(temporary, body, { flag: "wx" });
    await fs.rename(temporary, `${folder}/${offset}`);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  if (offset + body.length < total) return { offset: offset + body.length };
  try {
    await fs.mkdir(`${folder}/lock`);
  } catch (error) {
    if (error.code === "EEXIST") {
      if (headers.wait === true) return { pending: true, offset: total, retry: 2 };

      fail(409, "busy");
    }

    throw error;
  }

  const task = finish(user, folder, total, headers.name);

  if (headers.wait !== true) return task;

  void task.catch((error) => console.error("Upload finalization failed", id, error));
  return { pending: true, offset: total, retry: 2 };
}

async function finish(user, folder, total, name) {
  let directory;

  try {
    const saved = await read(folder, "result");

    if (saved) return saved;

    await fs.rm(`${folder}/error`, { force: true });
    if (local) directory = await fs.mkdtemp(`${os.tmpdir()}/oanismajor-upload-`);
    const digest = createHash("sha256");
    const file = `${directory || folder}/file`;
    const output = await fs.open(file, "w");

    try {
      for (let position = 0; position < total; position += size) {
        const part = await fs.readFile(`${folder}/${position}`).catch(() => null);

        if (!part || part.length !== Math.min(size, total - position)) fail(409, "incomplete");

        digest.update(part);
        await output.writeFile(part);
      }
      await output.sync();
    } finally {
      await output.close();
    }
    const result = await attachment.upload(
      user,
      { file, length: total, digest: digest.digest("hex").slice(0, 32) },
      "application/octet-stream",
      undefined,
      name
    );

    await write(folder, "result", result);
    await Promise.all(
      (await fs.readdir(folder))
        .filter((name) => /^\d+$/.test(name) || name === "file")
        .map((name) => fs.rm(`${folder}/${name}`, { force: true }))
    );

    return result;
  } catch (error) {
    await write(folder, "error", {
      status:
        Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
          ? error.status
          : 500,
      code: ["incomplete", "FILE_INTEGRITY"].includes(error.code) ? error.code : "failed"
    }).catch((failure) => console.error("Upload result write failed", failure));

    throw error;
  } finally {
    try {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    } finally {
      await fs.rm(`${folder}/lock`, { recursive: true, force: true });
    }
  }
}
