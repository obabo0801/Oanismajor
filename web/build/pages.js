import * as location from "#shared/location";

export default {
  name: "content-pages",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const name = location.page(req.url);

      if (["GET", "HEAD"].includes(req.method) && name)
        req.url = ["index", "admin"].includes(name) ? "/index.html" : `/src/${name}.html`;

      next();
    });
  }
};
