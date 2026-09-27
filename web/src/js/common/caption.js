import * as dom from "./dom.js";
import * as css from "./css.js";
import * as i18n from "./i18n.js";
import * as emoji from "./emoji.js";
import * as link from "./link.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const entries = new Map();
const targets = new WeakMap();

let wrap;
let stack;
let frame;
let off = [];

const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { text: value == null ? "" : String(value) };

const node = (tag, name) => {
  const element = dom.create(tag);

  element.className = name;

  return element;
};

const color = (value) => (typeof value === "string" && CSS.supports("color", value) ? value : null);

const sync = (element) => {
  const name = dom.query(":scope > .caption-name", element);
  const present = Boolean(name?.textContent.trim() || name?.querySelector("img"));

  element.toggleAttribute("data-name", present);

  if (name) name.hidden = !present;
};

const render = (element, value) => {
  element.replaceChildren();
  if (element.matches("a")) emoji.render(element, value);
  else link.render(element, value, targets.get(element));

  const root = element.closest(".caption");

  if (root) sync(root);
};

i18n.register("data-caption-key", render);

const place = (latest = false) => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = undefined;

    if (!stack?.isConnected) return;

    const view = window.visualViewport;
    const width = view?.width ?? window.innerWidth;
    const height = view?.height ?? window.innerHeight;

    css.set(stack, {
      "--caption-x": `${(view?.offsetLeft ?? 0) + width / 2}px`,
      "--caption-y": `${(view?.offsetTop ?? 0) + height}px`,
      "--caption-width": `${width}px`,
      "--caption-height": `${height}px`
    });

    if (latest === true) stack.scrollTop = stack.scrollHeight;
  });
};

export function raise() {
  if (!stack || !wrap) return;

  const target = dom.all("dialog:modal").at(-1) || document.fullscreenElement || dom.body;

  const focus = stack.contains(document.activeElement) ? document.activeElement : null;

  if (typeof stack.hidePopover === "function" && stack.matches(":popover-open")) {
    stack.hidePopover();
  }

  if (wrap.parentElement !== target) target.append(wrap);

  if (typeof stack.showPopover === "function") stack.showPopover();

  if (focus?.isConnected) focus.focus({ preventScroll: true });

  place();
}

export function clear(smooth = true) {
  return Promise.all([...entries.values()].map((close) => close(smooth)));
}

const host = () => {
  if (!stack?.isConnected) {
    wrap = dom.create("div");
    stack = node("div", "captions");

    if (typeof stack.showPopover === "function") {
      dom.set(stack, "popover", "manual");
    }

    wrap.append(stack);
    dom.body.append(wrap);

    for (const target of [window, window.visualViewport]) {
      off.push(dom.on(target, "resize", place, { passive: true }));
      off.push(dom.on(target, "scroll", place, { passive: true }));
    }

    off.push(dom.on(document, "fullscreenchange", raise));
    off.push(dom.on(window, "pagehide", () => clear(false)));
  }

  raise();

  return stack;
};

const clean = (element) => {
  for (const item of dom.find("[data-css]", element)) css.remove(item);

  element.remove();
  entries.delete(element);

  if (entries.size || !stack) return;

  if (typeof stack.hidePopover === "function") {
    if (stack.matches(":popover-open")) stack.hidePopover();
  }

  off.forEach((remove) => remove());
  off = [];
  cancelAnimationFrame(frame);
  frame = undefined;
  css.remove(stack);
  stack.remove();
  wrap?.remove();
  stack = undefined;
  wrap = undefined;
};

const image = (value, alt = "", inline = false) => {
  const item = object(typeof value === "string" ? { src: value, alt } : value);
  const element = node("img", inline ? "caption-emoji" : "caption-image");
  const still = reduce.matches || dom.has("wearable");
  const source = (still && item.still) || item.src;

  let url;

  try {
    url = new URL(String(source || ""), location.href);
  } catch {
    return null;
  }

  if (!source || !["http:", "https:", "blob:"].includes(url.protocol)) {
    return null;
  }

  element.alt = String(item.alt ?? alt);
  element.draggable = false;
  element.referrerPolicy = "no-referrer";
  dom.on(
    element,
    "error",
    () => {
      const root = element.closest(".caption");

      element.replaceWith(element.alt);

      if (root) sync(root);
    },
    { once: true }
  );

  element.src = url.href;

  return element;
};

