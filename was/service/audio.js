import * as path from "#config/path";
import * as media from "#config/media";
import hash from "#config/hash";
import maximum from "#shared/upload";
import record from "#service/upload";
import * as db from "#db";
import recognize, { enabled } from "#service/speech";
import save from "#service/stt";
import { now } from "#service/log";
import { stat } from "node:fs/promises";

const captions = new Map();
const pending = new Map();

export function caption(source, uid) {
  return request(source, uid, false);
}

export function analyze(source, uid) {
  return request(source, uid, true);
}

function request(source, uid, analyze) {
  const key = `${uid}:${source}:${analyze}`;

  if (!pending.has(key)) {
    pending.set(
      key,
      resolve(source, uid, analyze).finally(() => pending.delete(key))
    );
  }
  return pending.get(key);
}

async function resolve(source, uid, analyze) {
  const route = media.routes.find((item) => item.directory === "audio/original");
  const name = source.startsWith(`${route.prefix}/`) ? source.slice(route.prefix.length + 1) : "";

  if (!/^[a-f0-9]{32}\.(mp3|webm|ogg|m4a)$/.test(name)) return { text: "", cues: [] };

  const key = `${uid}:${name}`;
  const cached = captions.get(key);

  if (cached && (!analyze || cached.cues.length)) return cached;
  const stored = await db.get(
    `SELECT text, cues FROM storage.stt WHERE file = ? AND uid = ? LIMIT 1`,
    [name, uid]
  );

  let text = stored?.text || "";
  let channel = "media";
  let cues = stored?.cues || [];

  if (!text && name.endsWith(".mp3")) {
    const rows = await db.all(
      `SELECT file, text FROM storage.tts
       WHERE uid = ? OR text IN (SELECT text FROM audit.tts WHERE uid = ?)
       ORDER BY time DESC`,
      [uid, uid]
    );

    for (const row of rows) {
      if (!/^[a-f0-9]{32}\.mp3$/.test(row.file)) continue;
      const buffer = await path.readFile(path.tts(row.file)).catch(() => null);

      if (buffer && `${hash(32, buffer)}.mp3` === name) {
        text = row.text;
        channel = "tts";
        break;
      }
    }
  }

  if (analyze && !cues.length && enabled) {
    const file = path.upload("audio", "original", name);

    if ((await stat(file)).size <= 5 * 1024 * 1024) {
      const buffer = await path.readFile(file);

      const result = await recognize(buffer, "ko-KR").catch(() => null);

      text ||= result?.text || "";
      cues = result?.cues || [];

      const type = { mp3: "audio/mpeg", webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4" }[
        name.split(".").at(-1)
      ];

      if (text && type) await save(buffer, { type, uid, text, cues, time: now() });
    }
  }

  if (text) {
    if (captions.size >= 256) captions.delete(captions.keys().next().value);

    captions.set(key, { text, cues, channel });
  }
  return { text, cues, channel };
}

export default async function store(data, type = "", uid = "") {
  if (!Buffer.isBuffer(data) || !data.length || data.length > maximum) return null;
  const mime = type.split(";")[0].trim().toLowerCase();
  const head = data.subarray(0, 12);
  const formats = {
    "audio/webm": head.subarray(0, 4).toString("hex") === "1a45dfa3" && "webm",
    "audio/ogg": head.toString("ascii", 0, 4) === "OggS" && "ogg",
    "audio/mp4": head.toString("ascii", 4, 8) === "ftyp" && "m4a",
    "audio/mpeg":
      (head.toString("ascii", 0, 3) === "ID3" || (head[0] === 255 && (head[1] & 224) === 224)) &&
      "mp3"
  };
  const extension = Object.hasOwn(formats, mime) && formats[mime];

  if (!extension) return null;
  const file = `${hash(32, data)}.${extension}`;

  await path.mkdir(path.upload("audio", "original"), { recursive: true });
  try {
    await path.writeFile(path.upload("audio", "original", file), data, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  await record(uid, `audio/original/${file}`);

  return media.url("audio", "original", file);
}
