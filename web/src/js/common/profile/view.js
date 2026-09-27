import * as dom from "#common/dom";
import viewer from "#common/image/view";
import * as i18n from "#common/i18n";
import popover from "#common/popover";
import * as profile from "#common/profile";
import avatar from "#common/avatar";
import once from "#common/once";
import mount from "#common/mount";
import * as actions from "#common/profile/actions";
import toolbar from "#common/toolbar";
import * as storage from "#common/storage";
import * as route from "#common/route";
import * as names from "#common/profile/name";
import editor from "#common/profile/editor";
import devices from "./devices.js";

const opening = once();

route.register("profile", (id) => {
  if (!/^[a-f\d]{32}$/.test(id)) return false;

  return view(undefined, dom.query(".chatting"), {
    id,
    online: dom.query(".online"),
    hidden: storage.get(`chatting-hide:${id}`) === "true",
    context: "chatting",
    restore: true
  });
});

const keys = [
  "profile.id",
  "profile.protect",
  "profile.unprotect",
  "profile.email",
  "profile.userIp",
  "profile.accessIp",
  "profile.date",
  "profile.time",
  "profile.os",
  "profile.browser",
  "profile.lang",
  "profile.access",
  "profile.environment",
  "profile.blocked",
  "profile.unblock",
  "profile.unblockReason",
  "profile.blockTime",
  "profile.handler",
  "profile.authority",
  "profile.memo",
  "profile.editMemo",
  "profile.granted",
  "profile.activity",
  "profile.none",
  "profile.counts",
  "profile.saveError",
  "toggle.on",
  "toggle.off",
  "profile.chatMute",
  "profile.kick",
  "profile.unkick",
  "profile.block",
  "profile.blockTitle",
  "profile.blockReason",
  "profile.cancel",
  "profile.confirm",
  "profile.gift",
  "profile.message",
  "profile.whisper",
  "profile.hide",
  "profile.report",
  "profile.active",
  "profile.away"
];

i18n.preload(...keys);

