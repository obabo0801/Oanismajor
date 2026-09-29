import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as db from "#db";
import * as ids from "#config/uid";
import { locale } from "#service/locale";

export const anonymous = "_guest";
export const login = "_login";
export const recovery = "_restore";

export const cookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  signed: true,
  maxAge: 365 * 24 * 60 * 60 * 1000
};

export const clear = (req, res) => {
  for (const key of ["7f4a9c2e", "7f4a9c2e-guest", "7f4a9c2e-login", "7f4a9c2e-recovery"]) {
    if (Object.hasOwn(req.cookies || {}, key) || Object.hasOwn(req.signedCookies || {}, key))
      res.clearCookie(key, { ...cookie, maxAge: undefined });
  }
};

const digest = (value) =>
  typeof value === "string" && /^v2\.[A-Za-z0-9_-]{43}$/.test(value)
    ? createHash("sha256").update(value).digest("hex")
    : "";

export const read = async (value) => {
  const token = digest(value);

  if (!token) return null;

  return db.get(
    `
      SELECT s.uid, s.expires
      FROM account.session s
      JOIN account.profile p ON p.uid = s.uid
      WHERE s.token = ? AND s.expires > ?
        AND p.deletion IS NULL AND p.erased = 0
    `,
    [token, Date.now()]
  );
};

export const revoke = async (value) => {
  const token = digest(value);

  if (token) await db.run("DELETE FROM account.session WHERE token = ?", [token]);
};

export const forget = (uid) => db.run("DELETE FROM account.session WHERE uid = ?", [uid]);

export const remember = async (res, uid, key = ids.key, previous = "") => {
  if (!uid) return false;
  const saved = await read(previous);

  if (saved?.uid === uid) {
    res.cookie(key, previous, { ...cookie, maxAge: Math.max(1, saved.expires - Date.now()) });
    return true;
  }

  const token = `v2.${randomBytes(32).toString("base64url")}`;
  const expires = Date.now() + cookie.maxAge;
  const result = await db.run(
    `
      INSERT INTO account.session(token, uid, expires)
      SELECT ?, uid, ? FROM account.profile
      WHERE uid = ? AND deletion IS NULL AND erased = 0
    `,
    [digest(token), expires, uid]
  );

  if (result.changes) res.cookie(key, token, cookie);

  return Boolean(result.changes);
};

export const name = (uid, lang) =>
  (locale(lang) || locale("ko"))["profile.anonymous"].replace(
    "{id}",
    ids.publicId(uid).slice(0, 8)
  );

export const create = async (ip, lang) => {
  const uid = randomUUID();

  await db.run(
    `
      INSERT INTO account.profile (uid, id, name, ip, initial, lang)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [uid, ids.publicId(uid), name(uid, lang), ip, ip, lang]
  );

  return uid;
};
