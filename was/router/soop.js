import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import * as config from "#config/soop";
import * as soop from "#service/soop";
import * as session from "#service/session";
import * as login from "#service/login";
import * as google from "#config/google";
import * as db from "#db";
import address from "#config/ip";
import limit from "#middleware/limit";

const router = Router();
const allowed = limit("soop:allowed", 20);
const binding = (uid) => createHash("sha256").update(uid).digest("base64url");

router.get("/providers", (req, res) => {
  res.set("Cache-Control", "no-store");

  const origin = req.query.origin ?? `${req.protocol}://${req.get("host")}`;

  res.json({
    google: Boolean(google.enabled && google.redirect(origin)),
    soop: Boolean(config.enabled && config.redirect(origin))
  });
});

router.get("/soop", async (req, res) => {
  const popup = req.query.popup === "1";
  const done = (result) => login.finish(res, popup, result);

  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (!config.enabled) return done("unavailable");
  const redirect = config.redirect(req.query.origin ?? `${req.protocol}://${req.get("host")}`);

  if (!redirect) return done("unsupported");

  if (!req.uid || !(await allowed(address(req)))) return done("error");
  const link = req.query.link === "1";
  const current = await db.get(
    `
      SELECT verified
      FROM account.profile
      WHERE uid = ? AND deletion IS NULL AND erased = 0
    `,
    [req.uid]
  );

  if (!current || (link && !current.verified)) return done("error");
  const state = randomBytes(32).toString("base64url");

  res.cookie(
    session.login,
    { provider: "soop", state, binding: binding(req.uid), popup, link, redirect, time: Date.now() },
    login.cookie
  );

  const url = new URL("https://openapi.sooplive.com/auth/code");

  url.search = new URLSearchParams({ client_id: config.id, scope: config.scope, state });
  return res.redirect(url.href);
});

router.get("/soop/callback", async (req, res) => {
  const value = req.signedCookies?.[session.login];
  const done = (result) => login.finish(res, value?.popup === true, result);

  res.clearCookie(session.login, login.clear);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (
    !config.enabled ||
    !req.uid ||
    value?.provider !== "soop" ||
    !config.redirects.includes(value.redirect) ||
    typeof req.query.state !== "string" ||
    req.query.state !== value.state ||
    !Number.isFinite(value.time) ||
    Date.now() < value.time ||
    Date.now() - value.time > login.cookie.maxAge ||
    value.binding !== binding(req.uid)
  )
    return done("error");

  if (req.query.error === "access_denied") return done("cancel");

  if (typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096)
    return done("error");
  try {
    const account = await soop.verify(req.query.code, value.redirect);
    const uid = await soop.connect(req.uid, account, value.link === true);

    return done(await login.complete(req, res, uid));
  } catch {
    return done("error");
  }
});

export default router;