const relative = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}+09:00`);
  const seconds = (date.getTime() - Date.now()) / 1000;

  if (!Number.isFinite(seconds)) {
    return "";
  }

  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units.at(-1);
  const lang = dom.root.lang || navigator.language;

  return new Intl.RelativeTimeFormat(lang, { numeric: "always" }).format(
    Math.round(seconds / size),
    unit
  );
};

const setState = (status, time, value, stamp, blocked) => {
  const state = ["online", "away"].includes(value) ? value : "offline";

  dom.set(status, "data-state", state);
  dom.remove(time, "data-i18n");
  if (blocked) {
    dom.set(time, "data-blocked", "");
    time.textContent = i18n.message("profile.blocked") || "";
    dom.set(time, "data-i18n", "profile.blocked");

    return;
  }

  dom.remove(time, "data-blocked");

  if (state === "offline") {
    time.textContent = relative(stamp);

    return;
  }

  const key = state === "online" ? "profile.active" : "profile.away";

  time.textContent = i18n.message(key);
  dom.set(time, "data-i18n", key);
};

const request = async (options) => {
  const id = options.own ? "me" : options.id;

  if (!id) {
    return null;
  }

  const result = await profile.read(id, { fresh: true });

  return result.ok ? result.data : null;
};

const tabs = (options) => {
  if (!Array.isArray(options.tabs) || !options.tabs.length) {
    return null;
  }

  const element = dom.create("div");

  element.className = "segment";
  options.tabs.forEach((tab, index) => {
    const button = dom.create("button");

    button.type = "button";
    dom.set(button, "data-background", "");

    button.textContent = i18n.message(tab);
    dom.set(button, "data-i18n", tab);

    if (!index) {
      dom.set(button, "data-selected", "");
    }

    element.append(button);
  });

  return element;
};

const content = (user, target, options, handlers) => {
  const root = dom.create("div");
  const head = dom.create("header");
  const picture = dom.create("div");
  const media = avatar("", "button");
  const status = dom.create("span");
  const name = dom.create("strong");
  const id = dom.create("span");
  const time = dom.create("time");

  root.className = "profile";
  head.className = "profile-head";
  picture.className = "profile-avatar";
  status.className = "profile-status";
  name.className = "profile-name";
  id.className = "profile-id";
  time.className = "profile-time";

  let admin;
  let context;
  let signature;
  let registered;
  let protectedMode = storage.get("profile-protect") !== "false";

  const tools = toolbar([
    {
      icon: "eye-off",
      text: "profile.protect",
      run: () => {
        if ((!user.manage && !user.self) || !user.details) return;

        protectedMode = !protectedMode;
        storage.set("profile-protect", protectedMode);
        protect();
      }
    }
  ]);

  dom.query("button", tools).className = "profile-protect";

  function protect() {
    const button = dom.query("button", tools);
    const label = dom.query("span", button);
    const key = protectedMode ? "profile.unprotect" : "profile.protect";

    if (admin) admin.hidden = protectedMode;

    if (registered) registered.hidden = protectedMode || !user.devices?.length;
    for (const history of dom.all(".profile-history", root))
      history.hidden = protectedMode || !user.manage;

    setState(
      status,
      time,
      options.session ? options.state || "offline" : user.state,
      user.time || options.time,
      user.manage && !protectedMode && user.blocked
    );

    tools.hidden = (!user.manage && !user.self) || !user.details;
    button.disabled = tools.hidden;
    dom.set(button, "data-protected", String(protectedMode));

    label.textContent = i18n.message(key);
    dom.set(label, "data-i18n", key);
  }

  dom.set(media.root, "data-response", "");

  const rename = () => {
    const label = names.label(user);
    const number = options.number;

    name.textContent = number ? `${label} (${number})` : label;
    names.mark(name, user.verified);
  };

  const render = (value) => {
    const changed =
      user.receiving?.message !== value.receiving?.message ||
      user.directBlocked !== value.directBlocked ||
      user.self !== value.self ||
      Boolean(user.manage && user.details) !== Boolean(value.manage && value.details);

    user = { ...value };

    if (options.session && user.details) {
      const session = user.details.sessions?.find((item) => item.session === options.session);

      user.details = {
        ...user.details,
        accessIp: session?.accessIp || "",
        os: session?.os || "",
        browser: session?.browser || ""
      };
    }

    time.hidden = user.self;
    media.set(user.avatar || options.avatar || "");
    rename();
    id.textContent = user.id?.slice(0, 8) || "";

    const next = JSON.stringify([
      user.receiving,
      user.state,
      user.self,
      user.manage,
      user.details,
      user.devices,
      user.blocked,
      user.block,
      user.sanction,
      Boolean(user.authority)
    ]);

    if (signature !== undefined && signature !== next) {
      const content = actions.manage(user, target, options, handlers, opening);

      if (admin) {
        if (content) admin.replaceWith(content);
        else admin.remove();
      } else if (content) head.after(content);

      admin = content;
      if (content) mount(content);

      if (context && changed) {
        const settings = {
          ...options,
          hidden: dom.query("input", context)?.checked ?? options.hidden
        };
        const next = actions.context(user, target, settings, handlers, opening);

        context.replaceWith(next);
        context = next;
        mount(context);
      }

      if (registered) {
        const next = devices(user.devices);

        registered.replaceWith(next);
        registered = next;
        mount(next);
      }

      i18n.translate();
    }

    signature = next;

    const whisper = dom.query("[data-whisper]", root);

    if (whisper) {
      whisper.hidden =
        !["online", "away"].includes(user.state) || user.receiving?.whisper === false;
    }

    protect();
  };

  render(user);
  dom.on(media.root, "click", () => {
    const source = user.image || user.avatar || options.image || options.avatar || "";

    viewer(source, media.root, "user").catch(() => {});
  });

  picture.append(media.root, status);
  head.append(picture, name, id, time);
  root.append(head);

  const own = user.self && user.verified ? editor(user) : null;

  if (own) {
    picture.replaceWith(own.picture);
    head.after(own.root);
  }

  const segment = tabs(options);

  admin = actions.manage(user, target, options, handlers, opening);

  if (segment) {
    root.append(segment);
  }

  if (admin) {
    root.append(admin);
  }

  if (options.context === "chatting") {
    context = actions.context(user, target, options, handlers, opening);
    root.append(context);
  }

  if (user.id) {
    profile.bind(root, user.id, render);
  }

  registered = devices(user.devices);
  root.append(registered);

  const member = actions.member(user, options.private ? options.room : "", handlers);

  root.append(member.root);
  protect();

  const off = dom.on(options.online, "online-update", () => {
    rename();
    protect();

    if (options.session) profile.refresh(user.id);
  });

  return {
    root,
    tools,
    own,
    off: () => {
      off();
      member.off();
      own?.destroy();
    }
  };
};

async function open(anchor, target, options) {
  const handlers = new Map();
  const result = await request(options);

  if (!result && options.restore) return false;
  const user = result ?? {
    id: options.id || "",
    name: options.name || "",
    image: options.image || "",
    avatar: options.avatar || "",
    self: Boolean(options.own),
    state: options.state || (options.online ? "online" : "offline"),
    time: options.time || "",
    manage: false
  };
  const view = content(user, target, options, handlers);

  let value;

  try {
    value = await popover({
      route: options.id ? ["profile", options.id] : undefined,
      anchor,
      back: true,
      direction: "?",
      scroll: 0,
      content: view.root,
      toolbar: view.tools,
      actions: view.own ? [view.own.action] : [],
      ready: view.own?.ready
    });
  } finally {
    view.off();
  }

  return handlers.get(value)?.();
}

export default function view(anchor, target, options) {
  const key = options.own ? "me" : options.id || anchor || target;

  return opening(key, () => open(anchor, target, options));
}
