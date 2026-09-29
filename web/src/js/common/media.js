import * as dom from "./dom.js";
import * as audio from "./audio.js";
import * as storage from "./storage.js";
import * as tooltip from "./tooltip.js";
import * as i18n from "./i18n.js";

const playing = new Set();
const sources = new WeakMap();
const gains = new Map();
const shortcuts = new Map();
const revealed = new Set();
const covers = new Set();

export function spoiler(root, source, value) {
  const url = new URL(source, location.href);
  const key = `${url.origin}${url.pathname}`;

  root.dataset.spoilerSource = key;
  if (!value) revealed.add(key);
  const targets = value
    ? [root]
    : [...document.querySelectorAll("[data-spoiler-source]")].filter(
        (element) => element.dataset.spoilerSource === key
      );

  for (const target of new Set([root, ...targets])) {
    const hidden = Boolean(value) && !revealed.has(key);

    target.toggleAttribute("data-spoiler", hidden);
    target.querySelector(".chatting-spoiler")?.remove();
    if (!hidden) continue;
    const hint = dom.create("span");

    hint.className = "chatting-spoiler";
    dom.set(hint, "data-i18n", "chatting.attach.reveal");
    hint.textContent = i18n.message("chatting.attach.reveal");
    target.append(hint);
  }
}

let focused;

export const editing = (event) =>
  event.defaultPrevented ||
  event.isComposing ||
  event.ctrlKey ||
  event.altKey ||
  event.metaKey ||
  event.target.closest?.(
    "input, textarea, select, [contenteditable]:not([contenteditable='false'])"
  );

export function keys(root, run) {
  shortcuts.set(root, run);

  const remove = dom.on(root, "pointerdown", () => {
    focused = root;
  });

  return () => {
    remove();
    shortcuts.delete(root);
    if (focused === root) focused = null;
  };
}

dom.on(document, "keydown", (event) => {
  if (editing(event)) return;
  const modal = [...document.querySelectorAll("dialog[open]")].at(-1);
  const key = event.key.toLowerCase();

  if (key === "c") {
    const editor = [...(modal || document).querySelectorAll(".chatting-editor")].find(
      (element) =>
        element.isContentEditable && element.getClientRects().length && !element.closest("[inert]")
    );

    if (editor) {
      event.preventDefault();
      editor.focus();
    }
    return;
  }

  if (event.repeat && ["f", "k", " ", "m", "j", "l"].includes(key)) return;
  const roots = [...shortcuts.keys()].filter(
    (root) =>
      root.isConnected &&
      root.closest("dialog[open]") === (modal || null) &&
      !root.closest("[inert]") &&
      root.getClientRects().length
  );

  const root =
    roots.find((root) => root.contains(document.activeElement)) ||
    (roots.includes(focused) ? focused : null) ||
    roots.find((root) => [...root.querySelectorAll("audio, video")].some((item) => !item.paused)) ||
    (modal ? roots.at(-1) : null);

  if (root && shortcuts.get(root)(key) !== false) event.preventDefault();
});

export function volume(element, button, levels) {
  const input = levels.querySelector("input");
  const key = dom.get(button, "data-tooltip") || "player.volume";
  const text = () => `${element.muted ? 0 : Math.round(element.volume * 100)}%`;
  const show = () => {
    dom.set(input, "data-tooltip", text());
    if (!levels.hidden) tooltip.flash(input, text());
  };

  const close = () => {
    levels.hidden = true;
    tooltip.hide(input);
    dom.set(button, "data-tooltip", key);
    dom.set(button, "aria-expanded", "false");
  };

  const outside = (event) => {
    if (!levels.hidden && !levels.contains(event.target) && !button.contains(event.target)) close();
  };

  const off = [
    dom.on(button, "click", () => {
      if (!levels.hidden) return close();

      levels.hidden = false;
      tooltip.hide(button);
      dom.remove(button, "data-tooltip");
      dom.set(button, "aria-expanded", "true");
      show();
    }),
    dom.on(button, "pointerover", (event) => {
      if (event.pointerType === "mouse" && !button.contains(event.relatedTarget)) show();
    }),
    dom.on(button, "focus", show),
    dom.on(levels, "input", show),
    dom.on(element, "volumechange", show),
    dom.on(document, "pointerdown", outside, true),
    dom.on(document, "focusin", outside),
    dom.on(window, "blur", close)
  ];

  dom.set(button, "aria-expanded", "false");
  dom.set(input, "data-tooltip", text());
  return () => {
    off.forEach((remove) => remove());
    close();
    dom.remove(button, "aria-expanded");
    dom.remove(input, "data-tooltip");
  };
}

export function command(element, key) {
  if (key === "m") {
    const muted = !element.muted && element.volume > 0;

    if (!muted && element.volume === 0) element.volume = 1;

    element.muted = muted;
  } else if (["arrowup", "arrowdown"].includes(key)) {
    element.volume = Math.max(0, Math.min(1, element.volume + (key === "arrowup" ? 0.05 : -0.05)));
    element.muted = element.volume === 0;
  } else if (["arrowleft", "arrowright", "home", "end"].includes(key)) {
    if (!Number.isFinite(element.duration)) return false;

    element.currentTime =
      key === "home"
        ? 0
        : key === "end"
          ? element.duration
          : Math.max(
              0,
              Math.min(element.duration, element.currentTime + (key === "arrowleft" ? -5 : 5))
            );
  } else return false;

  if (["m", "arrowup", "arrowdown"].includes(key)) {
    const root = element.closest(".player, .video-thumbnail");
    const button = root?.querySelector(".player-volume") || root?.querySelector(".player-control");
    const value = element.muted ? 0 : Math.round(element.volume * 100);

    const input = root?.querySelector(".player-level:not([hidden]) input");

    tooltip.flash(input || button, `${value}%`);
  }
  return true;
}

