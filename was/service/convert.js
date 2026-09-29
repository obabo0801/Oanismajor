import * as child from "node:child_process";
import { stat, rename, mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import * as files from "#service/file";
import { randomUUID } from "node:crypto";
import * as path from "#config/path";

export const version = "2";

const tasks = new Map();
const checked = new Map();
const formats = "aac,aiff,amr,asf,avi,flac,flv,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav";
const probe = process.env.FFPROBE?.trim() || "ffprobe";
const ffmpeg = process.env.FFMPEG?.trim() || "ffmpeg";

let tail = Promise.resolve();

export async function inspect(file, kind = "title") {
  return new Promise((resolve, reject) => {
    const fail = (error) => (kind === "title" ? resolve("") : reject(error));

    child.execFile(
      probe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        formats,
        "-show_entries",
        "format=duration,size:format_tags=title:stream=codec_type,duration:stream_tags=title",
        "-of",
        "json",
        file
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 65536 },
      (error, output) => {
        if (error) return fail(error);

        try {
          const data = JSON.parse(output);

          if (kind === "media") {
            resolve(data);
            return;
          }

          if (kind === "cover") {
            resolve(data.streams?.some((item) => item.codec_type === "video") === true);
            return;
          }

          const tags = [data.format?.tags, ...(data.streams || []).map((item) => item.tags)];
          const title = tags
            .flatMap((item) => Object.entries(item || {}))
            .find(([key, value]) => key.toLowerCase() === "title" && typeof value === "string");

          resolve(title?.[1].trim().slice(0, 255) || "");
        } catch (error) {
          fail(error);
        }
      }
    );
  });
}

const stamp = files.stamp;

const read = (file) =>
  stat(file).catch((error) => {
    if (error.code === "ENOENT") return null;

    throw error;
  });

const validate = (before, after) => {
  const fail = (message) => {
    throw Object.assign(new Error(message), { code: "MEDIA_DURATION", status: 415 });
  };

  const duration = (data) => {
    const value = Number(data.format?.duration);

    return Number.isFinite(value) && value > 0 ? value : NaN;
  };
  const first = duration(before);
  const last = duration(after);

  if (!Number.isFinite(first) || !Number.isFinite(last)) fail("Cannot verify video duration");

  if (Math.abs(first - last) > 2)
    fail(`Video duration mismatch: source=${first}s, converted=${last}s`);

  for (const kind of ["video", "audio"]) {
    const source = before.streams?.find((item) => item.codec_type === kind);
    const target = after.streams?.find((item) => item.codec_type === kind);

    if (!source && kind === "audio") continue;

    if (!source || !target) fail(`Missing ${kind} stream`);
    const first = Number(source.duration);
    const last = Number(target.duration);

    if (Number.isFinite(first) && first > 0 && (!Number.isFinite(last) || last <= 0))
      fail(`Cannot verify ${kind} stream duration`);

    if (Number.isFinite(first) && first > 0 && Math.abs(first - last) > 2)
      fail(`${kind} duration mismatch: source=${first}s, converted=${last}s`);
  }
};

