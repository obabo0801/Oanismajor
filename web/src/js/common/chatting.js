import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as link from "#common/link";
import * as embed from "#common/embed";
import editor, { enter, controls } from "#common/chatting/input";
import * as css from "#common/css";
import action from "#common/chatting/action";
import profile from "#common/chatting/profile";
import * as registry from "#common/chatting/registry";
import * as clock from "#common/chatting/time";
import * as events from "#common/events";
import listen from "#common/chatting/voice";
import media from "#common/chatting/media";
import * as assets from "#common/chatting/asset";
import { notices } from "#shared/chatting";

i18n.preload("chatting.tools.image", "chatting.voice", "chatting.send", "chatting.emoji.clear");

const bound = new WeakSet();
const observers = new WeakMap();
const records = new WeakMap();
const duration = 30 * 60 * 1000;

const fit = (root) => {
  if (dom.get(root, "data-chatting") !== "stream") return;

  const unit = Number.parseFloat(getComputedStyle(dom.root).fontSize);

  dom.all(".chatting-name", root).forEach((name) => {
    css.set(name, { "--name-size": null });

    if (name.scrollWidth <= name.clientWidth + 1) return;

    const base = Number.parseFloat(getComputedStyle(name).fontSize);

    let size = base;

    while (size > 14 && name.scrollWidth > name.clientWidth + 1) {
      size -= 0.5;
      css.set(name, { "--name-size": `${size / unit}rem` });
    }
  });
};

export const bottom = (list) => list.scrollHeight - list.scrollTop - list.clientHeight < 24;

export const place = (list, node, end = null) => {
  const current = records.get(node)?.current;
  const later = [...list.children].find(
    (item) => item !== node && records.get(item)?.current > current
  );

  list.insertBefore(node, later || end);
};

const refresh = (list) => {
  const root = list.closest(".chatting");
  const button = dom.query(".chatting-bottom", root);

  if (button) {
    button.hidden = bottom(list) && dom.get(root, "data-history") !== "true";
  }
};

const group = (previous, options, current) => {
  const id = options.system ? "" : options.own ? "own" : options.id ? `id:${options.id}` : "";
  const date = clock.day(current);
  const passed = current - (previous?.start ?? current);
  const follow = Boolean(
    id &&
    previous?.id === id &&
    previous.date === date &&
    previous.private === Boolean(options.private) &&
    previous.peer === options.peer &&
    passed >= 0 &&
    passed < duration
  );

  return {
    id,
    date,
    private: Boolean(options.private),
    peer: options.peer,
    start: follow ? previous.start : current,
    follow
  };
};

const follow = (list, options, current, existing) => {
  let previous;

  for (const node of list.children) {
    if (node === existing) break;

    if (node.hidden) continue;

    const item = records.get(node);

    if (item) previous = group(previous, item.options, item.current);
    else if (previous && node.matches(".chatting-system, .chatting-new")) previous.id = null;
  }

  return group(previous, options, current).follow;
};

const setup = (root, list, form) => {
  const button = dom.create("button");

  button.type = "button";
  button.className = "chatting-bottom";

  dom.set(button, "data-background", "");
  dom.set(button, "data-shadow", "");
  dom.set(button, "data-icon", "arrow");
  dom.set(button, "data-circle", "");
  dom.set(button, "data-scale", "");
  dom.set(button, "data-response", "down");
  dom.set(button, "data-angle", "bottom");

  dom.on(button, "click", () => {
    root.dispatchEvent(new CustomEvent("chatting-latest"));
    list.scrollTo({
      top: list.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
    });
  });

  dom.on(list, "scroll", () => refresh(list));

  const place = () => {
    css.set(root, { "--chatting-form": `${form.offsetHeight}px` });
  };

  place();

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      place();
      fit(root);
    });

    observer.observe(form);
    observer.observe(root);
    observers.set(root, observer);
  }

  root.append(button);
  refresh(list);
};

export const regroup = (list) => {
  const dates = new Set();

  let previous;

  for (const node of [...list.children]) {
    if (node.matches(".chatting-system, .chatting-new") && !records.has(node)) {
      if (previous && !node.hidden) previous.id = null;
      continue;
    }

    const item = records.get(node);

    if (!item) continue;

    if (node.hidden) {
      item.separator?.remove();
      item.separator = null;
      continue;
    }

    const current = group(previous, item.options, item.current);
    const date = current.date;
    const sameDay = previous?.date === date;

    node.toggleAttribute("data-follow", current.follow);

    if (!sameDay) {
      if (!item.separator) {
        item.separator = dom.create("time");
        item.separator.className = "chatting-date";
        item.separator.dateTime = date;
        item.separator.textContent = clock.label(item.current);
      }

      list.insertBefore(item.separator, node);
      dates.add(item.separator);
    } else {
      item.separator?.remove();
      item.separator = null;
    }

    previous = current;
  }

  dom.all(".chatting-date", list).forEach((node) => {
    if (!dates.has(node)) node.remove();
  });
};

