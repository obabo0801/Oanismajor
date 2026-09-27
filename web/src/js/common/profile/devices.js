import * as dom from "../dom.js";
import * as i18n from "../i18n.js";
import drawer from "../drawer.js";
import label from "./label.js";

i18n.preload(
  "menu.devices",
  "menu.deviceInfo",
  "menu.unnamed",
  "profile.os",
  "profile.browser",
  "admin.registered",
  "admin.updated",
  "assets.unknown"
);

const text = (tag, key, className) => {
  const node = dom.create(tag);

  node.className = className;
  node.textContent = i18n.message(key);
  dom.set(node, "data-i18n", key);
  return node;
};

export function information(device) {
  const root = dom.create("div");
  const heading = dom.create("div");
  const name = dom.create("span");
  const info = dom.create("div");

  root.className = "settings";
  heading.className = "menu-device";
  dom.set(heading, "data-icon", device.device === "desktop" ? "theme" : "phone");

  dom.set(heading, "data-color", "");
  name.textContent = device.name || device.os || device.device || i18n.message("menu.unnamed");

  heading.append(name);
  info.className = "group";
  root.append(heading, info);
  info.append(
    ...[
      label("profile.os", device.os || device.device, { icon: "theme" }),
      label("profile.browser", device.browser || i18n.message("assets.unknown"), { icon: "link" }),
      label("admin.registered", device.registered || i18n.message("assets.unknown"), {
        date: true,
        icon: "calendar"
      }),
      label("admin.updated", device.time, { date: true, icon: "clock" })
    ].filter(Boolean)
  );

  return root;
}

function details(device) {
  return drawer({
    title: "menu.deviceInfo",
    content: information(device),
    back: true,
    side: "right",
    direction: "→"
  });
}

export default function devices(items = []) {
  const root = dom.create("section");
  const group = dom.create("div");

  root.className = "group-section profile-devices";
  group.className = "group";
  root.append(text("h3", "menu.devices", "group-title"), group);
  for (const device of items) {
    const row = dom.create("div");
    const toggle = dom.create("div");
    const head = dom.create("div");
    const name = dom.create("div");
    const title = dom.create("span");
    const button = dom.create("button");

    row.className = "group-item";
    toggle.className = "toggle";
    head.className = "toggle-head";
    name.className = "profile-device-name";
    title.textContent = device.name || device.os || device.device || i18n.message("menu.unnamed");

    name.toggleAttribute("data-active", device.receiving);
    dom.set(name, "data-icon", device.device === "desktop" ? "theme" : "phone");
    button.type = "button";
    button.className = "toggle-switch toggle-action";
    dom.set(button, "data-icon", "info");
    dom.set(button, "data-response", "");
    dom.on(button, "click", () => details(device));
    name.append(title);
    head.append(name, button);
    toggle.append(head);
    row.append(toggle);
    group.append(row);
  }
  return root;
}
