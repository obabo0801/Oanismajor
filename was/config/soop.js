export const id = process.env.SOOP_CLIENT_KEY || "";
export const secret = process.env.SOOP_SECRET_KEY || "";
export const scope = "user_stationinfo validate_live_status";
export const consent = process.env.SOOP_CONSENT === "true";
export const redirects = (process.env.SOOP_REDIRECT_URI || "")
  .split(/[\s,]+/)
  .filter(Boolean)
  .map((value) => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.pathname !== "/api/04f8996d/soop/callback"
    )
      throw new Error("Invalid SOOP_REDIRECT_URI");

    return url.href;
  });
export const redirect = (origin) => redirects.find((value) => new URL(value).origin === origin);
export const enabled = Boolean(
  id && secret && redirects.length && consent && process.env.SOOP_ENABLED === "true"
);
