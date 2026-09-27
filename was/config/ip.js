export default (req) => {
  const value = process.env.VERCEL ? req.get("x-vercel-forwarded-for") : req.ip;

  return String(value || "")
    .replace(/^::ffff:|,.*/g, "")
    .trim();
};
