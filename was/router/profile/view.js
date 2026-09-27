import { Router } from "express";

import { get } from "#db";
import identity from "#config/uid";
import * as ids from "#config/uid";
import * as media from "#config/media";
import * as events from "#service/events";
import recent from "#service/log/recent";
import { find, resolve } from "#service/profile/data";
import * as role from "#shared/role";
import string from "#shared/string";
import * as settings from "#shared/settings";
import * as room from "#service/room";
import * as management from "#service/admin";

const router = Router();

router.get("/:id", async (req, res) => {
  const viewer = await find(identity(req));

  if (!viewer) {
    return res.status(403).end();
  }

  const user = req.params.id === "me" ? viewer : await resolve(string(req.params.id).trim());

  if (!user) {
    return res.status(404).end();
  }

  const access = await recent(user.uid);
  const self = viewer.uid === user.uid;
  const manage = role.manages(viewer, user);
  const receiving = settings.read(user.settings);
  const relation = await room.policy(viewer.uid, user.uid);
  const ended = await get(
    `
      SELECT 1
      FROM messenger.room
      WHERE multiple = 0
        AND closed IS NOT NULL
        AND (first = ?
          AND second = ?
          OR first = ?
          AND second = ?)
    `,
    [viewer.uid, user.uid, user.uid, viewer.uid]
  );

  const result = {
    id: user.id,
    name: user.verified ? user.name || "" : "",
    verified: Boolean(user.verified),
    image: media.resolve(user.image),
    avatar: media.resolve(user.avatar),
    receiving: {
      whisper: receiving.whisper && !relation.unavailable,
      message: receiving.message && !relation.unavailable && !ended
    },
    ...(relation.blocked && { directBlocked: true }),
    self,
    state: events.state(user.uid),
    connections: events.connections(user.uid),
    time: access?.time || user.date,
    ...(manage && { manage: true })
  };

  if (self) {
    result.setup = Boolean(user.setup);
    result.providers = { google: Boolean(user.google), soop: Boolean(user.soop) };
    if (user.verified) {
      result.email = user.email || "";
      result.renamed = user.renamed || "";
    }
  }

  if (manage) {
    const blocked = await get(
      `
        SELECT reason, time, handler
        FROM moderation.block
        WHERE uid = ?
          OR ip = ?
        ORDER BY time DESC, rowid DESC
        LIMIT 1
      `,
      [user.uid, user.ip]
    );

    result.blocked = Boolean(blocked);
    result.block = blocked ? { ...blocked, handler: ids.publicName(blocked.handler) } : null;

    result.sanction =
      (await get(
        `
          SELECT count, CASE WHEN muted > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS') THEN muted END AS muted, CASE WHEN kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS') THEN kicked END AS kicked
          FROM moderation.sanction
          WHERE uid = ?
        `,
        [user.uid]
      )) || null;
  }

  if (manage || (self && role.staff(viewer.role))) {
    result.devices = await management.devices(user);
    result.details = {
      email: user.email || "",
      userIp: user.initial || "",
      accessIp: user.ip,
      date: user.date,
      time: access?.time || "",
      os: access?.os || "",
      browser: access?.browser || "",
      lang: user.lang === "system" ? "" : user.lang || "",
      sessions: events.sessions(user.uid)
    };

    if (manage && viewer.role === role.root) {
      const authority = await get(
        `
          SELECT memo, time, handler
          FROM account.authority
          WHERE uid = ?
        `,
        [user.uid]
      );

      result.authority = {
        ...authority,
        handler: ids.publicName(authority?.handler),
        enabled: user.role === role.admin,
        activity: null
      };
    }
  }

  res.set("Cache-Control", "private, no-store").json(result);
});

export default router;
