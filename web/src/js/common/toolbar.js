import * as dom from "#common/dom";
import * as i18n from "#common/i18n";

export const badge = (button, count) => {
  let node = dom.query(".toolbar-badge", button);

  const show = Number.isSafeInteger(count) && count >= 0;

  if (!node && !show) return;

  if (!node) {
    node = dom.create("span");
    node.className = "toolbar-badge";
    button.append(node);
  }

  node.hidden = !show;
  node.textContent = show ? (count > 99 ? "99+" : String(count)) : "";
};

export default function toolbar(items = [], { compact = false } = {}) {
  const root = dom.create("div");

  root.className = "toolbar";
  dom.set(root, "data-blur", "");
  dom.set(root, "data-shadow", "");

  for (const { icon, text, run, element, disabled = false, color = false } of items) {
    if (element) {
      root.append(element);
      continue;
    }

    const button = dom.create("button");
    const label = dom.create("span");

    button.type = "button";
    button.disabled = disabled;
    dom.set(button, "data-icon", icon);
    button.toggleAttribute("data-color", color);
    dom.set(button, "data-response", "");

    label.textContent = i18n.message(text);
    dom.set(label, "data-i18n", text);
    i18n.preload(text);

    if (compact) {
      for (const name of ["data-circle", "data-scale", "data-background"])
        dom.set(button, name, "");
      dom.set(button, "data-tooltip", text);
    } else button.append(label);

    let running = false;

    dom.on(button, "click", async () => {
      if (running || button.disabled) return;

      running = true;

      try {
        await run?.(button);
      } catch (error) {
        console.error(error);
      } finally {
        running = false;
      }
    });

    root.append(button);
  }

  return root;
}
