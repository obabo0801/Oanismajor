import * as storage from "#common/storage";
import * as attachment from "#shared/attach";

const key = "recent";
const maximum = 80;
const staged = new WeakMap();
const committed = new WeakSet();

const normalize = (value) => {
  if (typeof value === "string") {
    value = {
      type: value.startsWith("/") ? "emote" : value.startsWith("@") ? "mention" : "emoji",
      value
    };
  }

  if (value?.type === "ogq") return attachment.ogq(value);

  if (["gif", "sticker"].includes(value?.type)) {
    return attachment.giphy(value);
  }

  if (
    ["emoji", "emote", "kaomoji", "mention"].includes(value?.type) &&
    typeof value.value === "string" &&
    value.value.length <= 200 &&
    value.value.trim()
  ) {
    return { type: value.type, value: value.value };
  }

  return null;
};

const id = (item) => `${item.type}:${item.id || item.value || `${item.ogq_id}:${item.number}`}`;

let items = [];

try {
  const saved = JSON.parse(storage.get(key, "[]"));

  if (Array.isArray(saved)) {
    const seen = new Set();

    items = saved
      .map(normalize)
      .filter((item) => {
        if (!item || seen.has(id(item))) return false;

        seen.add(id(item));

        return true;
      })
      .slice(0, maximum);
  }
} catch {}

export const recent = () => items.map((item) => ({ ...item }));

export const clear = (type) => {
  items = items.filter((item) => (type ? item.type !== type : item.type === "mention"));

  storage.set(key, JSON.stringify(items));
};

export const remember = (value) => {
  const item = normalize(value);

  if (!item) return;

  items = [item, ...items.filter((entry) => id(entry) !== id(item))].slice(0, maximum);

  storage.set(key, JSON.stringify(items));
};

export const stage = (field, value) => {
  const item = normalize(value);

  if (!item || !field) return;

  if (item.type === "mention") {
    remember(item);

    return;
  }

  const values = staged.get(field) || [];

  staged.set(field, [item, ...values.filter((entry) => id(entry) !== id(item))].slice(0, maximum));
};

export const snapshot = (field, text, attachments = []) => {
  const values = (staged.get(field) || []).filter(
    (item) => item.value && String(text || "").includes(item.value)
  );
  const seen = new Set(values.map(id));

  for (const value of attachments) {
    const item = normalize(value);

    if (!item || seen.has(id(item))) continue;

    seen.add(id(item));
    values.unshift(item);
  }

  return values.map((item) => ({ ...item }));
};

export const commit = (values) => {
  if (!Array.isArray(values) || committed.has(values)) return;

  committed.add(values);

  const saved = values.map(normalize).filter(Boolean);
  const seen = new Set(saved.map(id));

  if (!saved.length) return;

  items = [...saved, ...items.filter((item) => !seen.has(id(item)))].slice(0, maximum);

  storage.set(key, JSON.stringify(items));
};
