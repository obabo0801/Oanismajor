import { createHash } from "node:crypto";

export const signature = () => {
  if (!process.env.COOKIE_SECRET) throw new Error("COOKIE_SECRET is required for discovery");

  return hash(64, process.env.COOKIE_SECRET);
};

export default function hash(length, ...values) {
  const result = createHash("sha256");

  values.forEach((value) => {
    result.update(value);
  });

  return result.digest("hex").slice(0, length);
}
