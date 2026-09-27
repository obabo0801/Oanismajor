export const maximum = 10;
export const description = 500;
export const types = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const domain = "https://ogq-sticker-global-cdn-z01.sooplive.com";

export const formats = {
  __proto__: null,
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/ogg",
  oga: "audio/ogg",
  weba: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  amr: "audio/amr",
  wma: "audio/x-ms-wma",
  mp2: "audio/mpeg",
  alac: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  flv: "video/x-flv",
  wmv: "video/x-ms-wmv",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2"
};

export const mime = (name = "") =>
  formats[name.split(".").at(-1)?.toLowerCase()] || "application/octet-stream";

export const icon = (name) =>
  ({ image: "image", audio: "sound", video: "media" })[mime(name).split("/")[0]] || "file";

export const giphy = (value) => {
  if (
    !["gif", "sticker"].includes(value?.type) ||
    value.provider !== "giphy" ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9]{1,80}$/.test(value.id || "")
  )
    return null;

  return { type: value.type, provider: "giphy", id: value.id };
};

export const ogq = (value) => {
  if (
    !/^[a-f0-9]{8,32}$/i.test(value?.ogq_id || "") ||
    !Number.isInteger(value.number) ||
    value.number < 1 ||
    value.number > 1000 ||
    ![80, 160, 240].includes(value.size)
  )
    return null;

  return {
    type: "ogq",
    ogq_id: value.ogq_id,
    number: value.number,
    size: value.size,
    extension: ["png", "webp"].includes(value.extension) ? value.extension : "png",
    version: /^[\w.-]{1,32}$/.test(value.version || "") ? value.version : "1"
  };
};

export const source = (item) => {
  const value = ogq(item);

  return value
    ? `${domain}/sticker/${value.ogq_id}/${value.number}_${value.size}.${value.extension}`
    : "";
};

export const valid = (items) =>
  Array.isArray(items) &&
  items.length <= maximum &&
  items.every((item) => {
    if (item?.provider === "giphy") return Boolean(giphy(item));

    if (item?.type === "ogq") return Boolean(ogq(item));

    if (item?.type === "file")
      return (
        typeof item.file === "string" &&
        /^\/[a-f0-9]{8}\/[a-f0-9]{32}\.bin$/.test(item.file) &&
        typeof item.name === "string" &&
        item.name.length > 0 &&
        item.name.length <= 255 &&
        Number.isSafeInteger(item.size) &&
        item.size > 0
      );

    return (
      ["image", "gif"].includes(item?.type) &&
      [item.image, item.preview].every(
        (value) => typeof value === "string" && /^\/(?!\/)/.test(value)
      ) &&
      typeof item.description === "string" &&
      item.description.length <= description &&
      typeof item.spoiler === "boolean"
    );
  });
