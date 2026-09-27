import * as attachment from "#shared/attach";

export const identify = (value, origin) => {
  try {
    const url = new globalThis.URL(value, origin);

    if (!value || url.username || url.password || url.hash) return "";

    if (url.origin === origin && !url.search) {
      const file = /^\/(?:[a-f0-9]{8}|media)\/([a-f0-9]{32})(?:\.(?:gif|jpg|png|webp))?$/.exec(
        url.pathname
      );
      const icon = /^\/icons\/icon-(192|512)\.png$/.exec(url.pathname);

      return file?.[1] || (icon ? `icon-${icon[1]}` : "");
    }

    if (url.origin === attachment.domain) {
      const item = /^\/sticker\/([a-f0-9]{8,32})\/(\d+)_(80|160|240)\.(png|webp)$/.exec(
        url.pathname
      );

      return item ? `ogq-${item.slice(1).join("-")}` : "";
    }
  } catch {}

  return "";
};

export const source = (id) => {
  if (/^[a-f0-9]{32}$/.test(id)) return `/media/${id}`;

  if (/^icon-(192|512)$/.test(id)) return `/icons/${id}.png`;
  const match = /^ogq-([a-f0-9]{8,32})-(\d+)-(80|160|240)-(png|webp)$/.exec(id);

  return match
    ? attachment.source({
        ogq_id: match[1],
        number: Number(match[2]),
        size: Number(match[3]),
        extension: match[4]
      })
    : "";
};

export const bounds = (width, height, angle) => {
  const radians = (angle * Math.PI) / 180;
  const horizontal = Math.abs(Math.cos(radians));
  const vertical = Math.abs(Math.sin(radians));

  return {
    width: width * horizontal + height * vertical,
    height: width * vertical + height * horizontal
  };
};
