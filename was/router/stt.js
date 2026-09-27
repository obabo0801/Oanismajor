import express, { Router } from "express";

import address from "#config/ip";
import { now } from "#service/log";
import record from "#service/log/stt";
import recognize, { enabled } from "#service/speech";
import { get } from "#db";
import save, { supported } from "#service/stt";
import uid from "#config/uid";

import string from "#shared/string";

import limit from "#middleware/limit";

const router = Router();
const allowed = limit("stt:allowed", 20);
const raw = express.raw({ type: "audio/*", limit: "5mb" });
const decode = (req) => {
  try {
    const value = req.get("x-stt-meta");

    if (!value) {
      return null;
    }

    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
};

const tooLong = (text) => [...text].length > 500;

router.get("/", (_, res) => {
  res.json({ cloud: enabled });
});

router.post("/", raw, async (req, res) => {
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

  const blocked = user
    ? await get(
        `
          SELECT 1
          FROM moderation.block
          WHERE uid = ?
            OR ip = ?
          LIMIT 1
        `,
        [id, ip]
      )
    : null;

  if (!user || blocked) {
    return res.status(403).end();
  }

  const audio = Buffer.isBuffer(req.body);
  const data = audio ? decode(req) : req.body;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).end();
  }

  let text = string(data.text).trim();

  const lang = string(data.lang).trim();
  const pitch = ["low", "mid", "high", "unknown"].includes(data.pitch) ? data.pitch : "unknown";

  let type = text ? "browser" : "cloud";

  if (tooLong(text)) {
    return res.status(400).end();
  }

  if (!audio) {
    if (!text) {
      return res.status(204).end();
    }

    const time = now();

    await record(id, lang, text, "unknown", "browser", time);

    return res.status(204).end();
  }

  const mime = req.get("content-type")?.split(";")[0].toLowerCase();

  if (!supported(mime)) {
    return res.status(415).end();
  }

  let confidence = null;
  let cues = [];

  if (enabled) {
    try {
      const result = await recognize(req.body, lang);

      if (result.text) {
        text = result.text;
        confidence = result.confidence;
        cues = result.cues || [];
        type = "cloud";
      }
    } catch {
      if (!text) {
        return res.status(502).end();
      }
    }
  }

  if (!text) {
    return res.status(204).end();
  }

  if (tooLong(text)) {
    return res.status(400).end();
  }

  const time = now();

  let file;

  try {
    file = await save(req.body, { type: mime, uid: id, text, time, cues });
  } catch (error) {
    if (error?.code === "55P03") {
      throw error;
    }

    return res.status(500).end();
  }

  if (!file) {
    return res.status(415).end();
  }

  await record(id, lang, text, pitch, type, time);

  return res.json({ text, confidence });
});

export default router;