const content = (target, value) => {
  const options = object(value);
  const parts = Array.isArray(options.parts) ? options.parts : [options];

  let pending = false;

  for (const part of parts) {
    const item = object(part);
    const href = link.resolve(item.url);
    const element = node(href ? "a" : "span", "caption-part");
    const key = typeof item.key === "string" ? item.key.trim() : "";
    const text = key ? i18n.message(key) : String(item.text ?? href);

    const mode = item.target ?? options.target;

    targets.set(element, { target: mode });
    if (href) {
      link.bind(element, { url: href, target: mode, name: text, run: item.run ?? options.run });
    }

    if (key) {
      dom.set(element, "data-caption-key", key);
      pending ||= !text;
    }

    const bold = item.bold ?? options.bold;

    if (color(item.color) || typeof bold === "boolean") {
      css.set(element, {
        color: color(item.color),
        "font-weight": typeof bold === "boolean" ? (bold ? 700 : 400) : null
      });
    }

    render(element, text);
    target.append(element);

    if (item.image && item !== options) {
      const picture = image(item.image, item.alt, true);

      if (picture) target.append(picture);
    }
  }

  if (options.image) {
    const picture = image(options.image, options.alt);

    if (picture) target.append(picture);
  }

  return pending;
};

export const bind = (media, text, cues = []) => {
  let current;
  let frame;

  const tokens = Array.isArray(cues)
    ? cues.filter(
        (item) =>
          typeof item.text === "string" && Number.isFinite(item.start) && Number.isFinite(item.end)
      )
    : [];
  const words = [];

  if (tokens.some((item) => item.text.includes("▁"))) {
    for (const token of tokens) {
      const parts = token.text.split("▁");

      for (const [index, part] of parts.entries()) {
        if (!index && !part) continue;

        if (index || !words.length) words.push({ ...token, text: "" });
        const word = words.at(-1);

        word.text += part;
        word.end = token.end;
      }
    }
  } else words.push(...tokens);

  const close = () => {
    cancelAnimationFrame(frame);
    current?.close();
    current = undefined;
  };

  const open = () => {
    cancelAnimationFrame(frame);

    let value = text;

    if (words.length) {
      const time = media.currentTime;
      const visible = words.filter((word) => word.start <= time);

      value = visible
        .slice(-12)
        .map((word) => {
          const letters = Array.from(word.text);
          const fraction =
            word.end > word.start ? (time - word.start) / (word.end - word.start) : 1;

          return letters
            .slice(0, Math.max(0, Math.ceil(letters.length * Math.min(1, fraction))))
            .join("");
        })
        .join(" ");
    }

    if (value?.trim()) {
      if (!current) current = caption({ text: value, duration: 0 });
      else current.element.querySelector(".caption-text").textContent = value;
    } else if (current) {
      current.close(false);
      current = undefined;
    }

    if (words.length && !media.paused && !media.ended) frame = requestAnimationFrame(open);
  };

  const off = [
    dom.on(media, "playing", open),
    dom.on(media, "seeked", () => {
      if (!media.paused) open();
    }),
    ...["pause", "ended", "error", "emptied"].map((event) => dom.on(media, event, close))
  ];

  if (!media.paused && !media.ended) open();

  return () => {
    off.forEach((remove) => remove());
    close();
  };
};

export default function caption(value = {}) {
  const options = object(value);
  const element = node("section", "caption");
  const body = node("div", "caption-text");
  const name = object(options.name);
  const label = node("div", "caption-name");
  const time = Number(options.duration ?? 5000);
  const duration = Number.isFinite(time) && time >= 0 ? time : 5000;

  let pending = content(body, options);
  let timer;
  let motion;
  let closing;
  let closed = false;

  pending = content(label, name) || pending;
  element.append(label, body);
  element.hidden = true;
  element.toggleAttribute("data-fade", options.fade === true);

  css.set(element, {
    "--caption-background": color(options.background),
    "--caption-color": color(options.color)
  });

  css.set(label, { "background-color": color(name.background), color: color(name.color) });

  const close = (smooth = true) => {
    if (closing) return closing;

    closed = true;
    clearTimeout(timer);

    const opacity = getComputedStyle(element).opacity;

    motion?.cancel();

    const fade = smooth && !reduce.matches && !element.hidden;

    motion = fade
      ? element.animate({ opacity: [opacity, 0] }, { duration: 160, fill: "both" })
      : null;

    closing = Promise.resolve(motion?.finished)
      .catch(() => {})
      .then(() => {
        motion?.cancel();
        clean(element);
      });

    return closing;
  };

  entries.set(element, close);
  host().append(element);
  sync(element);

  const show = () => {
    if (closed) return false;

    sync(element);

    if (!body.textContent.trim() && !body.querySelector("img")) {
      close(false);

      return false;
    }

    element.hidden = false;

    if (!reduce.matches) {
      motion = element.animate({ opacity: [0, 1] }, { duration: 160 });
    }

    if (Number.isFinite(duration) && duration > 0) {
      timer = setTimeout(close, Math.min(duration, 2147483647));
    }

    place(true);

    return true;
  };

  const ready = pending
    ? i18n
        .translate()
        .catch(() => false)
        .then(show)
    : Promise.resolve(show());

  return { element, ready, close };
}
