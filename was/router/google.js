import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import * as config from "#config/google";
import * as google from "#service/google";
import * as session from "#service/session";
import * as ids from "#config/uid";
import * as db from "#db";
import address from "#config/ip";
import client from "#config/client";
import * as events from "#service/events";
import limit from "#middleware/limit";
import * as deletion from "#service/account";
import * as login from "#service/login";

const router = Router();
const key = session.login;
const recovery = session.recovery;
const allowed = limit("google:allowed", 20);
const { cookie, clear, finish } = login;
const random = () => randomBytes(32).toString("base64url");

router.get("/google", async (req, res) => {
  const popup = req.query.popup === "1";

  res.set("Cache-Control", "no-store");
  if (!config.enabled) return finish(res, popup, "unavailable");
  const origin = req.query.origin ?? `${req.protocol}://${req.get("host")}`;
  const redirect = config.redirect(origin);

  if (!redirect) return finish(res, popup, "unsupported");

  if (!req.uid || !(await allowed(address(req)))) return finish(res, popup, "error");
  const state = random();
  const nonce = random();
  const verifier = random();
  const binding = createHash("sha256").update(req.uid).digest("base64url");

  res.cookie(
    key,
    { provider: "google", state, nonce, verifier, binding, popup, redirect, time: Date.now() },
    cookie
  );

  res.redirect(
    config.client.generateAuthUrl({
      redirect_uri: redirect,
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      prompt: "select_account",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256"
    })
  );
});

router.get("/google/callback", async (req, res) => {
  const value = req.signedCookies?.[key];
  const done = (result) => finish(res, value?.popup === true, result);

  res.clearCookie(key, clear);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (
    !config.enabled ||
    !req.uid ||
    !value ||
    (value.provider && value.provider !== "google") ||
    !config.redirects.includes(value.redirect) ||
    typeof req.query.state !== "string" ||
    req.query.state !== value.state ||
    Date.now() - value.time > cookie.maxAge ||
    value.binding !== createHash("sha256").update(req.uid).digest("base64url")
  )
    return done("error");

  if (req.query.error === "access_denied") return done("cancel");

  if (typeof req.query.code !== "string") return done("error");
  try {
    const account = await google.verify(
      req.query.code,
      value.verifier,
      value.nonce,
      value.redirect
    );
    const uid = await google.connect(req.uid, account);

    return done(await login.complete(req, res, uid));
  } catch {
    return done("error");
  }
});

router.delete("/account", async (req, res) => {
  if (req.get("sec-fetch-site") === "cross-site" || !req.is("application/json"))
    return res.status(403).end();
  const user = await deletion.request(req.uid);

  if (!user) return res.status(403).end();

  await guest(req, res);
  res.clearCookie(recovery, clear);

  return res.status(204).end();
});

router.get("/account", async (req, res) => {
  res.set("Cache-Control", "private, no-store");

  const user = await deletion.pending(req.signedCookies?.[recovery]);

  return res.json({ deletion: user?.deletion || null });
});

router.post("/account", async (req, res) => {
  if (req.get("sec-fetch-site") === "cross-site" || !req.is("application/json"))
    return res.status(403).end();
  const user = await deletion.restore(req.signedCookies?.[recovery]);

  res.clearCookie(recovery, clear);
  if (!user) return res.status(409).end();

  await session.remember(res, user.uid);
  events.broadcast("online");

  return res.status(204).end();
});

async function guest(req, res) {
  const saved = await session.read(req.signedCookies?.[session.anonymous]);
  const user =
    saved &&
    (await db.get(
      `
        SELECT uid
        FROM account.profile
        WHERE uid = ?
          AND NOT verified
          AND deletion IS NULL
          AND erased = 0
      `,
      [saved.uid]
    ));

  const uid = user?.uid || (await session.create(address(req), client(req).lang));

  const previous = req.signedCookies?.[session.anonymous];

  await session.remember(res, uid, session.anonymous, previous);
  await session.remember(res, uid, ids.key, previous);
}

router.post("/logout", async (req, res) => {
  if (req.get("sec-fetch-site") === "cross-site" || !req.is("application/json"))
    return res.status(403).end();

  const user = await db.get(
    `
      SELECT verified
      FROM account.profile
      WHERE uid = ?
    `,
    [req.uid]
  );

  if (!user?.verified) return res.status(204).end();

  await session.revoke(req.signedCookies?.[ids.key]);
  await guest(req, res);

  events.disconnect(req.uid);

  res.status(204).end();
});

export default router;
