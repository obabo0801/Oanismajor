import "dotenv/config";
import { root } from "./path.js";

process.env.CLOUDSDK_CONFIG ||= root(".config", "gcloud");

if (!process.env.GOOGLE_CLOUD_QUOTA_PROJECT && process.env.GOOGLE_CLOUD_PROJECT?.trim()) {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = process.env.GOOGLE_CLOUD_PROJECT.trim();
}

const secret = process.env.COOKIE_SECRET;

if (!secret?.trim()) {
  throw new Error("COOKIE_SECRET is required. Set a persistent random secret.");
}

export const mode = process.env.NODE_ENV || "production";

if (!["development", "test", "production"].includes(mode)) {
  throw new Error("NODE_ENV must be development, test, or production.");
}

process.env.NODE_ENV = mode;

export default secret;
