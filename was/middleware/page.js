import { Router } from "express";

import file from "#config/pages";
import * as profile from "#service/profile";
import identity from "#config/uid";

import string from "#shared/string";
import * as location from "#shared/location";

import * as admin from "#middleware/admin";
import * as rooms from "#service/chatting/room";
import { viewer } from "#service/chatting";
import address from "#config/ip";

const hidden = new Set(["/worker.js", "/manifest.json"]);

const html = (req) => req.path.endsWith(".html");

const denied = (req) => hidden.has(req.path) || html(req) || req.path.startsWith("/assets/");

export const page = (req) =>
  req.method === "GET" &&
  (req.get("sec-fetch-dest") === "document" || req.get("accept")?.includes("text/html"));

export const send = (res, name, status = 200) => res.status(status).sendFile(file(name));

export const error = (res) => {
  res.set({ "Cache-Control": "no-store", Vary: "Sec-Fetch-Dest, Accept" });

  return send(res, "error", 404);
};

const normal = (res, name) => {
  res.set("Cache-Control", "no-cache");

  return send(res, name);
};

const manage = async (req, res) => {
  if (!(await admin.allowed(req))) return error(res);

  res.set("Cache-Control", "private, no-store");

  return send(res, "index");
};

export const router = Router();

const visitor = async (req) =>
  identity(req)
    ? viewer(identity(req), address(req), req.app.get("env") === "development")
    : { role: 0 };

router.get("/", async (req, res) => {
  if (req.query.message) {
    try {
      const room = await rooms.message(await visitor(req), req.query.message);

      return res.redirect(
        `/rooms/${room.id}?${new URLSearchParams({ message: req.query.message })}`
      );
    } catch (cause) {
      if (cause.status) return error(res);
      throw cause;
    }
  }
  return normal(res, "index");
});

router.get("/rooms/:id", async (req, res) => {
  try {
    await rooms.read(await visitor(req), req.params.id);
    res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" });
    return send(res, "index");
  } catch (cause) {
    if (cause.status) return error(res);
    throw cause;
  }
});

router.use((req, res, next) => {
  const name = location.page(req.originalUrl);

  if (!["GET", "HEAD"].includes(req.method) || !name) return next();

  if (name === "admin") return manage(req, res);

  return normal(res, "index");
});

router.get("/image", async (req, res) => {
  const token = string(req.query.token).trim();

  if (!(await profile.valid(token))) {
    return error(res);
  }

  res.set("Cache-Control", "no-store");

  return send(res, "image");
});

router.get("/admin", manage);

router.get("/maint", (req, res) => {
  if (req.get("x-maint") !== "true") {
    return error(res);
  }

  res.set("Cache-Control", "no-store");

  return send(res, "maint", 503);
});

router.get("/denied", (req, res) => {
  if (identity(req) || req.get("x-denied") !== "true") {
    return error(res);
  }

  res.set("Cache-Control", "no-store");

  return send(res, "denied");
});

router.get("/offline", (req, res) => {
  if (req.get("x-pwa-cache") !== "true") {
    return error(res);
  }

  res.set("Cache-Control", "no-store");

  return send(res, "offline");
});

router.use((req, res, next) => {
  if (req.method !== "GET" || !denied(req)) {
    return next();
  }

  if (!page(req)) {
    if (html(req)) {
      return res.status(404).end();
    }

    return next();
  }

  return error(res);
});

export const reject = (req, res) => {
  if (!page(req)) {
    return res.status(404).end();
  }

  return error(res);
};
