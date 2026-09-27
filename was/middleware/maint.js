import * as role from "#shared/role";
import { get } from "#db";
import uid from "#config/uid";
import { page, send } from "#page";

export const unavailable = (res) => {
  res.set({ "Cache-Control": "private, no-store", "X-Maint": "true", Vary: "Cookie" });

  return send(res, "maint", 503);
};

export default async function maint(req, res, next) {
  if (!page(req)) {
    return next();
  }

  const active = process.env.MAINTENANCE === "true";
  const dev = req.app.get("env") === "development";

  if (!active || dev) {
    return next();
  }

  const id = uid(req);
  const user = id
    ? await get(
        `
          SELECT role
          FROM account.profile
          WHERE uid = ?
        `,
        [id]
      )
    : null;

  if (role.staff(user?.role)) {
    return next();
  }

  return unavailable(res);
}