const cached = async (source, target, original, saved) => {
  const signature = `${stamp(original)}:${stamp(saved)}`;

  let entry = checked.get(target);

  if (entry?.signature !== signature) {
    const task = (async () => {
      const input = await files.prepare(source, source.split(/[\\/]/).at(-1).slice(0, -4));

      let output;

      try {
        const before = await inspect(input.file, "media");

        try {
          output = await files.prepare(target);
          validate(before, await inspect(output.file, "media"));
        } catch (error) {
          if (["ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "FILE_INTEGRITY"].includes(error.code))
            throw error;

          console.warn("Video cache rejected", target, error.message);
          return false;
        }
      } finally {
        output?.release();
        input.release();
      }

      const [first, last] = await Promise.all([stat(source), stat(target)]);

      if (`${stamp(first)}:${stamp(last)}` !== signature)
        throw Object.assign(new Error("Media changed during validation"), { status: 503 });
      return true;
    })();

    entry = { signature, task };
    if (checked.size >= 128) checked.delete(checked.keys().next().value);

    checked.set(target, entry);
  }

  try {
    return await entry.task;
  } catch (error) {
    if (checked.get(target) === entry) checked.delete(target);

    throw error;
  }
};

export default async function convert(name, kind) {
  if (!/^[a-f0-9]{32}\.bin$/.test(name) || !["audio", "video", "cover"].includes(kind))
    throw Object.assign(new Error("Invalid media"), { status: 400 });

  const source = path.upload("files", "original", name);
  const target = path.upload(
    "files",
    kind === "video" ? `cache/v${version}` : "cache",
    `${name.slice(0, -4)}.${{ audio: "mp3", video: "mp4", cover: "jpg" }[kind]}`
  );

  const original = await stat(source).catch((error) => {
    if (error.code === "ENOENT") error.status = 404;

    throw error;
  });

  const saved = await read(target);

  if (saved && (kind !== "video" || (await cached(source, target, original, saved)))) return target;

  const key = `${name}:${kind}`;
  const task = tasks.get(key);

  if (task?.empty) return false;

  if (task?.failed)
    throw Object.assign(new Error("Media conversion failed"), { status: task.status });

  if (task) return null;

  if ([...tasks.values()].filter((item) => !item.failed && !item.empty).length >= 8)
    throw Object.assign(new Error("Media conversion busy"), { status: 503 });

  const state = {};

  tasks.set(key, state);
  tail = tail
    .catch(() => {})
    .then(async () => {
      let temporary = `${target}.${randomUUID()}`;
      let prepared;
      let directory;

      try {
        prepared = await files.prepare(source, name.slice(0, -4));

        const input = prepared.file;

        if (files.external(source)) {
          directory = await mkdtemp(`${os.tmpdir()}/oanismajor-convert-`);
          temporary = `${directory}/output`;
        }

        if (kind === "cover" && !(await inspect(input, kind))) {
          state.empty = true;
          return;
        }

        const before = kind === "video" ? await inspect(input, "media") : null;

        await path.mkdir(path.upload("files", kind === "video" ? `cache/v${version}` : "cache"), {
          recursive: true
        });

        await new Promise((resolve, reject) => {
          let detail = "";

          const process = child.spawn(
            ffmpeg,
            [
              "-nostdin",
              ...(kind === "video" ? ["-xerror"] : []),
              "-hide_banner",
              "-loglevel",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-format_whitelist",
              formats,
              "-threads",
              "2",
              "-i",
              input,
              "-threads",
              "2",
              "-map_metadata",
              "-1",
              ...(kind === "cover"
                ? [
                    "-map",
                    "0:v:0",
                    "-an",
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=1024:1024:force_original_aspect_ratio=decrease",
                    "-f",
                    "image2"
                  ]
                : kind === "audio"
                  ? ["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3"]
                  : [
                      "-map",
                      "0:v:0",
                      "-map",
                      "0:a:0?",
                      "-vf",
                      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                      "-c:v",
                      "libx264",
                      "-preset",
                      "veryfast",
                      "-crf",
                      "23",
                      "-pix_fmt",
                      "yuv420p",
                      "-c:a",
                      "aac",
                      "-movflags",
                      "+faststart",
                      "-f",
                      "mp4"
                    ]),
              "-y",
              temporary
            ],
            {
              windowsHide: true,
              stdio: ["ignore", "ignore", "pipe"],
              timeout: 1_200_000,
              killSignal: "SIGKILL"
            }
          );

          process.stderr.setEncoding("utf8");
          process.stderr.on("data", (value) => {
            detail = (detail + value).slice(-8192);
          });

          process.once("error", reject);
          process.once("close", (code) =>
            code === 0 ? resolve() : reject(new Error(detail.trim() || "Media conversion failed"))
          );
        });

        if (kind === "video") {
          validate(before, await inspect(temporary, "media"));
          if (stamp(await stat(source)) !== stamp(original))
            throw Object.assign(new Error("Source changed during conversion"), { status: 503 });
        }

        if (directory) await files.write(temporary, target);
        else await rename(temporary, target);

        checked.delete(target);
        tasks.delete(key);
      } catch (error) {
        state.failed = true;
        state.status =
          error.status || (["ENOENT", "EACCES", "EPERM"].includes(error.code) ? 500 : 415);

        console.error("Media conversion failed", name, kind, error);
      } finally {
        if (state.failed || state.empty) {
          const timer = setTimeout(() => tasks.delete(key), 60_000);

          timer.unref();
        }

        await path.rm(temporary, { force: true }).catch(() => {});
        if (directory) await path.rm(directory, { recursive: true, force: true }).catch(() => {});

        prepared?.release();
      }
    });

  return null;
}
