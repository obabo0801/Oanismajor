import express from "express";
import { request } from "node:http";
import { stat } from "node:fs/promises";

import * as path from "#config/path";
import { routes } from "#config/media";
import media from "#middleware/media";
import { mime } from "#shared/attach";
import * as convert from "#service/convert";
import * as files from "#service/file";

const router = express.Router();

router.use(media);

const options = {
  dotfiles: "deny",
  fallthrough: false,
  index: false,
  maxAge: "1d",
  setHeaders(response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
  }
};

const send = async (req, res, next, source, digest = "") => {
  let prepared;

  try {
    prepared = await files.prepare(source, digest);
    if (res.destroyed || res.writableEnded) {
      prepared.release();
      return;
    }

    res.sendFile(prepared.file, options, (error) => {
      prepared.release();
      if (error) next(error);
    });
  } catch (error) {
    prepared?.release();
    if (error.code === "ENOENT") error.status = 404;

    next(error);
  }
};

for (const { directory, prefix, legacy } of routes) {
  if (directory === "files/original") {
    router.use([prefix, legacy], async (req, res, next) => {
      if (!req.query.convert && !req.query.play) return next();

      if (!["GET", "HEAD"].includes(req.method)) return res.sendStatus(405);
      const kind = req.query.convert || req.query.play;
      const file = await convert.default(req.path.slice(1), kind);

      res.set("Cache-Control", "no-store");

      if (req.query.convert) {
        if (file === false) return res.json({ ready: false, empty: true });

        return res
          .status(file ? 200 : 202)
          .json({ ready: Boolean(file), ...(kind === "video" && { version: convert.version }) });
      }

      if (file === false) return res.sendStatus(404);

      if (!file) return res.sendStatus(503);

      res.type({ audio: "audio/mpeg", video: "video/mp4", cover: "image/jpeg" }[kind]);
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", kind === "video" ? "no-store" : "public, max-age=86400");
      return send(req, res, next, file);
    });

    router.use([prefix, "/upload/files/original"], async (req, res, next) => {
      const name = typeof req.query.name === "string" ? req.query.name : "download";

      res.attachment(name.replace(/[/\\\x00-\x1f\x7f]/g, "").slice(0, 255) || "download");
      res.set("Content-Type", mime(name));
      res.set("Content-Security-Policy", "sandbox");

      const match = /^\/([a-f0-9]{32})\.bin$/.exec(req.path);

      if (match && ["GET", "HEAD"].includes(req.method)) {
        const source = path.upload("files", "original", `${match[1]}.bin`);

        if (files.external(source)) {
          res.set("X-Content-Type-Options", "nosniff");
          // Do not keep a previously cached partial original in the development browser.
          res.set("Cache-Control", "no-store");
          return send(req, res, next, source, match[1]);
        }
      }

      next();
    });
  }

  router.use(
    [prefix, legacy, `/upload/${directory}`],
    express.static(path.upload(directory), options)
  );
}

router.use("/upload/files/cache", async (req, res, next) => {
  const match = /^\/(?:v[0-9]+\/)?([a-f0-9]{32})\.(?:jpg|mp3|mp4)$/.exec(req.path);

  if (!match || !["GET", "HEAD"].includes(req.method)) return res.sendStatus(404);

  try {
    await stat(path.upload("files", "original", `${match[1]}.bin`));
    res.set("Cache-Control", "private, no-store");
    next();
  } catch (error) {
    if (error.code === "ENOENT") return res.sendStatus(404);

    next(error);
  }
});

router.use("/upload", express.static(path.upload(), options));

router.use((error, req, res, next) => {
  if (
    req.app.get("env") !== "development" ||
    !process.env.DEVELOPMENT_MEDIA ||
    error.status !== 404 ||
    !["GET", "HEAD"].includes(req.method)
  )
    return next(error);

  const headers = {};

  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"])
    if (req.headers[name]) headers[name] = req.headers[name];

  const target = new URL(process.env.DEVELOPMENT_MEDIA);

  target.pathname = req.path;
  target.search = new URL(req.originalUrl, "http://localhost").search;

  const upstream = request(target, { method: req.method, headers }, (response) => {
    res.status(response.statusCode);
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "content-disposition",
      "cache-control",
      "etag",
      "last-modified",
      "location",
      "x-content-type-options",
      "content-security-policy"
    ]) {
      if (response.headers[name]) res.setHeader(name, response.headers[name]);
    }

    response.on("error", () => res.destroy());
    response.pipe(res);
  });

  upstream.setTimeout(15000, () => upstream.destroy(new Error("Media timeout")));
  upstream.on("error", () => {
    if (res.headersSent) res.destroy();
    else next(error);
  });

  res.on("close", () => upstream.destroy());
  upstream.end();
});

export default router;
