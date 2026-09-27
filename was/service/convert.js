import * as child from "node:child_process";
import { stat, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "#config/path";

const tasks = new Map();

let tail = Promise.resolve();

export async function inspect(file) {
  return new Promise((resolve) => {
    child.execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "aac,aiff,amr,asf,avi,flac,flv,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav",
        "-show_entries",
        "format_tags=title:stream_tags=title",
        "-of",
        "json",
        file
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 65536 },
      (error, output) => {
        if (error) return resolve("");
        try {
          const data = JSON.parse(output);
          const tags = [data.format?.tags, ...(data.streams || []).map((item) => item.tags)];
          const title = tags
            .flatMap((item) => Object.entries(item || {}))
            .find(([key, value]) => key.toLowerCase() === "title" && typeof value === "string");

          resolve(title?.[1].trim().slice(0, 255) || "");
        } catch {
          resolve("");
        }
      }
    );
  });
}

export default async function convert(name, kind) {
  if (!/^[a-f0-9]{32}\.bin$/.test(name) || !["audio", "video", "cover"].includes(kind))
    throw Object.assign(new Error("Invalid media"), { status: 400 });
  const source = path.upload("files", "original", name);
  const target = path.upload(
    "files",
    "cache",
    `${name.slice(0, -4)}.${{ audio: "mp3", video: "mp4", cover: "jpg" }[kind]}`
  );

  await stat(source).catch((error) => {
    if (error.code === "ENOENT") error.status = 404;
    throw error;
  });

  if (
    await stat(target).then(
      () => true,
      () => false
    )
  )
    return target;
  const key = `${name}:${kind}`;
  const task = tasks.get(key);

  if (task?.failed) throw Object.assign(new Error("Media conversion failed"), { status: 415 });

  if (task) return null;

  if (tasks.size >= 8) throw Object.assign(new Error("Media conversion busy"), { status: 503 });
  const state = {};

  tasks.set(key, state);
  tail = tail
    .catch(() => {})
    .then(async () => {
      const temporary = `${target}.${randomUUID()}`;

      try {
        await path.mkdir(path.upload("files", "cache"), { recursive: true });
        await new Promise((resolve, reject) => {
          const process = child.spawn(
            "ffmpeg",
            [
              "-nostdin",
              "-hide_banner",
              "-loglevel",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-format_whitelist",
              "aac,aiff,amr,asf,avi,flac,flv,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav",
              "-i",
              source,
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
            { windowsHide: true, stdio: "ignore", timeout: 1_200_000, killSignal: "SIGKILL" }
          );

          process.once("error", reject);
          process.once("exit", (code) =>
            code === 0 ? resolve() : reject(new Error("Media conversion failed"))
          );
        });

        await rename(temporary, target);
        tasks.delete(key);
      } catch {
        state.failed = true;

        const timer = setTimeout(() => tasks.delete(key), 60_000);

        timer.unref();
      } finally {
        await path.rm(temporary, { force: true }).catch(() => {});
      }
    });

  return null;
}
