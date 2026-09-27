import { publicId } from "#config/uid";

export default (run, user, actor, action, reason, time, snapshot) =>
  run(
    `
      INSERT INTO audit.block (uid, ip, action, reason, actor, handler,
        time, snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      user.uid,
      user.ip,
      action,
      reason,
      actor.uid,
      actor.name || publicId(actor.uid),
      time,
      snapshot
    ]
  );
