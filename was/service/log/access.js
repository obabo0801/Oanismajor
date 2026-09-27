import log from "#service/log";

const run = log();

export default (uid, ip, os, browser, path, result) =>
  run(
    `
      INSERT INTO audit.access ( uid, ip, os, browser, path, result )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [uid, ip, os, browser, path, result]
  );
