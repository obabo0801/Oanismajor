import * as dom from "#common/dom";
import * as css from "#common/css";
import { get, set } from "#common/storage";

export const modes = ["system", "light", "dark", "black"];
export const brightness = (value = get("brightness", 100)) => {
  const level = Math.max(70, Math.min(100, Number(value) || 100));

  if (!set("brightness", level)) return false;

  css.set(dom.root, { "--brightness": `${level}%` });
  sync();

  return true;
};

const scheme = matchMedia("(prefers-color-scheme: dark)");
const colors = new Map();

let listening = false;
let background;
let selected;

function sync() {
  let meta = dom.query('meta[name="theme-color"]');

  if (!meta) {
    meta = dom.create("meta");
    dom.set(meta, "name", "theme-color");
    document.head.append(meta);
  }

  if (!background) {
    const wrap = dom.create("div");

    background = dom.create("span");
    background.className = "theme-color";
    background.hidden = true;
    wrap.append(background);
    dom.body.append(wrap);
  }

  const source = [...colors.values()].at(-1) || dom.root;
  const target =
    source === dom.root || (source instanceof Element && !source.isConnected) ? background : source;

  const color = target instanceof Element ? getComputedStyle(target).backgroundColor : target;

  dom.set(meta, "content", color);
}

const apply = () => {
  const value = selected === "system" ? (scheme.matches ? "dark" : "light") : selected;

  if (dom.get(dom.root, "data-theme") !== value) {
    dom.set(dom.root, "data-theme", value);
  }

  sync();
};

export const color = (value) => {
  const key = {};

  colors.set(key, value);
  sync();

  return () => {
    colors.delete(key);
    sync();
  };
};

export default function theme(mode) {
  const fallback = dom.has("wearable") ? "black" : "system";

  mode ||= get("theme", fallback);

  if (!modes.includes(mode)) {
    mode = fallback;
  }

  if (!set("theme", mode) && selected) return selected;

  selected = mode;
  brightness();

  if (!listening) {
    dom.on(scheme, "change", apply);
    dom.on(window, "pageshow", apply);
    dom.on(document, "visibilitychange", () => {
      if (!document.hidden) {
        apply();
      }
    });

    const observer = new MutationObserver(sync);

    observer.observe(dom.root, { attributes: true, attributeFilter: ["data-theme", "class"] });

    listening = true;
  }

  apply();

  return mode;
}
