import { Router } from "express";
import * as db from "#db";
import * as settings from "#shared/settings";
import * as events from "#service/events";
import identity from "#config/uid";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (!identity(req)) return res.status(401).end();

  if (
    req.method !== "GET" &&
    (req.get("sec-fetch-site") === "cross-site" || !req.is("application/json"))
  )
    return res.status(403).end();

  next();
});

router.get("/", async (req, res) => {
  const user = await db.get(
    `
      SELECT settings
      FROM account.profile
      WHERE uid = ?
    `,
    [identity(req)]
  );

  if (!user) return res.status(404).end();

  res.json(settings.read(user.settings));
});

router.patch("/", async (req, res) => {
  const entries = Object.entries(req.body || {});

  if (
    !entries.length ||
    entries.some(
      ([key, value]) => !Object.hasOwn(settings.defaults, key) || typeof value !== "boolean"
    )
  )
    return res.status(400).end();
  const uid = identity(req);
  const row = await db.get(
    `
      UPDATE account.profile
      SET settings = (COALESCE(settings, '{}')::jsonb || ?::jsonb)::text
      WHERE uid = ?
      RETURNING id, settings
    `,
    [JSON.stringify(req.body), uid]
  );

  if (!row) return res.status(404).end();
  const value = settings.read(row.settings);

  events.send(uid, "settings", value);
  if (entries.some(([key]) => ["whisper", "message"].includes(key)))
    events.broadcast("profile-update", { id: row.id });

  res.json(value);
});

export default router;
