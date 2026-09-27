import fallback from "#config/ogq";
import recent from "#config/recent";
import * as rules from "#shared/attach";

export const packs = (body) =>
  (Array.isArray(body?.data) ? body.data : []).flatMap((pack) => {
    const count = Number(pack?.ogq_numbering);

    if (
      pack?.ogq_type !== "STICKER" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1000 ||
      typeof pack.ogq_title !== "string"
    )
      return [];
    const items = Array.from({ length: count }, (_, index) =>
      rules.ogq({
        ogq_id: pack.ogq_id,
        number: index + 1,
        size: 160,
        extension: pack.extension,
        version: pack.version
      })
    ).filter(Boolean);

    return items.length
      ? [
          {
            title: pack.ogq_title.slice(0, 100),
            icon: `${rules.domain}/sticker/${pack.ogq_id}/tab_51.png`,
            items
          }
        ]
      : [];
  });

export const normalize = (body) => {
  if (body?.RESULT !== 1 || !body.DATA) return [];

  return Object.entries(body.DATA).flatMap(([type, values]) => {
    if (!Array.isArray(values)) return [];

    return values.flatMap((value) => {
      if (type === "default")
        return typeof value === "string" && value && value.length <= 100
          ? [{ type: "emoji", value }]
          : [];

      if (type !== "ogq") return [];
      const item = rules.ogq({
        ogq_id: value?.szOgqId,
        number: Number(value?.nOgqNumber),
        size: 160,
        extension: value?.extension
      });

      return item ? [item] : [];
    });
  });
};

const request = async (name) => {
  try {
    const response = await fetch(`https://live.sooplive.com/api/${name}.php`, {
      signal: AbortSignal.timeout(5000),
      redirect: "error"
    });

    if (!response.ok) return null;
    const body = await response.text();

    return body.length <= 1_000_000 ? JSON.parse(body) : null;
  } catch {
    return null;
  }
};

let cached;
let expires = 0;
let pending;

export default async function catalog() {
  if (cached && Date.now() < expires) return cached;

  pending ||= (async () => {
    const [ogq, used] = await Promise.all([request("ogq"), request("recent_used_emoticon")]);
    const groups = ogq?.code === 1 ? packs(ogq) : [];
    const items = normalize(used);

    const owned = groups.length ? groups : packs(fallback);
    const stickers = owned.flatMap((group) => group.items);

    cached = {
      groups: owned,
      recent: (items.length ? items : normalize(recent)).flatMap((item) => {
        if (item.type === "emoji") return [item];
        const found = stickers.find(
          (value) => value.ogq_id === item.ogq_id && value.number === item.number
        );

        return found ? [{ ...found, size: item.size }] : [];
      }),
      fallback: { ogq: !groups.length, recent: !items.length }
    };

    expires = Date.now() + 300_000;

    return cached;
  })().finally(() => {
    pending = undefined;
  });

  return pending;
}

export const accept = async (value) => {
  const item = rules.ogq(value);

  if (!item) return null;
  const data = await catalog();
  const known = data.groups
    .flatMap((group) => group.items)
    .find(
      (entry) =>
        entry.type === "ogq" && entry.ogq_id === item.ogq_id && entry.number === item.number
    );

  return known ? { ...known, size: item.size } : null;
};
