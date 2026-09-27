import * as config from "#config/emoji";

const endpoint = "https://st.sooplive.com/api/emoticons.php";
const base = "https://res.sooplive.com/images/chat/emoticon/big/";
const keyword = /^\/[^/\s]{1,80}\/$/u;

let cached = [];
let expires = 0;
let pending;
let unavailable = false;

const source = (value) => {
  if (typeof value !== "string" || /[\\\s]/u.test(value)) return "";

  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);

    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
};

const image = (file) => {
  if (typeof file !== "string" || !file) return "";
  const url = new URL(file, base);

  return url.href.startsWith(base) ? url.href : "";
};

const normalize = (groups) => {
  const seen = new Set();

  return groups.slice(0, 40).flatMap((group) => {
    if (typeof group?.title !== "string" || !Array.isArray(group.items)) return [];
    const items = group.items.slice(0, 1000).flatMap((item) => {
      const src = source(item?.src);

      if (!src || !keyword.test(item?.keyword) || seen.has(item.keyword)) return [];

      seen.add(item.keyword);

      return [{ keyword: item.keyword, src, still: source(item.still) }];
    });

    if (!items.length) return [];
    const icon =
      source(group.icon) ||
      (typeof group.icon === "string" && /^[a-z][a-z-]{0,30}$/.test(group.icon)
        ? group.icon
        : "smile");

    return [{ title: group.title.slice(0, 80), icon, items }];
  });
};

const refresh = async () => {
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept-Language": "ko" }
    });

    if (!response.ok) throw new Error("Emoji request failed");
    const body = await response.json();
    const groups = body?.data?.default?.groups;

    if (body.result !== 1 || !Array.isArray(groups) || !groups.length)
      throw new Error("Invalid emoji catalog");
    const next = normalize(
      groups.map((group) => {
        const items = (group.emoticons || [])
          .filter((item) => !item.isDeprecated)
          .map((item) => ({
            keyword: item.keyword,
            src: image(item.fileName),
            still: image(item.staticFileName)
          }));

        return { title: group.title, icon: items[0]?.still || items[0]?.src, items };
      })
    );

    if (!next.length) throw new Error("Empty emoji catalog");

    cached = next;
    unavailable = false;
    expires = Date.now() + 60 * 60 * 1000;
  } catch {
    unavailable = true;
    expires = Date.now() + 60 * 1000;
  }
};

export default async function emoji() {
  if (config.soop && Date.now() >= expires) {
    pending ||= refresh().finally(() => {
      pending = undefined;
    });

    await pending;
  }

  return {
    groups: normalize([...config.groups, ...(config.soop ? cached : [])]),
    unavailable: config.soop && unavailable
  };
}
