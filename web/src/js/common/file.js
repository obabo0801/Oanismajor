import * as dom from "./dom.js";
import * as rules from "#shared/attach";
import * as i18n from "./i18n.js";
import format from "./format.js";
import "../../css/common/file.css";

i18n.preload("file.select", "file.empty", "chatting.attach.remove", "image.select");

export default function file({ accept = "", multiple = false, compact = false, source = "" } = {}) {
  const root = dom.create("div");
  const input = dom.create("input");
  const choose = dom.create("button");
  const clear = dom.create("button");
  const name = dom.create("span");
  const preview = dom.create("div");
  const image = dom.create("img");

  let url;

  preview.className = "file-preview";
  image.alt = "";
  image.draggable = false;
  clear.className = "file-close preview-control";
  dom.set(clear, "data-circle", "");
  dom.set(clear, "data-background", "");
  dom.set(clear, "data-shadow", "");
  dom.set(clear, "data-scale", "");

  root.className = "file";
  input.type = "file";
  input.name = "attachment";
  input.accept = accept;
  input.multiple = multiple;
  input.hidden = true;
  name.className = "file-name";
  for (const [button, icon, key] of [
    [choose, compact ? "image" : "plus", compact ? "image.select" : "file.select"],
    [clear, "minus", "chatting.attach.remove"]
  ]) {
    button.type = "button";
    dom.set(button, "data-icon", icon);
    if (button !== clear) dom.set(button, "data-color", "");

    dom.set(button, "data-response", "");
    dom.set(button, "data-tooltip", key);

    if (button === clear || compact) {
      button.title = i18n.message(key);
      dom.set(button, "data-circle", "");
      continue;
    }

    const text = dom.create("span");

    text.textContent = i18n.message(key);
    dom.set(text, "data-i18n", key);
    button.append(text);
  }

  const update = () => {
    const files = [...input.files];

    if (url) URL.revokeObjectURL(url);

    url = undefined;
    image.removeAttribute("src");

    const selected = files.find((item) => item.type.startsWith("image/"));

    image.hidden = !selected && !source;
    if (source) image.src = source;

    if (selected) {
      url = URL.createObjectURL(selected);
      image.src = url;
    }

    name.textContent = files.length
      ? files.map((item) => item.name).join("\n")
      : i18n.message("file.empty");

    if (files.length) dom.remove(name, "data-i18n");
    else dom.set(name, "data-i18n", "file.empty");

    preview.hidden = !files.length && !source;
    if (compact) root.hidden = !files.length && !source;

    name.hidden = Boolean(selected);
    root.toggleAttribute("data-selected", Boolean(files.length));
  };

  const reset = () => {
    source = "";
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  dom.on(choose, "click", () => input.click());
  dom.on(clear, "click", reset);
  dom.on(input, "change", () => {
    source = "";
    update();
  });

  preview.append(image, clear);
  if (compact) root.append(input, preview);
  else root.append(input, choose, name, preview);

  update();

  const destroy = () => {
    if (url) URL.revokeObjectURL(url);

    url = undefined;
  };

  return { root, input, button: choose, reset, destroy };
}

export function card(name, tag = "span") {
  const root = dom.create(tag);
  const icon = dom.create("span");
  const body = dom.create("span");
  const title = dom.create("span");
  const extension = dom.create("span");
  const dot = name.lastIndexOf(".");

  root.className = "file-card";
  dom.set(root, "data-background", "");
  if (tag === "button") root.type = "button";

  icon.className = "file-icon";
  body.className = "file-body";
  title.className = "file-name";
  extension.className = "file-extension";
  title.textContent = dot > 0 ? name.slice(0, dot) : name;
  extension.textContent = dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
  dom.set(icon, "data-icon", rules.mime(name).startsWith("audio/") ? "volume-high" : "file");
  dom.set(icon, "data-color", "");
  body.append(title, extension);
  root.append(icon, body);
  return root;
}

export function rename(root, value) {
  const title = root.querySelector(".file-name");

  if (!title) return;

  if (root.dataset.view !== "grid") {
    title.textContent = value;
    return;
  }
  const dot = value.lastIndexOf(".");
  const stem = dot > 0 ? value.slice(0, dot) : value;
  const extension = dot > 0 ? value.slice(dot) : "";
  const characters = Array.from(stem);
  const split = Math.max(Math.ceil(characters.length / 2), characters.length - 4);
  const start = dom.create("span");
  const end = dom.create("span");

  start.textContent = characters.slice(0, split).join("");
  end.textContent = characters.slice(split).join("") + extension;
  title.replaceChildren(start, end);
}

export function grid(item, tag = "span") {
  const root = card(item.name || item.url || "", tag);
  const detail = root.querySelector(".file-extension");
  const original = item.name || "";
  const extension = original.match(/\.[^.]+$/)?.[0] || "";
  const title = item.title || original || item.url || "";

  dom.set(root, "data-view", "grid");
  dom.set(
    root.querySelector(".file-icon"),
    "data-icon",
    item.kind === "link"
      ? "link"
      : rules.mime(original).startsWith("video/")
        ? "play"
        : rules.mime(original).startsWith("audio/")
          ? "volume-high"
          : rules.icon(original)
  );

  rename(root, title + (item.title && extension && !title.endsWith(extension) ? extension : ""));
  detail.className = "file-size";
  detail.textContent = Number.isFinite(item.size) ? format(item.size) : "";
  detail.hidden = !detail.textContent;
  if (rules.mime(original).startsWith("audio/")) {
    const badge = dom.create("span");
    const icon = dom.create("span");

    badge.className = "video-badge";
    dom.set(icon, "data-icon", "volume-high");
    badge.append(icon);
    root.append(badge);
  }
  return root;
}
