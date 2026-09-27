export const sizes = Object.freeze([160, 640, 1280, 1920, 2560]);
export const version = "1";

export const limits = Object.freeze({
  bytes: 4 * 1024 * 1024,
  pixels: 4000000,
  edge: 2560,
  frames: 16000000
});

export const large = ({ bytes, width, height, pages = 1 }) =>
  ![bytes, width, height, pages].every((value) => Number.isFinite(value) && value > 0) ||
  bytes > limits.bytes ||
  width * height > limits.pixels ||
  Math.max(width, height) > limits.edge ||
  width * height * pages > limits.frames;

const legacy = new RegExp(
  "^/upload/(?:images|users)/(?:original|cache|resizing)/" + "([a-f0-9]{32})\\.(gif|jpg|png|webp)$"
);

export function identify(value, base) {
  if (typeof value !== "string" || !value) return "";

  try {
    const origin = new globalThis.URL(base);
    const url = new globalThis.URL(value, origin);

    if (
      url.origin !== origin.origin ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      return "";

    if (url.search) {
      if (
        [...url.searchParams.keys()].some((key) => !["size", "v", "auto"].includes(key)) ||
        url.searchParams.getAll("size").length !== 1 ||
        !sizes.some((size) => String(size) === url.searchParams.get("size")) ||
        url.searchParams.getAll("v").length !== 1 ||
        url.searchParams.get("v") !== version ||
        (url.searchParams.has("auto") &&
          (url.searchParams.getAll("auto").length !== 1 || url.searchParams.get("auto") !== "1"))
      )
        return "";
    }

    const media = /^\/media\/([a-f0-9]{32})$/.exec(url.pathname);
    const file = /^\/[a-f0-9]{8}\/([a-f0-9]{32})\.(gif|jpg|png|webp)$/.exec(url.pathname);
    const old = legacy.exec(url.pathname);

    return media?.[1] || file?.[1] || old?.[1] || "";
  } catch {
    return "";
  }
}

export function source(value, size, base, automatic = false) {
  const id = identify(value, base);

  if (!id || !sizes.includes(size)) return "";

  return new globalThis.URL(
    `/media/${id}?size=${size}&v=${version}${automatic ? "&auto=1" : ""}`,
    base
  ).href;
}
