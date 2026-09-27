import secret from "#config/env";
import { report as reportPath } from "#shared/route";

import cookie from "cookie-parser";
import express from "express";

import block from "#block";
import maint from "#maint";
import * as page from "#page";
import assets from "#assets";
import upload from "#upload";
import error from "#error";
import router from "#router";
import session from "#middleware/session";
import * as account from "#service/account";
import * as cluster from "#service/cluster";
import * as events from "#service/events";
import * as image from "#service/image";
import { close } from "#db/connect";
import { get } from "#db";
import { signature } from "../was/config/hash.js";

const server = express();
const port = process.env.PORT;
const host = process.env.HOST;

server.set("trust proxy", [
  "loopback",
  ...(process.env.PROXY_NETWORK || "").split(",").filter(Boolean)
]);

server.get("/_health", async (req, res) => {
  try {
    await get(`
      SELECT 1
    `);

    res.set("X-oanismajor-Server", signature()).sendStatus(204);
  } catch {
    res.sendStatus(503);
  }
});

server.use(cookie(secret));
server.use(session);
server.use(`/api${reportPath}`, express.json({ limit: "5mb" }));
server.use(express.json());
server.use(block);
server.use(maint);
server.use("/api", router);
server.use(upload);
server.use(page.router);
server.use(assets);
server.use(page.reject);
server.use(error);
await image.prepare();
await cluster.start();
await account.start();

const listener = server.listen(port, host, () => {
  console.log(`http://localhost:${port}`);
});

let stopping = false;

const stop = async () => {
  if (stopping) return;

  stopping = true;
  setTimeout(() => process.exit(1), 10000).unref();
  events.shutdown();
  await new Promise((resolve) => listener.close(resolve));
  await cluster.close();
  await close();
  process.exit(0);
};

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
