import { page, reject } from "#page";
import { unavailable } from "#maint";
import * as database from "#db/connect";

export default function error(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.status === 404) {
    res.set({ "Cache-Control": "no-store", Vary: "Sec-Fetch-Dest, Accept" });

    return reject(req, res);
  }

  const missing = error?.code === "ENOENT";

  if (!missing && error?.status !== 503 && error?.code !== "55P03" && !database.unavailable(error))
    return next(error);

  console.warn("Service unavailable", {
    method: req.method,
    path: req.path,
    code: error?.code || "UNAVAILABLE",
    reason: error?.message || "Service unavailable"
  });

  res.set({ "Cache-Control": "no-store", "Retry-After": "3" });

  if (missing || !page(req)) {
    return res.status(503).end();
  }

  return unavailable(res);
}