const bind = (element) => {
  if (bound.has(element)) {
    return;
  }

  const form = dom.query(".chatting-form", element);
  const list = dom.query(".chatting-list", element);
  const input = dom.query(".chatting-input", form);
  const action = dom.query(".chatting-voice", form);
  const send = dom.query(".chatting-send", form);

  if (!form || !list || !input || !send) {
    return;
  }

  setup(element, list, form);

  const field = editor(input);

  controls(input, input.closest(".input"), send);

  dom.on(list, "chatting-regroup", () => regroup(list));

  dom.on(field, "keydown", (event) => {
    if (event.defaultPrevented || !enter(event)) {
      return;
    }

    event.preventDefault();

    if (dom.has("wearable")) {
      return;
    }

    if (!send.hidden) {
      send.click();
    }
  });

  dom.on(action, "click", () => listen(input, action));

  bound.add(element);
};

export const append = (target, options = {}, scroll = true, existing = null) => {
  if (options.system) {
    const notice = notices[options.system];

    if (!notice || (notice.admin && !events.isAdmin())) return null;

    return system(target, { ...options, ...notice, params: options, scroll });
  }

  const list = target?.matches?.(".chatting-list") ? target : dom.query(".chatting-list", target);

  if (
    !list ||
    (!options.text && !options.image && !options.audio && !options.attachments?.length)
  ) {
    return null;
  }

  const stick = bottom(list);
  const current = clock.stamp(options.time);
  const message = existing || dom.create("article");
  const user = dom.query(".chatting-profile", message) || profile(message, options);
  const previous = records.get(message)?.options;
  const keep =
    existing &&
    previous?.pending &&
    !message.hasAttribute("data-failed") &&
    !options.deleted &&
    previous.text === options.text &&
    !options.image &&
    !options.audio &&
    !options.attachments?.length &&
    !previous.attachments?.length;
  const text = (keep && dom.query(".chatting-text", message)) || dom.create("p");
  const time = (keep && dom.query(".chatting-time", message)) || dom.create("time");
  const mode = dom.get(list.closest(".chatting"), "data-chatting");

  message.className = "chatting-message";
  message.toggleAttribute("data-follow", follow(list, options, current, existing));
  text.className = "chatting-text";
  time.className = "chatting-time";

  if (mode === "messenger") {
    dom.set(text, "data-shadow", "");
  }

  if (!keep) {
    link.render(text, options.text);
    if (!options.deleted) embed.append(text, options.text);
  }

  if (options.audio) {
    const audio = dom.create("audio");
    const wrapper = dom.create("span");

    wrapper.className = "chatting-audio";
    audio.controls = true;
    audio.setAttribute("data-stt", "");
    audio.preload = "none";
    audio.src = options.audio;
    audio.dataset.caption = options.text || "";
    audio.dataset.message = options.url || options.token || "";
    if (options.private || mode === "messenger") audio.dataset.room = options.room || "";

    wrapper.append(audio);
    text.append(wrapper);
    assets.bind(wrapper, {
      kind: "audio",
      url: options.audio,
      name: i18n.message("chatting.voice"),
      sender: options,
      time: options.time,
      open: () => wrapper.querySelector(".player-control")?.click()
    });
  }

  if (!keep) media(text, options);

  time.textContent = clock.format(current);
  time.dateTime = new Date(current).toISOString();
  time.title = clock.detail(current);

  if (options.mentioned) dom.set(message, "data-mentioned", "");

  if (options.own) {
    dom.set(message, "data-own", "");

    if (mode === "messenger") {
      dom.set(text, "data-background", "");
    }
  }

  if (options.deleted) {
    dom.set(message, "data-deleted", "");
    if (options.restorable || options.retained) dom.set(message, "data-retained", "");
  }

  if (options.url && !options.private) {
    registry.storedMessage(message, options.url);
  }

  if (options.id) {
    registry.message(message, options.id);

    if (options.blocked ?? events.isBlocked(options.id)) {
      if (options.blocked === undefined && !events.isAdmin()) {
        return null;
      }

      dom.set(message, "data-blocked", "");
    }
  }

  if (!keep) message.replaceChildren(user, text);

  if (time.textContent && !keep) {
    message.append(time);
  }

  if (
    (!options.deleted || options.restorable || options.retained) &&
    (!options.private || options.evidence || options.kind === "message") &&
    !options.pending
  ) {
    action(message, options);
  }

  records.set(message, { ...records.get(message), options, current });

  if (!existing) list.append(message);

  requestAnimationFrame(() => fit(list.closest(".chatting")));

  if (scroll && (stick || options.own)) {
    list.scrollTop = list.scrollHeight;
  }

  requestAnimationFrame(() => refresh(list));

  return message;
};

export function system(target, options = {}) {
  const list = target?.matches?.(".chatting-list") ? target : dom.query(".chatting-list", target);

  if (!list || !options.text) return null;
  const stick = options.scroll === true || (options.scroll !== false && bottom(list));
  const node = dom.create("p");
  const types = ["text", "mute", "info", "success", "warning", "error"];

  node.className = "chatting-system";
  dom.set(node, "data-type", types.includes(options.type) ? options.type : "text");

  if (options.bold) dom.set(node, "data-bold", "");

  node.textContent = (i18n.message(options.text) || options.text).replace(
    /\{(\w+)\}/g,
    (match, key) => String(options.params?.[key] ?? match)
  );

  const last = list.lastElementChild;

  list.insertBefore(node, last?.matches(".chatting-page") ? last : null);
  if (options.time) records.set(node, { options, current: clock.stamp(options.time) });

  if (stick) list.scrollTop = list.scrollHeight;

  refresh(list);

  return node;
}

export default function chatting(root = document) {
  dom.find(".chatting", root).forEach(bind);
}
