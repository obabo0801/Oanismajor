import * as dom from "#common/dom";

const rules = new Set();

const add = (element) => {
  const value = Number(dom.get(element, "data-columns"));

  if (!Number.isInteger(value) || value < 1 || rules.has(value)) {
    return;
  }

  rules.add(value);

  const style = dom.create("style");

  style.textContent = `
    .group[data-view="grid"][data-columns="${value}"] {
      grid-template-columns:
        repeat(${value}, minmax(0, 1fr));
    }
  `;

  document.head.append(style);
};

export default function group(root = document) {
  dom.find('.group[data-view="grid"]', root).forEach(add);
}
