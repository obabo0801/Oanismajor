import * as storage from "#common/storage";
import * as settings from "#common/settings";
import * as context from "#common/chatting/current";
import { events as path } from "../../../../lib/route.js";

import * as dom from "./dom.js";
import device from "./device.js";
import api from "./api.js";
import * as registry from "./chatting/registry.js";
import * as manage from "./chatting/manage.js";
import * as profile from "./profile.js";
import * as i18n from "./i18n.js";
import dialog from "./dialog.js";
import toast from "./toast.js";
import { plain } from "../../../../lib/mention.js";

i18n.preload(
  "chatting.kickTitle",
  "chatting.blockTitle",
  "chatting.kickDetail",
  "chatting.blockDetail",
  "chatting.reason",
  "chatting.handler",
  "dialog.confirm"
);

const standalone = matchMedia("(display-mode: standalone), (display-mode: minimal-ui)");

let source;
let value = false;
let stopped = false;
let session;
let tab;
let starting;
let release;
let initialized = false;
let paused = false;
let received = 0;
let attempted = 0;
let synced = 0;
let timer;

const stream = new EventTarget();
const types = [
  "public-room",
  "direct",
  "direct-read",
  "direct-remove",
  "direct-restore",
  "direct-change",
  "direct-state",
  "settings",
  "ready",
  "heartbeat",
  "role",
  "profile-update",
  "presence",
  "profile-image",
  "chatting",
  "chatting-remove",
  "chatting-restore",
  "chatting-attachment",
  "chatting-block",
  "chatting-unblock",
  "mute",
  "online",
  "block",
  "kick",
  "message"
];

const blocks = new Set();

