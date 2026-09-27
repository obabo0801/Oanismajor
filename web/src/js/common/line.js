import * as dom from "#common/dom";
import * as i18n from "#common/i18n";

export default function line({ type = "solid", text = "", icon = "" } = {}) {
  const element = dom.create("div");

  element.className = "line";
  dom.set(element, "data-line", ["solid", "dotted", "double"].includes(type) ? type : "solid");

  if (icon) {
    dom.set(element, "data-icon", icon);
    dom.set(element, "data-color", "");
  }

  if (text) {
    const label = dom.create("span");

    label.textContent = i18n.message(text);
    dom.set(label, "data-i18n", text);
    element.append(label);
  }

  return element;
}
