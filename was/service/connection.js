import * as fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import { isIP } from "node:net";
import { createECDH } from "node:crypto";

const root = path.resolve(import.meta.dirname, "../..");
const timeout = 4000;
const names = ["HTTPS", "TTS", "STT", "GOOGLE", "SOOP", "VAPID", "GIPHY"];

let pending;
let cached;

function certificate() {
  if (!process.env.HTTPS_HOST) return { state: "missing" };
  return new Promise((resolve) => {
    let socket;
    let timer;

    const finish = (result) => {
      clearTimeout(timer);
      socket?.destroy();
      resolve(result);
    };

    timer = setTimeout(() => finish({ state: "unavailable" }), timeout);

    try {
      const url = new URL(`https://${process.env.HTTPS_HOST}`);
      const host = url.hostname.replace(/^\[|\]$/g, "");

      socket = tls.connect(
        {
          host,
          port: Number(url.port || 443),
          servername: isIP(host) ? undefined : host,
          rejectUnauthorized: false
        },
        () => {
          const cert = socket.getPeerCertificate();
          const start = Date.parse(cert.valid_from);
          const end = Date.parse(cert.valid_to);
          const valid = socket.authorized && !tls.checkServerIdentity(host, cert);
          const state =
            end <= Date.now()
              ? "expired"
              : !valid
                ? "invalid"
                : end - Date.now() < 86400000
                  ? "expiring"
                  : "valid";

          finish({
            state,
            host,
            issuer: cert.issuer?.O || cert.issuer?.CN || "",
            start: Number.isFinite(start) ? start : null,
            end: Number.isFinite(end) ? end : null
          });
        }
      );

      socket.once("error", () => finish({ state: "unavailable" }));
    } catch {
      finish({ state: "invalid" });
    }
  });
}

async function cloud(name) {
  const mode = (process.env[name] || "").trim().toLowerCase();

  if (!mode) return { state: name === "TTS" ? "fallback" : "disabled" };

  if (!["login", "json"].includes(mode)) return { state: "invalid" };
  const file =
    mode === "json"
      ? process.env.GOOGLE_APPLICATION_CREDENTIALS
      : process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        path.join(
          process.env.CLOUDSDK_CONFIG || path.join(root, ".config/gcloud"),
          "application_default_credentials.json"
        );

  if (!file) return { state: "missing" };
  try {
    await fs.access(file);
  } catch {
    return { state: "missing" };
  }
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      keyFilename: file,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      clientOptions: { transporterOptions: { timeout, retry: false } }
    });
    const token = await auth.getAccessToken();

    return { state: token ? "authenticated" : "invalid" };
  } catch (error) {
    const code = error.response?.status;

    return { state: [400, 401, 403].includes(code) ? "invalid" : "unavailable" };
  }
}

function google() {
  const env = process.env;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI)
    return { state: "missing" };
  try {
    const redirects = env.GOOGLE_REDIRECT_URI.split(/[\s,]+/).filter(Boolean);

    if (!redirects.length || !env.GOOGLE_CLIENT_ID.trim() || !env.GOOGLE_CLIENT_SECRET.trim())
      return { state: "missing" };
    for (const value of redirects) {
      const url = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

      if (
        (!local && isIP(url.hostname.replace(/^\[|\]$/g, ""))) ||
        (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return { state: "invalid" };
    }
    return { state: "configured" };
  } catch {
    return { state: "invalid" };
  }
}

async function soop() {
  if (
    !process.env.SOOP_CLIENT_KEY?.trim() ||
    !process.env.SOOP_SECRET_KEY?.trim() ||
    !process.env.SOOP_REDIRECT_URI?.trim()
  )
    return { state: "missing" };
  try {
    const config = await import("#config/soop");

    if (!config.redirects.length) return { state: "invalid" };
    return { state: config.enabled ? "configured" : "disabled" };
  } catch {
    return { state: "invalid" };
  }
}

function vapid() {
  const env = process.env;

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return { state: "missing" };
  try {
    const subject = new URL(env.VAPID_SUBJECT);
    const pair = createECDH("prime256v1");

    pair.setPrivateKey(Buffer.from(env.VAPID_PRIVATE_KEY, "base64url"));

    const valid =
      pair.getPublicKey().toString("base64url") === env.VAPID_PUBLIC_KEY &&
      ["https:", "mailto:"].includes(subject.protocol);

    return { state: valid ? "configured" : "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

async function giphy() {
  const key = process.env.VITE_GIPHY_API_KEY;

  if (!key) return { state: "missing" };
  try {
    const params = new URLSearchParams({ api_key: key, limit: "1", rating: "g" });
    const response = await fetch(`https://api.giphy.com/v1/gifs/trending?${params}`, {
      signal: AbortSignal.timeout(timeout)
    });

    await response.body?.cancel();
    if (!response.ok)
      return { state: [401, 403].includes(response.status) ? "invalid" : "unavailable" };

    const directory = path.join(root, "web/dist/assets");
    const files = await fs.readdir(directory);

    for (const file of files.filter((name) => name.endsWith(".js")))
      if ((await fs.readFile(path.join(directory, file), "utf8")).includes(key))
        return { state: "connected" };
    return { state: "rebuild" };
  } catch (error) {
    return { state: error.code === "ENOENT" ? "rebuild" : "unavailable" };
  }
}

export async function read({ offline = false, refresh = false } = {}) {
  if (offline) return { items: names.map((name) => ({ name, state: "unchecked" })) };

  if (!refresh && cached && Date.now() - cached.time < 60000) return cached;

  if (!pending)
    pending = (async () => {
      const results = await Promise.allSettled([
        certificate(),
        cloud("TTS"),
        cloud("STT"),
        google(),
        soop(),
        vapid(),
        giphy()
      ]);

      cached = {
        time: Date.now(),
        items: results.map((result, index) => ({
          name: names[index],
          ...(result.status === "fulfilled" ? result.value : { state: "unavailable" })
        }))
      };

      return cached;
    })().finally(() => {
      pending = undefined;
    });
  return pending;
}
