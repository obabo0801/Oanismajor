import { Router } from "express";

import { enabled } from "#service/fcm";
import address from "#config/ip";
import { get, run } from "#db";
import uid from "#config/uid";

import string from "#shared/string";

import limit from "#middleware/limit";

const devices = new Set(["android", "ios", "wearable"]);
const router = Router();
const allowed = limit("fcm:allowed", 20);

router.post("/", async (req, res) => {
  if (!enabled) {
    return res.status(503).end();
  }

  const fid = string(req.body.fid).trim();
  const device = string(req.body.device).trim().toLowerCase();

  if (!fid || fid.length > 4096 || !devices.has(device)) {
    return res.status(400).end();
  }

  const id = uid(req);
  const ip = address(req);

  if (!(await allowed(ip))) {
    res.set("Retry-After", "60");

    return res.status(429).end();
  }

  const user = id
    ? await get(
        `
          SELECT uid
          FROM account.profile
          WHERE uid = ?
        `,
        [id]
      )
    : null;

  const blocked = await get(
    `
      SELECT 1
      FROM moderation.block
      WHERE uid = ?
        OR ip = ?
      LIMIT 1
    `,
    [id || null, ip]
  );

  if (!user || blocked) {
    return res.status(403).end();
  }

  await run(
    `
      INSERT INTO push.fcm ( uid, fid, device )
      VALUES (?, ?, ?)
      ON CONFLICT(fid)
      DO UPDATE SET uid = excluded.uid, device = excluded.device, time = to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
        'YYYY-MM-DD HH24:MI:SS')
    `,
    [id, fid, device]
  );

  res.status(204).end();
});

router.delete("/", async (req, res) => {
  const id = uid(req);
  const fid = req.body?.fid;

  if (!id || typeof fid !== "string") {
    return res.status(400).end();
  }

  await run(
    `
      DELETE
      FROM push.fcm
      WHERE uid = ?
        AND fid = ?
    `,
    [id, fid]
  );

  res.status(204).end();
});

export default router;
