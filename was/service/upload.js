import { run } from "#db";

export default async function record(uid, ...files) {
  if (!uid) return;

  for (const file of new Set(files)) {
    await run(
      `
        INSERT INTO storage.upload (file, uid)
        VALUES (?, ?)
        ON CONFLICT DO NOTHING
      `,
      [file, uid]
    );
  }
}
