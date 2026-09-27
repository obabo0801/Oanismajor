import * as dom from "#common/dom";

const sheet = new CSSStyleSheet();
const rules = new Map();
const values = new Map();

document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

let index = 0;

const locate = (rule) => [...sheet.cssRules].indexOf(rule);

const write = (id) => {
  let rule = rules.get(id);

  if (!rule) {
    const next = sheet.insertRule(`[data-css="${id}"]{}`);

    rule = sheet.cssRules[next];
    rules.set(id, rule);
  }

  rule.style.cssText = Object.entries(values.get(id))
    .map(([name, value]) => {
      return `${name}:${value}`;
    })
    .join(";");
};

const clear = (element, id) => {
  const rule = rules.get(id);
  const at = rule ? locate(rule) : -1;

  if (at >= 0) {
    sheet.deleteRule(at);
  }

  rules.delete(id);
  values.delete(id);
  dom.remove(element, "data-css");
};

export const set = (element, next) => {
  let id = dom.get(element, "data-css");

  if (!id) {
    id = String(++index);
    dom.set(element, "data-css", id);
  }

  const value = { ...values.get(id) };

  Object.entries(next).forEach(([name, item]) => {
    if (item === null || item === undefined) {
      delete value[name];
    } else {
      value[name] = String(item);
    }
  });

  if (!Object.keys(value).length) {
    clear(element, id);

    return;
  }

  values.set(id, value);
  write(id);
};

export const remove = (element) => {
  const id = dom.get(element, "data-css");

  if (id) {
    clear(element, id);
  }
};

export const copy = (source, target) => {
  const value = values.get(dom.get(source, "data-css"));

  dom.remove(target, "data-css");

  if (value) {
    set(target, value);
  }
};

const clean = (node) => {
  if (!(node instanceof Element)) {
    return;
  }

  const elements = [];

  if (dom.get(node, "data-css") !== null) {
    elements.push(node);
  }

  elements.push(...dom.all("[data-css]", node));

  elements.forEach((element) => {
    if (!element.isConnected) {
      remove(element);
    }
  });
};

const observer = new MutationObserver((records) => {
  records.forEach((record) => {
    record.removedNodes.forEach(clean);
  });
});

observer.observe(document, { childList: true, subtree: true });
