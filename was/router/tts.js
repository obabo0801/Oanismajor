import { Router } from "express";

import address from "#config/ip";
import { now } from "#service/log";
import record from "#service/log/tts";
import { get } from "#db";
import synthesize, { voices } from "#service/tts";
import uid from "#config/uid";

import string from "#shared/string";

import limit from "#middleware/limit";

const router = Router();
const allowed = limit("tts:allowed", 20);

router.get("/voices", async (req, res) => {
  res.set("Cache-Control", "private, no-store");

  if (!uid(req)) return res.status(401).end();

  if (!(await allowed(address(req)))) return res.status(429).end();

  try {
    const models = await voices(req.query.lang);

    return res.json(req.query.detail === "1" ? models : models.map((voice) => voice.name));
  } catch {
    return res.status(503).end();
  }
});

router.post("/", async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).end();
  }

  const text = string(body.text).trim();

  if (!text) {
    return res.status(400).end();
  }

  if ([...text].length > 500) {
    return res.status(413).end();
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
  const only = body.type === "cache";

  if (!only && (!user || blocked)) {
    return res.status(403).end();
  }

  if (body.type === "browser") {
    let voice = string(body.voice).trim();

    if ([...voice].length > 200) {
      return res.status(400).end();
    }

    voice = voice || "default";

    await record(id, text, voice, "browser", now());

    return res.status(204).end();
  }

  const time = now();

  let result;

  try {
    const { lang, pitch, rate, voice } = body;

    result = await synthesize(
      { text, lang, pitch, rate, voice },
      { uid: id, time, type: body.type }
    );
  } catch (error) {
    if (error?.code === "55P03") {
      throw error;
    }

    return res.status(502).end();
  }

  if (!result) {
    return body.type === "cache" ? res.status(204).end() : res.status(503).end();
  }

  if (body.type !== "cache") {
    const type = result.cached ? "cache" : result.provider;

    await record(id, text, result.voice, type, time);
  }

  res.set({
    "Cache-Control": "private, no-store",
    "Content-Type": "audio/mpeg",
    "X-Content-Type-Options": "nosniff",
    "X-TTS-Provider": result.provider,
    "X-TTS-Cache": result.cached ? "hit" : "miss"
  });

  return res.send(result.audio);
});

export default router;
