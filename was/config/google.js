import { OAuth2Client } from "google-auth-library";

export const id = process.env.GOOGLE_CLIENT_ID || "";
export const secret = process.env.GOOGLE_CLIENT_SECRET || "";
export const redirects = (process.env.GOOGLE_REDIRECT_URI || "")
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
      url.search
    )
      throw new Error("Invalid GOOGLE_REDIRECT_URI");

    return url.href;
  });
export const redirect = (origin) => redirects.find((value) => new URL(value).origin === origin);
export const enabled = Boolean(id && secret && redirects.length);
export const client = new OAuth2Client(id, secret);
