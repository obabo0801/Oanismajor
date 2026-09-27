import { randomBytes, randomUUID } from "node:crypto";
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

export const remember = async (res, uid, key = ids.key) => {
  if (!uid) return;
  const user = await db.get(
    `
      UPDATE account.profile
      SET session = COALESCE(session, ?)
      WHERE uid = ?
        AND deletion IS NULL
        AND erased = 0
      RETURNING session
    `,
    [randomBytes(32).toString("base64url"), uid]
  );

  if (user) res.cookie(key, user.session, cookie);

  return Boolean(user);
};

export const read = async (value) => {
  if (typeof value !== "string") return null;

  if (/^[A-Za-z0-9_-]{43}$/.test(value))
    return db.get(
      `
        SELECT uid
        FROM account.profile
        WHERE session = ?
          AND deletion IS NULL
          AND erased = 0
      `,
      [value]
    );

  return null;
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
