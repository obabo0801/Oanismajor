export const root = document.documentElement;

export const body = document.body;

export const scroller = document.scrollingElement;

export const create = (tag) => document.createElement(tag);

export const svg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);

export const query = (selector, target = document) => target?.querySelector(selector) ?? null;

export const all = (selector, target = document) => [...(target?.querySelectorAll(selector) ?? [])];

export const find = (selector, target = document) => [
  ...(target?.matches?.(selector) ? [target] : []),
  ...all(selector, target)
];

export const has = (name, target = root) => target?.classList.contains(name) ?? false;

export const get = (target, name) => target?.getAttribute(name) ?? null;

export const set = (target, name, value) => {
  target?.setAttribute(name, value);
};

export const remove = (target, name) => target?.removeAttribute(name);

export const on = (target, type, listener, options) => {
  if (!target?.addEventListener) {
    return () => {};
  }

  target.addEventListener(type, listener, options);

  return () => {
    target.removeEventListener(type, listener, options);
  };
};
