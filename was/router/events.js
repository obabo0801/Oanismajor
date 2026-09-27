import { Router } from "express";

import * as events from "../service/events.js";
import address from "../config/ip.js";
import client from "../config/client.js";
import { get } from "../../db/index.js";
import identity from "../config/uid.js";
import { viewer } from "../service/chatting.js";
import * as rooms from "../service/chatting/room.js";

const router = Router();

const find = async (req) => {
  const uid = identity(req);
  const ip = address(req);

  return uid
    ? await get(
        `
          SELECT account.profile.uid, account.profile.role
          FROM account.profile
          WHERE account.profile.uid = ?
            AND account.profile.deletion IS NULL
            AND account.profile.erased = 0
            AND NOT EXISTS (
            SELECT 1
            FROM moderation.block
            WHERE moderation.block.uid = account.profile.uid
              OR moderation.block.ip = ? )
            AND NOT EXISTS (SELECT 1
            FROM moderation.sanction
            WHERE uid = account.profile.uid
              AND kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
              'YYYY-MM-DD HH24:MI:SS'))
        `,
        [uid, ip]
      )
    : null;
};

router.post("/", async (req, res) => {
  const user = await find(req);

  if (!user) {
    return res.status(403).end();
  }

  const { session, visible, active, closed } = req.body || {};

  if (typeof session !== "string") {
    return res.status(409).end();
  }

  if (closed === true) {
    events.disconnect(user.uid, session);

    return res.status(204).end();
  }

  if (!events.touch(user.uid, session, visible, active)) {
    return res.status(409).end();
  }

  res.status(204).end();
});

router.get("/list", async (req, res) => {
  res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  try {
    await viewer(identity(req), address(req), req.app.get("env") === "development");

    const result = await events.list();

    await viewer(identity(req), address(req), req.app.get("env") === "development");

    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).end();
    throw error;
  }
});

router.get("/", async (req, res) => {
  const tab = req.query.tab;

  if (
    tab !== undefined &&
    (typeof tab !== "string" || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(tab))
  )
    return res.status(400).end();
  const user = await find(req);

  if (!user) {
    return res.status(403).end();
  }

  if (req.query.room !== undefined) {
    try {
      const room = await rooms.read(user, req.query.room);

      user.room = room.id;
    } catch (error) {
      if (error.status) return res.status(error.status).end();
      throw error;
    }
  }

  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream"
  });

  res.flushHeaders?.();
  res.write("retry: 3000\n\n");

  const close = events.connect(
    {
      ...user,
      ...client(req),
      tab,
      ip: address(req),
      development: req.app.get("env") === "development"
    },
    res
  );

  const ping = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;

    res.write("event: heartbeat\ndata: {}\n\n");
  }, 25_000);

  ping.unref?.();

  const cleanup = () => {
    clearInterval(ping);
    close();
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
});

export default router;
