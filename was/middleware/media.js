import media from "#service/media";
import rendition from "#service/image/rendition";
import * as rules from "#shared/rendition";

export default async function resolve(req, res, next) {
  const url = new URL(req.url, "http://localhost");
  const match = /^\/media\/([a-f0-9]{32})$/.exec(url.pathname);

  if (!match || !["GET", "HEAD"].includes(req.method)) return next();
  try {
    if (url.searchParams.has("size")) {
      const value = url.searchParams.get("size");
      const size = rules.sizes.find((item) => String(item) === value);

      if (
        !size ||
        (url.searchParams.has("auto") &&
          (url.searchParams.getAll("auto").length !== 1 || url.searchParams.get("auto") !== "1")) ||
        url.searchParams.getAll("size").length !== 1 ||
        url.searchParams.getAll("v").length !== 1 ||
        url.searchParams.get("v") !== rules.version ||
        [...url.searchParams.keys()].some((key) => !["size", "v", "auto"].includes(key))
      ) {
        res.statusCode = 400;
        res.setHeader("Cache-Control", "no-store");
        return res.end();
      }

      const file = await rendition(match[1], size, url.searchParams.get("auto") === "1");

      if (res.destroyed || res.writableEnded) return;

      res.sendFile(
        file,
        { dotfiles: "deny", maxAge: "1d", headers: { "X-Content-Type-Options": "nosniff" } },
        (error) => {
          if (error && !res.headersSent) next(error);
        }
      );

      return;
    }

    const location = await media(match[1]);

    if (!location && req.app.get("env") === "development") {
      return next(Object.assign(new Error("Missing image"), { status: 404 }));
    }

    res.statusCode = location ? 302 : 404;
    res.setHeader("Cache-Control", "no-store");
    if (location) res.setHeader("Location", location);

    res.end();
  } catch (error) {
    if (url.searchParams.has("size") && !res.headersSent) {
      res.setHeader("Cache-Control", "no-store");
      if (error.status === 503) res.setHeader("Retry-After", "2");
    }

    next(error);
  }
}
