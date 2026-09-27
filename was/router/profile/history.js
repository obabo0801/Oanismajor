import { Router } from "express";
import identity from "#config/uid";
import address from "#config/ip";
import * as role from "#shared/role";
import { viewer } from "#service/chatting";
import { resolve } from "#service/profile/data";
import * as history from "#service/profile/history";
import * as report from "#service/report";

const router = Router();

const allowed = async (req) => {
  const user = await viewer(identity(req), address(req), req.app.get("env") === "development");

  if (!role.staff(user.role)) return { status: 403 };
  const target = await resolve(req.params.id);

  if (!target) return { status: 404 };

  if (!role.manages(user, target)) return { status: 403 };

  return { user, target };
};

router.get("/:id/history/:type", async (req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  try {
    const access = await allowed(req);

    if (access.status) return res.status(access.status).end();
    const { user, target } = access;
    const { type } = req.params;

    if (!["chatting", "block", "sanction", "report"].includes(type)) return res.status(404).end();
    const result =
      type === "report"
        ? await report.list(user, req.query, target.uid)
        : type === "chatting"
          ? await history.chatting(user, target.uid, req.query)
          : await history.block(target.uid, req.query, type === "sanction");
    const fresh = await allowed(req);

    if (fresh.status) return res.status(fresh.status).end();

    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).end();

    next(error);
  }
});

export default router;
