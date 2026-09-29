import * as fs from "node:fs";
import path from "node:path";
import * as os from "node:os";
import * as child from "node:child_process";
import * as crypto from "node:crypto";
import * as stream from "node:stream";
import { pipeline } from "node:stream/promises";

const disk = fs.promises;
const copies = new Map();
const maximum = 2 * 1024 ** 3;
const lifetime = 10 * 60_000;

export const external = (value) =>
  process.platform === "win32" &&
  process.env.NODE_ENV === "development" &&
  /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+\//i.test(value.replaceAll("\\", "/"));

export const stamp = (value) => `${value.size}:${value.mtimeMs}:${value.ctimeMs}`;

const failure = (message) =>
  Object.assign(new Error(message), { code: "FILE_INTEGRITY", status: 422 });

const info = (file) =>
  disk.stat(file).catch((error) => {
    if (error.code === "ENOENT") return null;

    throw error;
  });

// Explicit backpressure, bounded buffers, and a timeout for stalled storage reads.
const transfer = async (source, target, expected = {}) => {
  const digest = crypto.createHash("sha256");
  const controller = new AbortController();
  const started = Date.now();

  let bytes = 0;
  let updated = started;
  let stalled;

  const timer = setInterval(() => {
    if (Date.now() - updated < 120_000 && Date.now() - started < 1_200_000) return;

    stalled = Object.assign(new Error("File transfer timed out"), {
      code: "ETIMEDOUT",
      status: 503
    });

    controller.abort(stalled);
  }, 1000);

  timer.unref();

  const remote =
    typeof source === "string" && external(source)
      ? /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)$/i.exec(source.replaceAll("\\", "/"))
      : null;

  const process = remote
    ? child.spawn("wsl.exe", ["--distribution", remote[1], "--exec", "/bin/cat", "--", remote[2]], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        signal: controller.signal
      })
    : null;

  let detail = "";

  const complete = process
    ? new Promise((resolve, reject) => {
        process.stderr.setEncoding("utf8");
        process.stderr.on("data", (value) => {
          detail = (detail + value).slice(-8192);
        });

        process.once("error", reject);
        process.once("close", (code) => {
          if (code === 0) resolve();
          else
            reject(
              Object.assign(new Error(detail.trim() || "WSL file read failed"), { status: 503 })
            );
        });
      })
    : Promise.resolve();

  const input =
    process?.stdout ||
    (Buffer.isBuffer(source)
      ? stream.Readable.from([source])
      : fs.createReadStream(source, { highWaterMark: 1024 * 1024 }));

  const meter = new stream.Transform({
    transform(part, _, done) {
      bytes += part.length;
      updated = Date.now();
      if (expected.size !== undefined && bytes > expected.size) {
        done(failure("File grew while reading"));
        return;
      }

      digest.update(part);
      done(null, part);
    }
  });

  const output = target
    ? fs.createWriteStream(target, { flags: "wx", highWaterMark: 1024 * 1024 })
    : new stream.Transform({
        transform(_, encoding, done) {
          done();
        }
      });

  const tasks = [pipeline(input, meter, output, { signal: controller.signal }), complete];

  try {
    await Promise.all(tasks);

    const hash = digest.digest("hex");

    if (expected.size !== undefined && bytes !== expected.size)
      throw failure(`File size mismatch: expected=${expected.size}, actual=${bytes}`);

    if (expected.digest && !hash.startsWith(expected.digest))
      throw failure("File SHA-256 mismatch; the stored bytes could not be verified");

    return { size: bytes, digest: hash };
  } catch (error) {
    controller.abort();
    await Promise.allSettled(tasks);
    throw stalled || error;
  } finally {
    clearInterval(timer);
  }
};

// Never expose a partially written final pathname, even if a duplicate upload arrives.
export async function write(source, target, expected = {}) {
  const before = Buffer.isBuffer(source) ? null : await disk.stat(source);
  const size = expected.size ?? (before ? before.size : source.length);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}`
  );

  await disk.mkdir(path.dirname(target), { recursive: true });
  try {
    const result = await transfer(source, temporary, { ...expected, size });

    // Re-read the destination: a successful copy call is not an integrity check.
    await transfer(temporary, null, result);
    if (before && stamp(before) !== stamp(await disk.stat(source)))
      throw failure("Source changed while copying");

    await disk.rename(temporary, target);
    return result;
  } finally {
    await disk.rm(temporary, { force: true });
  }
}

export async function save(data, target) {
  const expected = {
    size: data.length,
    digest: data.digest || crypto.createHash("sha256").update(data).digest("hex")
  };
  const previous = await info(target);

  if (previous?.size === expected.size) {
    try {
      await transfer(target, null, expected);
      if (stamp(previous) === stamp(await disk.stat(target))) return;
    } catch (error) {
      if (error.code !== "FILE_INTEGRITY" && error.code !== "ENOENT") throw error;
    }
  }

  await write(data.file || data, target, expected);
}

const drop = async (key, entry) => {
  if (entry.users || copies.get(key) !== entry) return;

  copies.delete(key);
  try {
    await entry.task;
  } catch {}

  if (entry.directory) await disk.rm(entry.directory, { recursive: true, force: true });
};

const clean = async () => {
  for (const [key, entry] of copies)
    if (!entry.users && Date.now() - entry.used > lifetime) await drop(key, entry);
};

setInterval(() => void clean().catch(() => {}), 60_000).unref();

process.once("exit", () => {
  for (const entry of copies.values()) {
    if (!entry.directory) continue;

    try {
      fs.rmSync(entry.directory, { recursive: true, force: true });
    } catch {}
  }
});

// Share a verified Windows-local snapshot between Range requests and FFmpeg.
// The original/shared storage remains authoritative; active snapshots are never evicted.
export async function prepare(source, digest = "") {
  if (!external(source)) return { file: source, release() {} };
  const original = await disk.stat(source);

  if (!original.isFile()) throw Object.assign(new Error("Media is not a file"), { status: 404 });
  const signature = stamp(original);
  const key = `${source}:${signature}:${digest}`;

  let entry = copies.get(key);

  if (!entry) {
    let bytes = [...copies.values()].reduce((total, item) => total + item.size, 0);

    for (const [key, value] of [...copies].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes + original.size <= maximum) break;

      if (value.users) continue;

      await drop(key, value);
      bytes -= value.size;
    }

    // Recheck after awaiting eviction, because another request may have prepared the same source.
    entry = copies.get(key);
    if (!entry) {
      bytes = [...copies.values()].reduce((total, item) => total + item.size, 0);
      if (bytes + original.size > maximum)
        throw Object.assign(new Error("Local media cache is busy"), { status: 503 });

      entry = { size: original.size, used: Date.now(), users: 0, directory: null };
      copies.set(key, entry);

      const current = entry;

      current.task = (async () => {
        console.info("Media snapshot started", path.basename(source), original.size);
        current.directory = await disk.mkdtemp(path.join(os.tmpdir(), "oanismajor-media-"));

        const file = path.join(current.directory, path.basename(source));

        await write(source, file, { size: original.size, digest });
        if (signature !== stamp(await disk.stat(source)))
          throw failure("Source changed while preparing playback");

        await disk.utimes(file, original.atime, original.mtime);
        console.info("Media snapshot ready", path.basename(source));
        return file;
      })();
    }
  }

  entry.users++;

  let released = false;

  const release = () => {
    if (released) return;

    released = true;
    entry.users--;
    entry.used = Date.now();
  };

  try {
    return { file: await entry.task, release };
  } catch (error) {
    release();
    await drop(key, entry).catch(() => {});
    throw error;
  }
}
