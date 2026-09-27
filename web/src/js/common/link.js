import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as storage from "#common/storage";
import * as emoji from "#common/emoji";
import * as links from "#shared/link";
import dialog from "./dialog.js";
import legal from "./legal.js";
import "../../css/common/link.css";

const bound = new WeakMap();
const age = 30 * 24 * 60 * 60 * 1000;
const keys = [
  "title",
  "file",
  "notice",
  "local",
  "trust",
  "current",
  "window",
  "cancel",
  "manage",
  "empty",
  "forget",
  "error",
  "embed",
  "load",
  "navigation",
  "content"
];

i18n.preload("assets.file", "assets.link", "embed.external", ...keys.map((key) => `link.${key}`));

export const resolve = (value) => links.resolve(value, location.href);

const read = () => {
  try {
    const values = JSON.parse(storage.get("links", "[]"));

    return Array.isArray(values)
      ? values
          .filter(
            (item) =>
              typeof item?.origin === "string" &&
              ["navigation", "content"].includes(item.scope) &&
              Number.isFinite(item.until) &&
              item.until > Date.now()
          )
          .slice(-100)
      : [];
  } catch {
    return [];
  }
};

const remember = (url, scope) => {
  const values = read().filter((item) => item.origin !== url.origin || item.scope !== scope);

  values.push({ origin: url.origin, scope, until: Date.now() + age });

  return storage.set("links", JSON.stringify(values.slice(-100)));
};

export const trusted = (value, scope = "navigation") => {
  const href = resolve(value);

  if (!href) return false;

  const url = new URL(href);

  return (
    url.origin === location.origin ||
    read().some((item) => item.origin === url.origin && item.scope === scope)
  );
};

export const forget = (origin, scope) =>
  storage.set(
    "links",
    JSON.stringify(
      read().filter((item) => origin && (item.origin !== origin || (scope && item.scope !== scope)))
    )
  );

const node = (tag, name, key) => {
  const element = dom.create(tag);

  element.className = name;
  if (key) {
    dom.set(element, "data-i18n", `link.${key}`);
    element.textContent = i18n.message(`link.${key}`);
  }

  return element;
};

const launch = (url, target) => {
  const element = dom.create("a");

  element.href = url.href;
  element.target = target;
  element.rel = "noopener noreferrer";
  element.hidden = true;
  dom.body.append(element);
  element.click();
  element.remove();

  return true;
};

async function confirm(url, options, run) {
  const root = node("div", "link-confirm");
  const name = node("p", "link-name");
  const destination = node("p", "link-address");
  const error = node("p", "link-error", "error");
  const external = ["http:", "https:"].includes(url.protocol) && url.origin !== location.origin;
  const scope = options.scope || "navigation";
  const field = node("div", "checkbox link-trust");
  const label = dom.create("label");
  const input = dom.create("input");

  input.type = "checkbox";
  input.name = "trust";
  name.textContent = String(options.name || "");
  name.hidden = !name.textContent || resolve(name.textContent) === url.href;
  destination.textContent = url.href;
  error.hidden = true;
  label.append(node("span", "group-name", "trust"), input);
  field.append(label);

  const group = node("div", "group");
  const row = node("div", "group-item");

  row.append(field);
  group.append(row);
  group.hidden = !external;
  root.append(
    node("p", "", options.file ? "file" : scope === "content" ? "embed" : "title"),
    name,
    destination,
    node("p", "link-notice", external ? "notice" : "local"),
    group,
    error
  );

  return dialog({
    title: options.file ? "assets.file" : scope === "content" ? "embed.external" : "assets.link",
    content: root,
    direction: "→",
    actions: [
      { text: "link.cancel", value: false, data: ["data-neutral"] },
      {
        text:
          scope === "content"
            ? "link.load"
            : options.target === "_self"
              ? "link.current"
              : "link.window",
        data: ["data-confirm"],
        run: () => {
          if (external && input.checked && !remember(url, scope)) {
            error.hidden = false;
            return false;
          }

          return run();
        }
      }
    ]
  });
}

export function allow(value, options = {}) {
  const href = resolve(value);

  if (!href) return Promise.resolve(false);

  if (trusted(href, "content")) return Promise.resolve(true);

  return confirm(new URL(href), { ...options, scope: "content" }, () => true);
}

export function open(value, options = {}) {
  const href = resolve(value);

  if (!href) return Promise.resolve(false);

  const url = new URL(href);
  const local = url.origin === location.origin;
  const target = ["_self", "_blank"].includes(options.target)
    ? options.target
    : local && !options.file
      ? "_self"
      : "_blank";

  if (typeof options.run === "function") {
    try {
      return Promise.resolve(options.run(url));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  if (local && target === "_self" && !options.file) {
    const name = url.pathname.replace(/^\/|\/$/g, "");

    if (["terms", "privacy"].includes(name) && !url.search) {
      return legal(name);
    }
  }

  if (!options.file && ((local && !options.confirm) || (!local && trusted(href)))) {
    return Promise.resolve(launch(url, target));
  }

  return confirm(url, { ...options, target }, () => launch(url, target));
}

export function bind(element, options = {}) {
  const href = resolve(options.url || element.getAttribute("href"));

  if (!href) return element;

  const target = ["_self", "_blank"].includes(options.target)
    ? options.target
    : new URL(href).origin === location.origin && !options.file
      ? "_self"
      : "_blank";

  element.href = href;
  element.target = target;
  element.rel = "noopener noreferrer";

  if (bound.has(element)) {
    bound.get(element).options = { ...options, url: href, target };
    return element;
  }

  const state = { options: { ...options, url: href, target }, busy: false };

  dom.set(element, "data-response", "");
  bound.set(element, state);

  const click = (event) => {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;

    if (event.type === "click" && event.button > 0) return;

    event.preventDefault();
    event.stopPropagation();
    if (state.busy) return;

    state.busy = true;

    const tab = event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1;
    const next = { ...state.options, ...(tab && { target: "_blank" }) };

    void open(next.url, next)
      .catch(console.error)
      .finally(() => {
        state.busy = false;
      });
  };

  dom.on(element, "click", click);
  dom.on(element, "auxclick", click);

  return element;
}

export function render(target, value, options = {}) {
  const urls = [];

  for (const part of links.parse(value, location.href)) {
    if (!part.url) {
      emoji.render(target, part.text);
      continue;
    }

    const element = dom.create("a");

    element.className = "link";
    bind(element, { ...options, url: part.url, name: part.text });
    emoji.render(element, part.text);
    target.append(element);
    urls.push({ url: part.url, title: part.text });
  }

  return urls;
}

export async function manage() {
  const root = node("div", "link-list");

  const draw = () => {
    root.replaceChildren();
    for (const item of read()) {
      const row = node("div", "link-site");
      const label = node("span", "link-address");
      const button = node("button", "", "forget");

      label.textContent = item.origin;
      label.append(node("span", "link-notice", item.scope));
      button.type = "button";
      dom.set(button, "data-response", "");
      dom.on(button, "click", () => {
        if (forget(item.origin, item.scope)) draw();
      });

      row.append(label, button);
      root.append(row);
    }

    if (!root.children.length) root.append(node("p", "", "empty"));
  };

  draw();

  return dialog({
    title: "link.manage",
    content: root,
    direction: "→",
    actions: [{ text: "dialog.confirm", value: true }]
  });
}
