import { createHash } from "node:crypto";

export const key = "_sid";

export const publicId = (uid) =>
  createHash("sha256").update(`profile:${uid}`).digest("hex").slice(0, 32);

export const publicName = (value) =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
    ? publicId(value)
    : value || "";

export default (req) => req.uid || "";
