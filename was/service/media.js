import { access } from "node:fs/promises";

import * as path from "#config/path";
import { routes } from "#config/media";

export default async function media(id) {
  if (!/^[a-f0-9]{32}$/.test(id)) return "";
  const images = routes.filter((route) => !route.directory.startsWith("audio/"));

  const results = await Promise.all(
    images.flatMap(({ directory, prefix }) =>
      ["gif", "jpg", "png", "webp"].map(async (extension) => {
        const file = `${id}.${extension}`;

        try {
          await access(path.upload(directory, file));

          return `${prefix}/${file}`;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;

          return "";
        }
      })
    )
  );

  return results.find(Boolean) || "";
}
