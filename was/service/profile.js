import { randomBytes } from "node:crypto";
import connect from "#db/connect";

const { get: query, run } = connect("runtime");

export const create = async (uid) => {
  const token = randomBytes(24).toString("base64url");

  await run(
    `
      INSERT INTO runtime.link(token, uid, expires)
      VALUES (?, ?, clock_timestamp() + interval '5 minutes')
    `,
    [token, uid]
  );

  return token;
};
const getLink = (token) =>
  query(
    `
      SELECT token, uid, file, type
      FROM runtime.link
      WHERE token = ?
        AND expires > clock_timestamp()
    `,
    [token]
  );

export const get = (token) => getLink(token);
export const remove = (token) =>
  run(
    `
      DELETE
      FROM runtime.link
      WHERE token = ?
    `,
    [token]
  );
export const disconnect = (uid) =>
  run(
    `
      DELETE
      FROM runtime.link
      WHERE uid = ?
    `,
    [uid]
  );
export const refresh = (item) =>
  run(
    `
      UPDATE runtime.link
      SET file = ?, type = ?, expires = clock_timestamp() + interval '5 minutes'
      WHERE token = ?
        AND expires > clock_timestamp()
    `,
    [item.file, item.type, item.token]
  );
export const valid = async (token) => Boolean(await getLink(token));
