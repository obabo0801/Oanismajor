import * as path from "#config/path";
import hash from "#config/hash";
import { run } from "#db";

const dir = path.stt();
const types = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };

const query = `
  INSERT INTO storage.stt ( file, uid, text, time, cues )
  SELECT ?, ?, ?, ?, ?::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM storage.stt WHERE file = ? AND uid = ?)
`;

export const supported = (type) => Object.hasOwn(types, type);

path.mkdirSync(dir, { recursive: true });

export default async function save(audio, options) {
  const { type, uid, text, time } = options;
  const ext = types[type];

  if (!ext || !Buffer.isBuffer(audio)) {
    return null;
  }

  const id = hash(32, audio);
  const file = `${id}.${ext}`;
  const target = path.stt(file);

  let created = false;

  try {
    await path.writeFile(target, audio, { flag: "wx" });
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  try {
    if (options.cues?.length)
      await run(`UPDATE storage.stt SET cues = ?::jsonb WHERE file = ? AND uid = ?`, [
        JSON.stringify(options.cues),
        file,
        uid
      ]);

    await run(query, [file, uid, text, time, JSON.stringify(options.cues || null), file, uid]);
  } catch (error) {
    try {
      if (created) await path.rm(target, { force: true });
    } catch {}

    throw error;
  }

  return file;
}
