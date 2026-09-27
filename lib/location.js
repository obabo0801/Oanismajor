const user = "([a-f0-9]{32})";
const image = [
  "[a-f0-9]{32}",
  "icon-(?:192|512)",
  "giphy-[a-zA-Z0-9]{1,80}",
  "ogq-[a-f0-9]{8,32}-[0-9]{1,4}-(?:80|160|240)-(?:png|webp)"
].join("|");

const routes = [
  ["login", "popover", "/login"],
  ["terms", "drawer", "/terms"],
  ["privacy", "drawer", "/privacy"],
  ["settings", "popover", "/settings"],
  ["admin", "drawer", "/admin"],
  ["chat-settings", "drawer", "/chat/settings"],
  ["inbox", "drawer", "/messages"],
  ["room", "drawer", "/messages/rooms/([a-f0-9-]{36})"],
  ["message", "drawer", `/messages/${user}`],
  [
    "settings-section",
    "drawer",
    "/settings/(language|theme|sound|notifications|chat|data|contact)"
  ],
  ["online", "popover", "/online"],
  ["profile", "popover", `/profile/${user}`],
  ["image", "popover", `/image/(${image})`],
  ["history-chatting", "drawer", `/profile/${user}/messages`],
  ["history-sanction", "drawer", `/profile/${user}/sanctions`],
  ["reports", "drawer", `/profile/${user}/reports`],
  ["reports", "drawer", "/reports"],
  ["authority", "drawer", `/profile/${user}/permissions`],
  ["select", "popover", "/preferences/([a-zA-Z0-9_-]{1,80})"]
].map(([name, type, path]) => ({ name, type, pattern: new RegExp(`^${path}/?$`) }));

const actions = {
  attachment: "/chatting/attachment",
  avatar: "/profile/image/select",
  phone: "/profile/image/phone"
};

export const read = (value) => {
  const url = new globalThis.URL(value, "http://localhost");
  const media = /^\/(audio|video)\/([a-f0-9]{8})\/([a-f0-9]{32})\/?$/.exec(url.pathname);

  if (media) return ["popover", media[1], `/${media[2]}/${media[3]}.bin${url.search}`];

  const admin = /^\/admin\/(notification|users|database|upload|tts|stt|connection|rooms)\/?$/.exec(
    url.pathname
  );

  if (admin) return ["drawer", "admin-section", admin[1] + url.search];

  const action = Object.entries(actions).find(
    ([, path]) => path === url.pathname.replace(/\/$/, "")
  );

  if (action) return ["sheet", "actions", action[0]];

  const layer = /^\/layer\/(popover|drawer|sheet)\/([a-zA-Z0-9-]{1,100})\/?$/.exec(url.pathname);

  if (layer) return [layer[1], "layer", layer[2]];

  for (const { name, type, pattern } of routes) {
    const match = pattern.exec(url.pathname);

    if (!match) continue;

    return [type, name, match[1] || ""];
  }

  return null;
};

export const page = (value) => {
  if (/^\/rooms\/[a-f0-9-]{36}\/?$/.test(new URL(value, "http://localhost").pathname))
    return "index";
  const state = read(value);

  return state
    ? state[1] === "admin-section" || (["admin", "reports"].includes(state[1]) && !state[2])
      ? "admin"
      : "index"
    : "";
};

export const href = ([type, name, id]) => {
  if (name === "audio" || name === "video") {
    const source = new globalThis.URL(id, "http://localhost");
    const match = /^\/([a-f0-9]{8})\/([a-f0-9]{32})\.bin$/.exec(source.pathname);

    return match ? `/${name}/${match[1]}/${match[2]}${source.search}` : "/";
  }

  if (name === "target") return id.startsWith("/") && !id.startsWith("//") ? id : "/";

  if (name === "admin-section") return `/admin/${id}`;

  if (name === "actions") return actions[id] || "/";

  if (name === "layer") return `/layer/${type}/${encodeURIComponent(id)}`;

  if (name === "login") return "/login";

  if (name === "terms" || name === "privacy") return `/${name}`;

  if (name === "settings") return "/settings";

  if (name === "admin") return "/admin";

  if (name === "chat-settings") return "/chat/settings";

  if (name === "inbox") return "/messages";

  if (name === "room") return `/messages/rooms/${id}`;

  if (name === "message") return `/messages/${id}`;

  if (name === "settings-section") return `/settings/${encodeURIComponent(id)}`;

  if (name === "online") return "/online";

  if (name === "image") return `/image/${encodeURIComponent(id)}`;

  if (name === "select") return `/preferences/${encodeURIComponent(id)}`;

  if (name === "reports" && !id) return "/reports";
  const base = `/profile/${id}`;
  const paths = {
    "history-chatting": "messages",
    "history-sanction": "sanctions",
    reports: "reports",
    authority: "permissions"
  };

  if (paths[name]) return `${base}/${paths[name]}`;

  if (name === "profile") return base;

  return "/";
};
