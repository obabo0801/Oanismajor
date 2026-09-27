import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import * as path from "#config/path";
import hash from "#config/hash";
import maximum from "#shared/upload";
import * as attachment from "./attach.js";

const size = 3 * 1024 * 1024;
const root = path.upload(".pending");
const fail = (status) => {
  throw Object.assign(new Error("Invalid upload"), { status });
};

const clean = async () => {
  for (const entry of await fs.readdir(root).catch(() => [])) {
    const folder = `${root}/${entry}`;
    const stat = await fs.stat(folder).catch(() => null);

    if (stat && stat.mtimeMs < Date.now() - 60 * 60_000)
      await fs.rm(folder, { recursive: true, force: true });
  }
};

setInterval(() => void clean().catch(() => {}), 15 * 60_000).unref();

export default async function chunk(user, body, headers) {
  const id = headers.id;
  const offset = Number(headers.offset);
  const total = Number(headers.size);

  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) fail(400);

  if (!Number.isSafeInteger(total) || total <= size || total > maximum) fail(413);

  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total || offset % size) fail(400);

  if (!Buffer.isBuffer(body) || body.length !== Math.min(size, total - offset)) fail(400);

  if (!headers.name || headers.name.length > 2300) fail(400);

  await fs.mkdir(root, { recursive: true });

  const owner = hash(32, user.uid);
  const folder = `${root}/${owner}-${id}`;

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

    if ((await fs.readFile(`${folder}/info`, "utf8")) !== metadata) fail(409);
  }
  const saved = await fs.readFile(`${folder}/result`, "utf8").catch(() => null);

  if (saved) return JSON.parse(saved);

  if (
    await fs.access(`${folder}/lock`).then(
      () => true,
      () => false
    )
  )
    fail(409);
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
    if (error.code === "EEXIST") fail(409);
    throw error;
  }
  try {
    const digest = createHash("sha256");
    const file = `${folder}/file`;
    const output = await fs.open(file, "w");

    try {
      for (let position = 0; position < total; position += size) {
        const part = await fs.readFile(`${folder}/${position}`).catch(() => null);

        if (!part || part.length !== Math.min(size, total - position)) fail(409);

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
      headers.name
    );

    await fs.writeFile(`${folder}/result`, JSON.stringify(result));
    await Promise.all(
      (await fs.readdir(folder))
        .filter((name) => /^\d+$/.test(name) || name === "file")
        .map((name) => fs.rm(`${folder}/${name}`, { force: true }))
    );

    return result;
  } finally {
    await fs.rm(`${folder}/lock`, { recursive: true, force: true });
  }
}
