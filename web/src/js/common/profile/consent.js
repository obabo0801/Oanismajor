import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as version from "#shared/consent";
import legal from "#common/legal";

const keys = ["all", "terms", "privacy", "view", "error"];

i18n.preload(...keys.map((key) => `setup.consent.${key}`));

const text = (element, key) => {
  const value = `setup.consent.${key}`;

  element.textContent = i18n.message(value);
  dom.set(element, "data-i18n", value);
};

const choice = (key) => {
  const root = dom.create("div");
  const label = dom.create("label");
  const input = dom.create("input");
  const title = dom.create("span");

  root.className = "checkbox";
  input.type = "checkbox";
  input.name = key;
  input.required = key !== "all";

  if (key === "all") {
    dom.set(root, "data-background", "");
  }

  text(title, key);

  label.append(input, title);
  root.append(label);

  return { root, input };
};

export default function consent() {
  const root = dom.create("div");
  const group = dom.create("div");
  const all = choice("all");
  const fields = new Map();

  root.className = "setup-consent";
  group.className = "group";

  for (const key of ["terms", "privacy"]) {
    const item = dom.create("div");
    const row = dom.create("div");
    const field = choice(key);
    const link = dom.create("a");

    item.className = "group-item";
    row.className = "setup-consent-row";

    link.href = `/${key}`;
    dom.on(link, "click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      legal(key);
    });

    text(link, "view");

    row.append(field.root, link);
    item.append(row);
    group.append(item);

    fields.set(key, field.input);
  }

  const inputs = [...fields.values()];
  const valid = () => inputs.every((input) => input.checked);

  dom.on(root, "change", (event) => {
    if (event.target === all.input) {
      inputs.forEach((input) => {
        input.checked = all.input.checked;
      });
    }

    all.input.checked = valid();
    all.input.indeterminate = !all.input.checked && inputs.some((input) => input.checked);

    root.dispatchEvent(new Event("input", { bubbles: true }));
  });

  root.append(all.root, group);

  return {
    root,
    valid,
    value: () => ({
      terms: fields.get("terms").checked ? version.terms : null,
      privacy: fields.get("privacy").checked ? version.privacy : null
    })
  };
}
