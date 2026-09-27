import log from "#service/log";

const run = log();

export default (uid, text, voice, type, time) =>
  run(
    `
      INSERT INTO audit.tts ( uid, text, voice, type, time )
      VALUES (?, ?, ?, ?, ?)
    `,
    [uid, text, voice, type, time]
  );
