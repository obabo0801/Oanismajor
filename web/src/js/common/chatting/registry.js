const ids = new WeakMap();
const messages = new Set();
const urls = new WeakMap();
const stored = new Set();

const bind = (items, values, element, id) => {
  if (!id) {
    return;
  }

  values.set(element, id);
  items.add(element);
};

const find = (items, values, id) => {
  const result = [];

  for (const element of items) {
    if (!element.isConnected) {
      items.delete(element);
    } else if (values.get(element) === id) {
      result.push(element);
    }
  }

  return result;
};

export const message = (element, id) => bind(messages, ids, element, id);

export const messageAll = (id) => find(messages, ids, id);

export const storedMessage = (element, id) => bind(stored, urls, element, id);

export const storedAll = (id) => find(stored, urls, id);
