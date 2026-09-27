import { Router } from "express";

import hash from "#config/hash";
import { langs, locale } from "#service/locale";
import { content } from "#shared/route";

import string from "#shared/string";

const router = Router();
const key = (value) => hash(8, value.toLowerCase());

const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const decode = (value) => JSON.parse(Buffer.from(value, "base64").toString("utf8"));

const files = Object.fromEntries(langs.map((lang) => [key(lang), lang]));

const languages = Object.fromEntries(langs.map((lang) => [lang, key(lang)]));
const defaultLang = langs.includes("ko") ? "ko" : langs[0];

router.get("/", (_, res) => {
  res.json({ [content]: encode(languages) });
});

router.get("/:file", (req, res) => {
  const lang = files[req.params.file];

  if (!lang) {
    return res.status(404).end();
  }

  const source = locale(lang);
  const text = Object.fromEntries(
    ["app.title", "offline.heading", "offline.action"]
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, source[key]])
  );

  res.json({ [content]: encode({ lang, text }) });
});

router.post("/", async (req, res) => {
  let body;

  try {
    body = decode(req.body?.[content]);
  } catch {
    return res.status(400).end();
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).end();
  }

  const mode = string(body.lang, "system").trim().toLowerCase();

  const selected = mode === "system" ? req.acceptsLanguages(...langs) : mode;

  const lang = langs.includes(selected) ? selected : defaultLang;

  const source = Object.fromEntries(
    Object.entries(locale(lang)).map(([name, value]) => [key(name), value])
  );

  const keys = Array.isArray(body.keys)
    ? [...new Set(body.keys.filter((key) => typeof key === "string"))].slice(0, 256)
    : [];

  const text = Object.fromEntries(
    keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])
  );

  res.json({ [content]: encode({ lang, text }) });
});

export default router;
