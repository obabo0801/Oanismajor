import { get, run } from "#db";

export const clear = () =>
  run(`
    UPDATE account.profile
    SET draft = NULL
    WHERE (draft::jsonb ->> 'time') < to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul') + '-15 minutes'::interval,
      'YYYY-MM-DD HH24:MI:SS')
  `);

export const find = (uid) =>
  get(
    `
      SELECT rowid AS number, uid, id, name, email, google, soop, verified, renamed, image,
        avatar, settings, setup, role, ip, initial, lang, date
      FROM account.profile
      WHERE uid = ?
    `,
    [uid]
  );

export const resolve = async (id) => {
  const user = await get(
    `
      SELECT uid
      FROM account.profile
      WHERE id = ?
    `,
    [id]
  );

  return user ? find(user.uid) : null;
};
