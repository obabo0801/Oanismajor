import avatar from "#common/avatar";
import * as identity from "#common/profile/name";
import * as profile from "#common/profile";
import * as i18n from "#common/i18n";
import * as dom from "#common/dom";
import * as emoji from "#common/emoji";
import * as input from "#common/input";
import * as recent from "#common/chatting/recent";
import api from "#common/api";
import * as css from "#common/css";
import progress from "#common/progress";
import { basic } from "#shared/emoji";
import * as catalog from "#common/chatting/catalog";
import * as mention from "#shared/mention";
import { chatting } from "#shared/route";

const names = new Map(basic);
const groups = [
  ...catalog.unicode.map((group) => ({ ...group, type: "emoji" })),
  ...catalog.kaomoji.map((group) => ({ ...group, type: "kaomoji" }))
];

i18n.preload(
  "chatting.emoji.emoji",
  "chatting.emoji.kaomoji",
  ...groups.map((group) => group.title)
);

const text = () =>
  Array.from({ length: Math.max(...groups.map((group) => group.items.length)) }, (_, index) =>
    groups.flatMap((group) => {
      const value = group.items[index];

      if (!value) return [];
      const title = i18n.message(group.title);
      const label = names.get(value) || title;
      const kind = i18n.message(`chatting.emoji.${group.type}`);

      return [{ value, label, type: group.type, search: `${label} ${title} ${kind} ${value}` }];
    })
  ).flat();

