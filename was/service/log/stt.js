import log from "#service/log";

const run = log();

export default (uid, lang, text, pitch, type, time) =>
  run(
    `
      INSERT INTO audit.stt ( uid, lang, text, pitch, type, time )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [uid, lang, text, pitch, type, time]
  );
