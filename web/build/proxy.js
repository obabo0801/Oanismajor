import { routes } from "#config/media";

export default (port = 3000) => {
  const target = `http://localhost:${port}`;

  return Object.fromEntries(
    ["/api", "/assets/", "/media/", "/upload", ...routes.map((route) => route.prefix)].map(
      (prefix) => [prefix, { target, xfwd: true }]
    )
  );
};
