import connect from "#db/connect";

const db = connect("audit");

export default (uid) =>
  db.get(
    `
      SELECT ip, os, browser, time
      FROM audit.access
      WHERE uid = ?
      ORDER BY time DESC, rowid DESC
      LIMIT 1
    `,
    [uid]
  );
