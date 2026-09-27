import { Router } from "express";
import identity from "#config/uid";
import address from "#config/ip";
import { viewer } from "#service/chatting";
import * as report from "#service/report";
import * as role from "#shared/role";
import limit from "#middleware/limit";

const router = Router();
const allowed = limit("report:allowed", 5);
const current = (req) => viewer(identity(req), address(req), req.app.get("env") === "development");

router.use((req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  next();
});

router.post("/", async (req, res) => {
  const user = await current(req);

  if (!(await allowed(user.uid))) {
    res.set("Retry-After", "60");

    return res.status(429).end();
  }

  res.status(201).json(await report.save(user, address(req), req.body));
});

router.get("/", async (req, res) => {
  const user = await current(req);
  const result = await report.list(user, req.query);
  const fresh = await current(req);

  if (!role.staff(fresh.role) || fresh.role !== user.role) return res.status(403).end();

  res.json(result);
});

router.use((error, req, res, next) => {
  if (error.status) return res.status(error.status).end();

  next(error);
});

export default router;
