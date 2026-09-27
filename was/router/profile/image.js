import { raw, Router } from "express";

import { get, run } from "#db";
import identity from "#config/uid";
import * as events from "#service/events";
import store, { transform } from "#service/image";
import * as profile from "#service/profile";
import * as data from "#service/profile/data";
import rate from "#middleware/limit";
import max from "#shared/upload";
import string from "#shared/string";
import account from "#middleware/account";

const router = Router();

const upload = raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: max });

const links = rate("profile/image:links", 10);

const parse = (req) => {
  try {
    return JSON.parse(req.get("x-image-edit") || "null");
  } catch {
    return null;
  }
};

const save = async (uid, body, edit = null, token = "") => {
  const image = await store(body, "users", {
    uid,
    width: 256,
    height: 256,
    fit: "cover",
    quality: 85,
    edit
  });

  if (!image) {
    return null;
  }

  for (const file of [image.original, image.cache])
    await run(
      `
        INSERT INTO account.file(uid, file)
        VALUES (?, ?)
        ON CONFLICT DO NOTHING
      `,
      [uid, file]
    );

  const result = await run(
    `
      UPDATE account.profile
      SET draft = (draft::jsonb || jsonb_build_object( 'image', ?::text,
          'avatar', ?::text, 'time', to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS') ))::text
      WHERE uid = ?
        AND draft IS NOT NULL
        AND deletion IS NULL
        AND erased = 0
        AND (draft::jsonb ->> 'token') = ?
        AND (draft::jsonb ->> 'time') >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul') + '-15 minutes'::interval,
        'YYYY-MM-DD HH24:MI:SS')
    `,
    [image.original, image.cache, uid, token]
  );

  return result.changes ? image : null;
};

router.post("/image", account, upload, async (req, res) => {
  const uid = identity(req);
  const user = uid ? await data.find(uid) : null;

  await data.clear();

  const draft = uid
    ? await get(
        `
          SELECT 1
          FROM account.profile
          WHERE uid = ?
            AND draft IS NOT NULL
        `,
        [uid]
      )
    : null;

  if (!user || !draft) {
    return res.status(403).end();
  }

  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).end();
  }

  const image = await save(uid, req.body, parse(req), req.get("x-profile-draft"));

  if (!image) {
    return res.status(415).end();
  }

  res.json({ image: image.original, avatar: image.cache });
});

router.post("/image/link/:token/use", account, async (req, res) => {
  const uid = identity(req);
  const value = string(req.params.token).trim();
  const item = await profile.get(value);

  if (!uid || !item || item.uid !== uid) {
    await profile.remove(value);

    return res.status(404).end();
  }

  if (!item.file) {
    return res.status(409).end();
  }

  await data.clear();

  const draft = await get(
    `
      SELECT 1
      FROM account.profile
      WHERE uid = ?
        AND draft IS NOT NULL
    `,
    [uid]
  );

  if (!draft) {
    return res.status(409).end();
  }

  const image = await save(uid, item.file, null, string(req.body?.token));

  if (!image) {
    return res.status(415).end();
  }

  await profile.remove(value);
  res.status(204).end();
});

router.get("/image/link/:token", async (req, res) => {
  const uid = identity(req);
  const value = string(req.params.token).trim();
  const item = await profile.get(value);

  if (!uid || !item || item.uid !== uid || !item.file) {
    return res.status(404).end();
  }

  res.set({ "Content-Type": item.type, "Cache-Control": "no-store" });

  res.send(item.file);
});

router.post("/image/link", account, async (req, res) => {
  const uid = identity(req);

  if (!uid) {
    return res.status(403).end();
  }

  if (!(await links(uid))) {
    res.set("Retry-After", "60");

    return res.status(429).end();
  }

  const value = await profile.create(uid);

  res.json({ token: value });
});

router.post("/image/link/:token", upload, async (req, res) => {
  const value = string(req.params.token).trim();

  const item = await profile.get(value);

  if (!item) {
    return res.status(404).end();
  }

  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).end();
  }

  const edit = parse(req);

  let file;

  try {
    file = edit ? await transform(req.body, edit, 85) : Buffer.from(req.body);
  } catch {
    file = null;
  }

  if (!file) {
    return res.status(415).end();
  }

  item.file = file;
  item.type = edit ? "image/webp" : req.get("content-type");

  await profile.refresh(item);

  events.send(item.uid, "profile-image", { token: value });

  res.status(204).end();
});

export default router;