const reserve = (id) =>
  new Promise((resolve) => {
    try {
      navigator.locks
        .request(`oanismajor-events:${id}`, { ifAvailable: true }, (lock) => {
          resolve(Boolean(lock));
          if (!lock) return;

          return new Promise((done) => {
            release = done;
          });
        })
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });

export const start = () => {
  starting ??= (async () => {
    if (initialized || typeof EventSource === "undefined") return initialized ? stream : undefined;

    if (!globalThis.crypto?.randomUUID) return events();
    let id = crypto.randomUUID();

    try {
      const saved = storage.get("tab", null, "session");

      if (/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(saved)) {
        id = saved;
      }
    } catch {}

    if (navigator.locks?.request) {
      if (!(await reserve(id))) {
        id = crypto.randomUUID();

        if (!(await reserve(id))) {
          id = crypto.randomUUID();
        }
      }
    }

    tab = id;

    try {
      storage.set("tab", tab, "session");
    } catch {}

    return events();
  })();

  return starting;
};

export const isAdmin = () => value;
export const isBlocked = (id) => blocks.has(id);

const data = (event) => {
  try {
    return JSON.parse(event.data);
  } catch {
    return {};
  }
};

const presence = (event) => {
  const value = data(event);

  profile.presence(value.id, value.state, value.connections);
};

let touched = 0;

const activity = (force = false, engaged = true) => {
  if (stopped || paused || !session) return;
  const now = Date.now();

  if (force !== true && now - touched < 30_000) {
    return;
  }

  touched = now;

  const current = source;
  const active = session;

  api(path, {
    method: "POST",
    data: { session: active, visible: !document.hidden, active: engaged },
    keepalive: true,
    signal: AbortSignal.timeout(10_000)
  }).then((result) => {
    if (current !== source || active !== session || stopped || paused) return;

    if (!result.ok) touched = 0;

    if (result.status === 409) check(true);
  });
};

const disconnect = () => {
  const current = source;
  const active = session;

  source = undefined;
  session = undefined;
  current?.close();

  if (active) {
    api(path, { method: "POST", data: { session: active, closed: true }, keepalive: true });
  }
};

const connect = () => {
  disconnect();

  const query = new URLSearchParams({ ...(tab && { tab }), wearable: String(device().wearable) });

  if (context.room) query.set("room", context.room);
  const current = new EventSource(`/api${path}?${query}`);

  source = current;
  attempted = received = Date.now();
  for (const type of types) {
    current.addEventListener(type, (event) => {
      if (source !== current || stopped || paused) return;

      received = Date.now();
      stream.dispatchEvent(
        new MessageEvent(type, {
          data: event.data,
          origin: event.origin,
          lastEventId: event.lastEventId
        })
      );
    });
  }

  current.addEventListener("error", () => {
    if (source !== current || stopped || paused) return;

    sync();
  });
};

function sync(force = false) {
  if (stopped || paused || document.hidden || navigator.onLine === false) return;
  const now = Date.now();

  if (force !== true && now - synced < 30_000) return;

  synced = now;
  stream.dispatchEvent(new Event("sync"));
}

function check(force = false) {
  if (stopped || paused || navigator.onLine === false) return;

  if (document.hidden && (navigator.standalone || standalone.matches)) return;

  sync(force === true);

  const now = Date.now();

  if (source && now - attempted < 5000) return;

  if (
    force === true ||
    !source ||
    source.readyState === EventSource.CLOSED ||
    now - received >= 75_000
  )
    connect();
}

export const suspend = () => {
  const active = session;

  paused = true;
  clearInterval(timer);
  disconnect();

  return active;
};

export const resume = () => {
  if (!initialized || stopped) return;

  paused = false;
  clearInterval(timer);
  timer = setInterval(check, 10_000);
  check(true);
};

const restrict = async (event) => {
  if (stopped) return;

  stopped = true;
  suspend();
  window.dispatchEvent(new Event("chatting-stop"));

  const details = data(event);
  const content = dom.create("div");
  const detail = dom.create("p");
  const reason = dom.create("p");
  const key = event.type === "block" ? "block" : "kick";

  content.className = "chatting-limit";
  detail.textContent = i18n
    .message(`chatting.${key}Detail`)
    .replace("{handler}", details.handler || i18n.message("chatting.handler"));

  reason.textContent = i18n.message("chatting.reason").replace("{reason}", details.reason || "-");

  content.append(detail, reason);

  const result = await dialog({
    title: `chatting.${key}Title`,
    content,
    direction: "→",
    locked: true,
    actions: [{ text: "dialog.confirm", icon: "check", value: true, data: ["data-confirm"] }]
  });

  if (result === true) location.replace("/");
};

const wake = () => {
  if (stopped || document.hidden) return;

  if (paused) resume();
  else check(true);

  activity(true, false);
};

const watch = () => {
  dom.on(window, "pagehide", (event) => {
    suspend();

    if (!event.persisted) release?.();
  });

  dom.on(window, "pageshow", wake);
  dom.on(document, "freeze", suspend);
  dom.on(document, "resume", wake);
  dom.on(window, "offline", disconnect);
  dom.on(window, "online", wake);
  dom.on(window, "focus", wake);
  dom.on(document, "pointerdown", activity, true);
  dom.on(document, "keydown", activity, true);
  dom.on(document, "scroll", activity, true);

  dom.on(document, "visibilitychange", () => {
    if (document.hidden && (navigator.standalone || standalone.matches)) {
      suspend();

      return;
    }

    if (document.visibilityState === "visible") wake();
    else activity(true, false);
  });
};

const removed = (event) => {
  manage.remove(data(event));
};

const blocked = (event) => {
  const { id } = data(event);

  if (!id) {
    return;
  }

  blocks.add(id);
  registry.messageAll(id).forEach((element) => {
    if (isAdmin()) {
      dom.set(element, "data-blocked", "");
    } else {
      element.remove();
    }
  });
};

export default function events() {
  if (initialized || typeof EventSource === "undefined") {
    return initialized ? stream : undefined;
  }

  initialized = true;
  watch();
  tab ||= globalThis.crypto?.randomUUID?.();

  stream.addEventListener("ready", (event) => {
    settings.load();

    const payload = data(event);
    const next = payload.admin === true;

    session = payload.session;
    touched = 0;
    activity(true);

    const previous = value;

    value = next;
    if (previous !== value) profile.reset();
  });

  stream.addEventListener("role", (event) => {
    const next = data(event).admin === true;

    value = next;
    profile.reset();
  });

  stream.addEventListener("profile-update", (event) => {
    const { id } = data(event);

    if (id) profile.refresh(id);
  });

  stream.addEventListener("chatting-unblock", (event) => {
    const { id } = data(event);

    blocks.delete(id);
    registry.messageAll(id).forEach((element) => dom.remove(element, "data-blocked"));
  });

  stream.addEventListener("presence", presence);
  stream.addEventListener("heartbeat", () => activity(false, false));
  stream.addEventListener("chatting", (event) => {
    const item = data(event);

    if (
      (context.muted && item.room === context.room) ||
      !settings.allows(item.mentioned) ||
      item.own ||
      item.blocked ||
      document.hidden ||
      blocks.has(item.id) ||
      !item.url ||
      typeof item.text !== "string"
    )
      return;

    toast({
      type: "notify",
      id: `mention:${item.url}`,
      title: item.name,
      text: plain(item.text),
      image: item.image,
      attachments: item.attachments,
      audio: item.audio,
      url: `/rooms/${item.room}?message=${encodeURIComponent(item.url)}`
    });
  });

  stream.addEventListener("chatting-remove", removed);
  stream.addEventListener("chatting-attachment", (event) => manage.receive(data(event)));
  stream.addEventListener("chatting-restore", (event) => {
    const item = data(event);

    if (!item.url) return;

    registry.storedAll(item.url).forEach((element) => {
      element.dispatchEvent(
        new CustomEvent("chatting-change", {
          detail: { ...item, deleted: false, retained: false, restorable: false }
        })
      );
    });
  });

  stream.addEventListener("settings", (event) => settings.receive(data(event)));
  stream.addEventListener("profile-image", (event) => {
    profile.receiveLink(data(event).token);
  });

  stream.addEventListener("chatting-block", blocked);
  stream.addEventListener("block", restrict);
  stream.addEventListener("kick", restrict);

  resume();

  return stream;
}
