import * as http from "node:http";
import * as https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

const blocked = new BlockList();
const cache = new Map();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
])
  blocked.addSubnet(address, prefix);

async function read(value, redirects = 0) {
  const url = new URL(value);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Unsupported URL");
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  const address = addresses[0]?.address;

  if (!address || addresses.some((item) => blocked.check(item.address)))
    throw new Error("Private URL");
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "text/html", "Accept-Encoding": "identity" },
        lookup: (_host, options, done) =>
          done(null, options.all ? [{ address, family: 4 }] : address, options.all ? undefined : 4)
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          resolve({ redirect: res.headers.location });

          return;
        }

        if (res.statusCode !== 200 || !res.headers["content-type"]?.includes("text/html")) {
          res.resume();
          reject(new Error("Not HTML"));

          return;
        }

        const chunks = [];

        let size = 0;

        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 262144) {
            resolve({ html: Buffer.concat(chunks).toString("utf8"), url: url.href });

            res.destroy();
          } else chunks.push(chunk);
        });

        res.on("end", () =>
          resolve({ html: Buffer.concat(chunks).toString("utf8"), url: url.href })
        );

        res.on("error", reject);
      }
    );

    request.on("error", reject);
  });

  if (response.redirect && redirects < 3)
    return read(new URL(response.redirect, url).href, redirects + 1);

  return response;
}

const decode = (value = "") =>
  value
    .replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([a-f0-9]+));/gi, (match, decimal, hex) => {
      if (decimal || hex) {
        const code = parseInt(decimal || hex, hex ? 16 : 10);

        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }

      return (
        { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#39;": "'" }[
          match.toLowerCase()
        ] || ""
      );
    })
    .slice(0, 1000);

export default async function metadata(url) {
  const cached = cache.get(url);

  if (cached && cached.until > Date.now()) return cached.value;
  const value = (async () => {
    try {
      const page = await read(url);
      const tags = {};

      for (const tag of page.html?.match(/<meta\b[^>]*>/gi) || []) {
        const attrs = {};

        for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
          attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
        tags[attrs.property || attrs.name] = attrs.content;
      }

      const image = tags["og:image"] && new URL(tags["og:image"], page.url);

      return {
        title: tags["og:title"] || decode(page.html?.match(/<title[^>]*>([^<]*)/i)?.[1]),
        description: tags["og:description"] || tags.description || "",
        image: image && ["http:", "https:"].includes(image.protocol) ? image.href : ""
      };
    } catch {
      return { title: "", description: "", image: "" };
    }
  })();

  cache.delete(url);
  cache.set(url, { until: Date.now() + 600000, value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);

  return value;
}
