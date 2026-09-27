import * as path from "#config/path";
import hash from "#config/hash";
import { run } from "#db";
import { rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const dir = path.tts();
const pending = new Map();

path.mkdirSync(dir, { recursive: true });

const query = `
  INSERT INTO storage.tts ( file, uid, text, time, voice )
  VALUES (?, ?, ?, ?, ?)
`;

const record = (file, uid, text, time, voice) => run(query, [file, uid, text, time, voice]);

const signature = (provider, value) => {
  if (provider !== "google") {
    return value;
  }

  return { text: value.text, lang: value.lang, rate: value.rate < 0.75 ? 0.24 : 1 };
};

const voice = (provider, value) => (provider === "cloud" ? value.voice || "default" : "default");

const name = (provider, value) => {
  const data = signature(provider, value);
  const id = hash(32, JSON.stringify({ provider, ...data }));

  return `${id}.mp3`;
};

const read = async (file) => {
  try {
    return await path.readFile(path.tts(file));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return null;
  }
};

export const find = async (provider, value) => {
  const file = name(provider, value);
  const audio = await read(file);

  if (!audio?.length) {
    return null;
  }

  return { audio, file, provider, voice: voice(provider, value), cached: true };
};

const cache = async (provider, value, options) => {
  const { create, uid, time } = options;
  const file = name(provider, value);
  const saved = await find(provider, value);

  if (saved) {
    return saved;
  }

  let task = pending.get(file);

  const cached = Boolean(task);

  if (!task) {
    task = create()
      .then(async (audio) => {
        const target = path.tts(file);
        const draft = `${target}.${randomUUID()}`;

        try {
          await path.writeFile(draft, audio);
          await record(file, uid, value.text, time, voice(provider, value));
          await rename(draft, target);
        } finally {
          await path.rm(draft, { force: true }).catch(() => {});
        }

        return audio;
      })
      .finally(() => {
        pending.delete(file);
      });

    pending.set(file, task);
  }

  return { audio: await task, file, provider, voice: voice(provider, value), cached };
};

export default cache;