export default function suggest(field, view) {
  const list = dom.create("div");
  const host = view.closest(".chatting") || view.parentElement;
  const off = [];
  const options = dom.create("div");
  const position = progress({ show: false });

  let items = [];
  let selected = 0;
  let current;
  let version = 0;
  let composing = false;
  let request;
  let frame;

  list.className = "input-suggestions";
  list.hidden = true;
  options.className = "input-options";
  list.append(options, position.element);

  const scroll = () => {
    if (options.scrollHeight - options.clientHeight - options.scrollTop < 80) append();
    const range = options.scrollHeight - options.clientHeight;

    position.element.hidden = range <= 1;
    position.set(range > 0 ? (options.scrollTop / range) * 100 : 0);
  };

  const fit = () => {
    if (list.hidden) return;
    const viewport = window.visualViewport;
    const box = host.getBoundingClientRect();
    const anchor = view.parentElement.getBoundingClientRect();
    const top = Math.max(viewport?.offsetTop || 0, box.top);
    const bottom = Math.min(
      anchor.top,
      (viewport?.offsetTop || 0) + (viewport?.height || innerHeight)
    );
    const height = Math.max(0, bottom - top - 12);

    css.set(list, {
      "--suggest-height": `${Math.floor(height)}px`,
      "--suggest-bottom": `${Math.max(0, box.bottom - bottom + 4)}px`,
      "--suggest-left": `${Math.max(0, anchor.left - box.left)}px`,
      "--suggest-right": `${Math.max(0, box.right - anchor.right)}px`
    });

    scroll();
  };

  const close = () => {
    cancelAnimationFrame(frame);
    version++;
    request?.abort();
    current = undefined;
    list.hidden = true;
  };

  const choose = (index) => {
    const item = items[index];

    if (composing || !current || !item || field.disabled || field.readOnly) return;

    if (item.type === "mention" && mention.ids(item.value).includes(profile.value()?.id))
      return close();
    const active = mention.query(field.value, field.selectionStart, field.selectionEnd);

    if (JSON.stringify(active) !== JSON.stringify(current)) return close();
    const start = field.selectionStart;
    const end = field.selectionEnd;

    field.setSelectionRange(current.start, current.end);
    close();
    if (!input.insert(field, `${item.value} `)) {
      field.setSelectionRange(start, end);

      return;
    }

    recent.stage(field, { type: item.type, value: item.value });
  };

  function append() {
    if (list.hidden) return;
    const size = dom.has("wearable") ? 12 : dom.has("small") ? 24 : 48;
    const start = options.children.length;

    for (const [offset, item] of items.slice(start, start + size).entries()) {
      const button = dom.create("button");
      const label = dom.create("span");

      button.type = "button";
      label.textContent = current.type === ":" ? `${item.value} ${item.label}` : item.label;

      if (item.image) button.append(emoji.image(item.image, true));

      button.append(label);
      if (item.type === "mention") {
        identity.mark(label, item.verified);

        const picture = dom.create("div");
        const status = dom.create("span");

        picture.className = "avatar-wrap";
        status.className = "profile-status";
        dom.set(status, "data-state", item.state || "offline");
        dom.set(button, "data-mention", "");
        picture.append(avatar(item.avatar).root, status);
        button.prepend(picture);
      }

      dom.on(button, "click", () => choose(start + offset));
      options.append(button);
    }
  }

  const mark = () => {
    cancelAnimationFrame(frame);
    if (list.hidden) return;

    if (selected >= options.children.length && items.length) {
      append();
      frame = requestAnimationFrame(mark);

      return;
    }

    [...options.children].forEach((button, index) => {
      button.toggleAttribute("data-selected", index === selected);
    });

    const button = options.children[selected];

    if (button) {
      const top = button.offsetTop;
      const bottom = top + button.offsetHeight;

      if (top < options.scrollTop) options.scrollTop = top;
      else if (bottom > options.scrollTop + options.clientHeight)
        options.scrollTop = bottom - options.clientHeight;
    }

    scroll();
  };

  const show = async (query, id) => {
    let choices;

    if (query.type === "/") {
      const catalog = await emoji.load();

      choices = catalog.groups.flatMap((group) =>
        group.items.map((item) => ({
          type: "emote",
          value: item.keyword,
          label: item.keyword.slice(1, -1),
          image: item
        }))
      );
    } else if (query.type === ":") {
      choices = text();
    } else {
      request = new AbortController();

      const result = await api(
        `${chatting}/mentions?${new URLSearchParams({ q: query.value, lang: dom.root.lang })}`,
        { signal: request.signal, cache: "no-store" }
      );

      choices =
        result.ok && Array.isArray(result.data?.items)
          ? result.data.items
              .filter((user) => user.state !== "offline" && user.id !== profile.value()?.id)
              .map((user) => ({
                type: "mention",
                value: mention.token({ ...user, name: identity.label(user) }),
                label: identity.label(user),
                verified: user.verified,
                avatar: user.avatar,
                state: user.state
              }))
          : [];
    }

    if (id !== version || document.activeElement !== view) return;

    items = mention.rank(
      choices,
      query.value,
      recent.recent().map((item) => item.value)
    );

    selected = 0;
    current = query;
    options.replaceChildren();
    host.append(list);
    list.hidden = !items.length;
    append();
    options.scrollTop = 0;
    fit();
    mark();
  };

  const update = () => {
    if (field.disabled || field.readOnly || document.activeElement !== view) return close();
    const query = mention.query(field.value, field.selectionStart, field.selectionEnd);

    if (!query) return close();

    if (JSON.stringify(query) === JSON.stringify(current)) return;

    request?.abort();
    list.hidden = true;
    current = query;

    const id = ++version;

    show(query, id).catch(() => {
      if (id === version) close();
    });
  };

  const observer = new ResizeObserver(fit);

  observer.observe(view.parentElement);
  if (view.closest(".chatting")) observer.observe(view.closest(".chatting"));

  off.push(() => observer.disconnect());
  off.push(dom.on(options, "scroll", scroll, { passive: true }));
  off.push(dom.on(host, "scroll", fit, { passive: true, capture: true }));
  off.push(dom.on(window, "resize", fit, { passive: true }));
  off.push(dom.on(window.visualViewport, "resize", fit, { passive: true }));
  off.push(dom.on(window.visualViewport, "scroll", fit, { passive: true }));
  off.push(dom.on(list, "pointerdown", (event) => event.preventDefault()));
  off.push(dom.on(field, "input", update));
  off.push(dom.on(view, "focus", update));
  off.push(dom.on(view, "blur", close));
  off.push(
    dom.on(view, "compositionstart", () => {
      composing = true;
    })
  );

  off.push(
    dom.on(view, "compositionend", () => {
      composing = false;
      update();
    })
  );

  off.push(
    dom.on(document, "selectionchange", () => {
      if (document.activeElement === view) update();
    })
  );

  off.push(
    dom.on(
      view,
      "keydown",
      (event) => {
        if (list.hidden || event.isComposing || event.keyCode === 229) return;

        if (!["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") return close();

        if (event.key === "Enter") return choose(selected);
        const step = event.key === "ArrowDown" ? 1 : -1;

        selected = (selected + step + items.length) % items.length;
        mark();
      },
      true
    )
  );

  return () => {
    close();
    off.forEach((remove) => remove());
    position.destroy();
    css.remove(list);
    list.remove();
  };
}
