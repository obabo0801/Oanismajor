import { Router } from "express";
import emoji from "#service/emoji";
import ogq from "#service/ogq";

const router = Router();

router.get("/ogq", async (_, res) => {
  res.set("Cache-Control", "private, no-store");

  const { groups } = await ogq();

  res.json({ groups });
});

router.get("/", async (_, res) => {
  const result = await emoji();

  res.set("Cache-Control", "private, max-age=60");
  res.json(result);
});

export default router;
