import * as dom from "#common/dom";

const kinds = {
  open: { text: "assets.open", icon: "link" },
  text: { text: "chatting.action.copyText", icon: "copy" },
  link: { text: "chatting.action.copyLink", icon: "link" },
  save: { text: "chatting.action.saveImage", icon: "download" },
  image: { text: "chatting.action.copyImage", icon: "copy" },
  remove: { text: "chatting.action.remove", icon: "trash", danger: true, data: ["data-danger"] },
  restore: { text: "restore.action", icon: "reload", data: ["data-confirm"] },
  cancel: { text: "dialog.cancel", icon: "close", data: ["data-neutral"] }
};

export const spec = (value, options = {}) => ({ ...kinds[value], value, ...options });

export const group = (values) => {
  const root = dom.create("div");

  root.className = "group";
  root.append(...values.map(item));
  root.hidden = !values.length;

  return root;
};

export default function item({ value, text, icon, run, danger = false, disabled = false }) {
  const row = dom.create("div");
  const button = dom.create("button");

  row.className = "group-item";
  if (danger) dom.set(row, "data-danger", "");

  button.type = "button";
  button.disabled = disabled;
  dom.set(button, "data-icon", icon);
  button.toggleAttribute("data-color", !danger);
  button.textContent = text;
  dom.set(button, "data-i18n", text);
  dom.set(button, "data-response", "");
  dom.set(button, "data-layer-action", value);
  dom.on(button, "click", () => {
    if (button.disabled) return;

    Promise.resolve(run?.()).catch(() => {});
  });

  row.append(button);

  return row;
}
