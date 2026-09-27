import { raw, Router } from "express";

import fcm, * as firebase from "../service/fcm.js";
import store from "../service/image.js";
import record from "../service/log/notify.js";
import * as push from "../service/push.js";
import * as connection from "../service/connection.js";
import { all, run } from "../../db/index.js";

import string from "../../lib/string.js";

import admin from "../middleware/admin.js";
import * as management from "#service/admin";
import * as files from "#service/admin/files";
import * as role from "#shared/role";
import * as settings from "#shared/settings";

const upload = raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" });

const sendFcm = async (rows, value) => {
  let results;

  try {
    results = await fcm(
      rows.map((row) => row.fid),
      value
    );
  } catch {
    return { sent: 0, failed: rows.length };
  }

  let sent = 0;
  let failed = 0;

  await Promise.all(
    results.map(async (result) => {
      if (result.success) {
        sent += 1;

        return;
      }

      if (firebase.invalid(result.error)) {
        await run(
          `
            DELETE
            FROM push.fcm
            WHERE fid = ?
          `,
          [result.fid]
        );

        return;
      }

      failed += 1;
    })
  );

  return { sent, failed };
};

const router = Router();

router.use(admin);
router.use((_, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

router.get("/", (req, res) => {
  res.json({ database: req.user.role === role.root });
});

router.get("/users", async (req, res) => {
  res.json(await management.users(req.query));
});

router.get("/recipients", async (_, res) => res.json(await management.recipients()));

router.use(["/database", "/files", "/connection"], (req, res, next) => {
  if (req.user.role !== role.root) return res.status(403).end();

  next();
});

router.get("/connection", async (req, res) => {
  res.json(await connection.read({ refresh: req.query.refresh === "1" }));
});

router.get("/database", async (req, res) => res.json(await management.catalogue(req.query)));

router.get("/database/:table", async (req, res) => {
  res.json(await management.list(req.params.table, req.query));
});

router.get("/files/:kind", async (req, res) => {
  res.json(await files.list(req.params.kind, req.query));
});

router.get("/files/:kind/content", async (req, res) => {
  const file = await files.content(req.params.kind, req.query.file);

  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(file, { cacheControl: false }, (error) => {
    if (error && !res.headersSent) res.status(error.status || 500).end();
  });
});

router.get("/files/:kind/details", async (req, res) => {
  res.json(await files.details(req.params.kind, req.query.file));
});

router.post("/image", upload, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).end();
  }

  const image = await store(req.body, "images", {
    uid: req.user.uid,
    width: 1024,
    height: 1024,
    fit: "inside",
    quality: 80
  });

  if (!image) {
    return res.status(415).end();
  }

  return res.json({ original: image.original, image: image.cache });
});

router.post("/", async (req, res) => {
  if (!push.enabled && !firebase.enabled) {
    return res.status(503).end();
  }

  const title = string(req.body.title).trim();
  const body = string(req.body.body).trim();
  const link = string(req.body.url).trim();
  const image = string(req.body.image).trim();
  const recipients = req.body.recipients;
  const url = link.startsWith("/") && !link.startsWith("//") && !link.includes("\\") ? link : "/";

  if (
    !title ||
    title.length > 100 ||
    !body ||
    body.length > 500 ||
    !Array.isArray(recipients) ||
    !recipients.length ||
    recipients.some((id) => typeof id !== "string" || id.length > 128)
  ) {
    return res.status(400).end();
  }

  const [web, devices] = await Promise.all([
    push.enabled
      ? all(`
        SELECT push.web.endpoint, push.web.data, account.profile.id
        FROM push.web
        JOIN account.profile ON account.profile.uid = push.web.uid
        WHERE NOT EXISTS (
          SELECT 1
          FROM moderation.block
          WHERE moderation.block.uid = account.profile.uid
            OR moderation.block.ip = account.profile.ip )
      `)
      : [],
    firebase.enabled
      ? all(`
        SELECT push.fcm.fid, push.fcm.device, account.profile.id, account.profile.settings,
          account.profile.deletion, account.profile.erased
        FROM push.fcm
        JOIN account.profile ON account.profile.uid = push.fcm.uid
        WHERE NOT EXISTS (
          SELECT 1
          FROM moderation.block
          WHERE moderation.block.uid = account.profile.uid
            OR moderation.block.ip = account.profile.ip )
      `)
      : []
  ]);

  const value = { title, body, image, url };
  const source = process.env.APP_URL?.trim() || `${req.protocol}://${req.get("host")}`;

  const native = { ...value, image: image ? new URL(image, source).href : "" };

  const selected = new Set(recipients);
  const wear = devices.filter((item) => {
    const options = settings.read(item.settings);

    return (
      selected.has(item.id) &&
      item.device === "wearable" &&
      !item.deletion &&
      !item.erased &&
      options.notification &&
      options.web
    );
  });

  const [webResult, fcmResult] = await Promise.all([
    push.send(
      web.filter((item) => selected.has(item.id)),
      value
    ),
    sendFcm(wear, native)
  ]);
  const sent = webResult.sent + fcmResult.sent;
  const failed = webResult.failed + fcmResult.failed;

  await record(req.user.uid, title, body, image, url);
  res.json({ sent, failed });
});

export default router;
