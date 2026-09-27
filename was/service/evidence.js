import { createHmac, randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import * as path from "#config/path";
import connect from "#db/connect";

let ready;

const open = () => (ready ||= initialize());

async function initialize() {
  await path.mkdir(path.data(), { recursive: true });

  const file = path.data("evidence.key");

  try {
    await access(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const records = await connect("evidence").get(`
      SELECT 1
      FROM record
      LIMIT 1
    `);

    if (records) throw new Error("Restore the missing evidence key from backup");
    try {
      await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }

  const key = await readFile(file);

  if (key.length !== 32) throw new Error("Invalid evidence key");
  const db = connect("evidence");

  return { ...db, hash: (value) => createHmac("sha256", key).update(value).digest("hex") };
}

export const save = async (user, records) => {
  if (!records.length) return;
  const db = await open();
  const providers = ["google", "soop"].filter((provider) => user[provider]);
  const date = new Date();

  date.setUTCFullYear(date.getUTCFullYear() + 1);
  for (const item of records) {
    let reason = String(item.reason || "");

    reason = reason
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted]")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted]");

    for (const value of [user.email, user.google, user.soop, user.name, user.ip, user.uid])
      if (value) reason = reason.replaceAll(value, "[redacted]");
    for (const provider of providers) {
      const subject = db.hash(`${provider}:${user[provider]}`);
      const id = db.hash(
        `${provider === "google" ? "" : `${provider}:`}${user.uid}:${item.source}`
      );

      await db.run(
        `
        INSERT INTO record (id, subject, kind, reason, time, expires)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `,
        [id, subject, item.kind, reason.slice(0, 500), item.time, date.getTime()]
      );
    }
  }
};

export const match = async (uid, sub, provider = "google") => {
  if (!["google", "soop"].includes(provider)) throw new Error("Invalid provider");
  const db = await open();
  const subject = db.hash(`${provider}:${sub}`);
  const found = await db.get(
    `
      SELECT 1
      FROM record
      WHERE subject = ?
        AND expires > ?
      LIMIT 1
    `,
    [subject, Date.now()]
  );

  if (found)
    await db.run(
      `
        INSERT INTO member(uid, subject)
        VALUES (?, ?)
        ON CONFLICT(uid)
        DO UPDATE SET subject = excluded.subject
      `,
      [uid, subject]
    );
};

export const read = async (uid) => {
  const db = await open();

  return db.all(
    `
      SELECT kind, reason, time, expires
      FROM record
      JOIN member ON member.subject = record.subject
      WHERE member.uid = ?
        AND expires > ?
      ORDER BY time DESC
      LIMIT 100
    `,
    [uid, Date.now()]
  );
};

export const forget = async (uid) => {
  const db = await open();

  await db.run(
    `
      DELETE
      FROM member
      WHERE uid = ?
    `,
    [uid]
  );
};

export const clean = async () => {
  const db = await open();

  await db.run(
    `
      DELETE
      FROM record
      WHERE expires <= ?
    `,
    [Date.now()]
  );

  await db.run(`
    DELETE
    FROM member
    WHERE NOT EXISTS (SELECT 1
      FROM record
      WHERE subject = member.subject)
  `);
};
