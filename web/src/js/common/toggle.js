import * as dom from "#common/dom";
import drawer from "#common/drawer";
import * as i18n from "#common/i18n";
import * as route from "#common/route";

i18n.preload("toggle.on", "toggle.off");

const opened = new WeakSet();
const panels = new WeakMap();

let listening = false;

const input = (element) =>
  dom.query(":scope > .toggle-head " + '.toggle-switch input[type="checkbox"]', element);

const content = (element) => dom.query(":scope > .toggle-content", element);

const text = (element, enabled) => {
  const key = enabled ? "toggle.on" : "toggle.off";

  element.textContent = i18n.message(key);
  dom.set(element, "data-i18n", key);
};

const update = (element, source, target = content(element)) => {
  const enabled = source.checked;

  if (!target) {
    return;
  }

  target.disabled = source.disabled || !enabled;
  target.inert = source.disabled || !enabled;

  if (enabled) {
    dom.remove(element, "data-off");
  } else {
    dom.set(element, "data-off", "");
  }
};

export const sync = (element) => {
  const source = input(element);
  const panel = panels.get(element);

  if (!source) return;

  if (panel) {
    panel.control.checked = source.checked;
    panel.control.disabled = source.disabled;
    text(panel.state, source.checked);
  }

  update(element, source, panel?.target || content(element));
};

const create = (element, source, target) => {
  const panel = dom.create("div");
  const group = dom.create("div");
  const row = dom.create("div");
  const field = dom.create("div");

  panel.className = "toggle-panel";
  group.className = "group";
  row.className = "group-item";
  field.className = "switch";

  const label = dom.create("label");
  const state = dom.create("span");
  const control = dom.create("input");

  control.type = "checkbox";
  control.checked = source.checked;
  control.disabled = source.disabled;
  panels.set(element, { control, state, target });

  text(state, control.checked);
  label.append(state, control);
  field.append(label);

  dom.on(control, "change", () => {
    if (source.disabled) {
      sync(element);

      return;
    }

    source.checked = control.checked;
    source.dispatchEvent(new Event("input", { bubbles: true }));

    sync(element);
  });

  row.append(field);
  group.append(row);
  panel.append(group);

  if (target) {
    panel.append(target);
  }

  return panel;
};

const open = async (element, source) => {
  if (source.disabled || opened.has(element)) {
    return;
  }

  opened.add(element);

  const target = content(element);
  const toolbar = dom.query(":scope > .toolbar", target);

  try {
    await drawer({
      route: dom.get(element, "data-route")
        ? ["authority", dom.get(element, "data-route")]
        : undefined,
      content: create(element, source, target),
      toolbar,
      back: true,
      title: "profile.authority",
      side: "right",
      direction: "→"
    });
  } finally {
    if (target) {
      if (toolbar) target.append(toolbar);

      element.append(target);
    }

    opened.delete(element);
    panels.delete(element);
  }
};

export default function toggle(root = document) {
  dom.find(".toggle", root).forEach(sync);
}

export function listen() {
  if (listening) {
    return;
  }

  listening = true;

  dom.on(document, "change", (event) => {
    const source = event.target;

    if (!source.matches?.(".toggle-switch input")) {
      return;
    }

    const element = source.closest(".toggle");

    if (element) {
      sync(element);
    }
  });

  dom.on(document, "click", (event) => {
    const button = event.target.closest?.(".toggle-button");

    if (!button || button.disabled) {
      return;
    }

    const element = button.closest(".toggle");

    if (!element) {
      return;
    }

    const source = input(element);

    if (source) {
      open(element, source).catch(() => {});
    }
  });
}

route.register(
  "authority",
  (id) => {
    const element = dom.all(".toggle").find((item) => dom.get(item, "data-route") === id);
    const source = element && input(element);

    return source ? open(element, source) : false;
  },
  "drawer"
);