export const move = (element, parent, before = null) => {
  const playback = element.matches("audio, video")
    ? element
    : element.querySelector("audio, video");
  const active = playback && !playback.paused;

  if (parent.moveBefore && parent.isConnected && element.isConnected)
    parent.moveBefore(element, before);
  else {
    parent.insertBefore(element, before);
    if (active) playback.play().catch(() => {});
  }
};

export const find = (source, kind, message = "") => {
  const url = new URL(source, location.href);
  const matches = [...document.querySelectorAll(kind)].filter((element) => {
    if (!element.src) return false;

    if (message && element.dataset.message !== message) return false;

    if (kind === "video" && !element.closest(".video-thumbnail")?.querySelector(".video-surface"))
      return false;
    const current = new URL(element.src, location.href);

    return current.origin === url.origin && current.pathname === url.pathname;
  });

  return (
    matches.find((element) => !element.paused) ||
    matches.find((element) => element.currentTime > 0) ||
    matches[0]
  );
};

export function borrow(target, parent) {
  const home = target.parentElement;
  const marker = document.createComment("");

  target.before(marker);
  move(target, parent);
  return () => {
    if (marker.isConnected) move(target, home, marker);
    else target.querySelector("audio, video")?.pause();

    marker.remove();
  };
}

export const sync = () => {
  for (const [element, gain] of gains)
    gain.gain.value =
      storage.get("sound", "true") === "false"
        ? 0
        : audio.level(element.dataset.channel === "tts" ? "tts" : "media");
};

export function activate(element) {
  const context = audio.context();

  if (context && !gains.has(element)) {
    const source = sources.get(element) || context.createMediaElementSource(element);
    const gain = context.createGain();

    sources.set(element, source);
    source.connect(gain);
    gain.connect(context.destination);
    gains.set(element, gain);
  }

  sync();
  for (const other of playing) if (other !== element) other.pause();
  if (element.tagName === "VIDEO" && navigator.mediaSession) navigator.mediaSession.metadata = null;

  playing.add(element);
}

export async function resolve(value, kind, signal) {
  const source = new URL(value, location.href);

  if (
    source.origin !== location.origin ||
    !/^\/[a-f0-9]{8}\/[a-f0-9]{32}\.bin$/.test(source.pathname)
  )
    return;

  if (kind === "cover" && covers.has(source.pathname)) return;

  source.searchParams.delete("play");
  source.searchParams.set("convert", kind);
  try {
    for (let attempt = 0; attempt < 610; attempt++) {
      if (signal.aborted) return;
      const response = await fetch(source, { signal, cache: "no-store" });

      if (response.status === 200) {
        if (!response.headers.get("content-type")?.includes("application/json")) {
          await response.body?.cancel();
          return;
        }

        const result = await response.json();

        if (!result.ready) {
          if (kind === "cover" && result.empty === true) {
            covers.add(source.pathname);
            if (covers.size > 256) covers.delete(covers.values().next().value);
          }
          return;
        }

        source.searchParams.delete("convert");
        source.searchParams.set("play", kind);
        if (kind === "video") {
          if (typeof result.version !== "string" || !result.version) return;

          source.searchParams.set("v", result.version);
        }
        return source.href;
      }

      if (response.status !== 202 && response.status !== 503) return;

      await new Promise((resolve) => {
        let timer;

        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };

        timer = setTimeout(finish, 2000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  } catch {}
}

export default function media(element) {
  let attempted = false;

  const play = dom.on(element, "play", () => activate(element));
  const pause = dom.on(element, "pause", () => playing.delete(element));
  const ended = dom.on(element, "ended", () => playing.delete(element));

  const controller = new AbortController();
  const remove = dom.on(element, "error", async () => {
    if (attempted || ![3, 4].includes(element.error?.code)) return;

    attempted = true;

    const position = Number.isFinite(element.currentTime) ? element.currentTime : 0;
    const active = !element.paused;
    const rate = element.playbackRate;

    element.setAttribute("data-converting", "");
    element.dispatchEvent(new Event("conversion"));

    const source = await resolve(
      element.currentSrc || element.src,
      element.tagName === "VIDEO" ? "video" : "audio",
      controller.signal
    );

    if (source && !controller.signal.aborted) {
      const restore = () => {
        if (controller.signal.aborted || element.src !== source) return;

        if (Number.isFinite(element.duration) && element.duration > 0)
          element.currentTime = Math.min(position, Math.max(0, element.duration - 0.01));

        element.playbackRate = rate;
        if (active && ![...playing].some((other) => other !== element && !other.paused))
          element.play().catch(() => {});
      };

      element.addEventListener("loadedmetadata", restore, {
        once: true,
        signal: controller.signal
      });

      element.src = source;
      element.load();
    }

    element.removeAttribute("data-converting");
    element.dispatchEvent(new Event("conversion"));
  });

  if (element.error) element.dispatchEvent(new Event("error"));
  return () => {
    play();
    pause();
    ended();
    playing.delete(element);
    sources.get(element)?.disconnect();
    gains.get(element)?.disconnect();
    gains.delete(element);
    controller.abort();
    remove();
  };
}
