import express from "express";

import * as path from "#config/path";

const dist = path.dist();
const hashed = path.dist("assets");

const assets = express.static(dist, {
  setHeaders(res, file) {
    const fresh = file.endsWith("worker.js") || file.endsWith("manifest.json");

    if (fresh) {
      res.setHeader("Cache-Control", "no-store");

      res.setHeader("Vary", "Sec-Fetch-Dest, Accept");

      return;
    }

    if (file.startsWith(hashed)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, " + "immutable");
    }
  }
});

export default assets;
