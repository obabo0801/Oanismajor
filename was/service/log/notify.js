import log from "#service/log";

const run = log();

export default (uid, title, body, image, url) =>
  run(
    `
      INSERT INTO audit.notify ( uid, title, body, image, url )
      VALUES (?, ?, ?, ?, ?)
    `,
    [uid, title, body, image, url]
  );
