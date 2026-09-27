import { Router } from "express";

import admin from "#middleware/admin";
import * as events from "#service/events";
import management from "#service/manage";
import { deliver } from "#service/chatting";
import * as role from "#shared/role";
import string from "#shared/string";
import { resolve } from "#service/profile/data";
import * as evidence from "#service/evidence";

const router = Router();

router.get("/:id/evidence", admin, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  if (req.user.role !== role.root) return res.status(403).end();
  const user = await resolve(string(req.params.id).trim());

  if (!user) return res.status(404).end();

  return res.json({ items: await evidence.read(user.uid) });
});

router.post("/:id/sanction", admin, async (req, res) => {
  const { action, reason } = req.body || {};

  if (!["mute", "kick", "unkick"].includes(action)) return res.status(400).end();
  const user = await resolve(string(req.params.id).trim());

  if (!user) return res.status(404).end();
  try {
    const result = await management(req.user.uid, user.uid, action, {
      reason,
      room: req.get("X-Chatting-Room")
    });

    if (action === "kick") {
      events.send(user.uid, "kick", { handler: result.handler, reason: reason.trim() });

      events.disconnect(user.uid);
    } else if (action === "mute") {
      events.send(user.uid, "mute", {
        until: result.sanction.muted,
        message: result.message,
        ...JSON.parse(result.sanction.notice)
      });
    }

    await deliver(result.message.url, action === "mute" ? user.uid : undefined);
    events.broadcast("profile-update", { id: user.id });
    res.status(204).end();
  } catch (error) {
    if (error.status) return res.status(error.status).end();
    throw error;
  }
});

router.post("/:id/block", admin, async (req, res) => {
  const reason = string(req.body?.reason).trim();

  if (!reason || reason.length > 500) {
    return res.status(400).end();
  }

  const user = await resolve(string(req.params.id).trim());

  if (!user) return res.status(404).end();
  const uid = user.uid;

  let result;

  try {
    result = await management(req.user.uid, uid, "block", {
      reason,
      room: req.get("X-Chatting-Room")
    });
  } catch (error) {
    if (error.status) return res.status(error.status).end();
    throw error;
  }

  events.send(uid, "block", { handler: result.handler, reason });
  events.disconnect(uid);
  await deliver(result.message.url);
  events.broadcast("chatting-block", { id: user.id });
  events.broadcast("profile-update", { id: user.id });
  res.status(204).end();
});

router.delete("/:id/block", admin, async (req, res) => {
  const user = await resolve(string(req.params.id).trim());

  if (!user) return res.status(404).end();
  const uid = user.uid;
  const reason = string(req.body?.reason).trim();

  if (!reason || reason.length > 500) return res.status(400).end();

  let current;

  try {
    current = await management(req.user.uid, uid, "unblock", {
      reason,
      room: req.get("X-Chatting-Room")
    });
  } catch (error) {
    if (error.status) return res.status(error.status).end();
    throw error;
  }

  events.broadcast("chatting-unblock", { id: user.id });
  if (current.message) await deliver(current.message.url);

  events.send(uid, "role", { admin: role.staff(current.role) });
  events.broadcast("profile-update", { id: user.id });
  res.status(204).end();
});

router.patch("/:id/authority", admin, async (req, res) => {
  const id = string(req.params.id).trim();
  const { enabled, memo } = req.body || {};

  if (req.user.role !== role.root) return res.status(403).end();
  const user = await resolve(id);

  if (!user) return res.status(404).end();
  const uid = user.uid;

  if (
    (enabled === undefined && memo === undefined) ||
    (enabled !== undefined && typeof enabled !== "boolean") ||
    (memo !== undefined && (typeof memo !== "string" || memo.trim().length > 500))
  ) {
    return res.status(400).end();
  }

  try {
    await management(req.user.uid, uid, "authority", {
      enabled,
      ...(memo !== undefined && { memo: memo.trim() })
    });
  } catch (error) {
    if (error.status) return res.status(error.status).end();
    throw error;
  }

  if (enabled !== undefined) events.send(uid, "role", { admin: enabled });

  events.broadcast("profile-update", { id: user.id });
  res.status(204).end();
});

export default router;
