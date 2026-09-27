const aliases = { recent: "input-recent", tab: "events-tab", links: "_links" };

const name = (key) => {
  const names = {
    brightness: "bright",
    navigation: "nav",
    vibration: "vibrate",
    links: "link",
    "profile-protect": "protect"
  };

  return `_${
    names[key] ||
    key
      .replace(/^chatting-hide-since:/, "since:")
      .replace(/^chatting-hide:/, "hide:")
      .replace(/^volume(?=-|$)/, "vol")
  }`;
};

const hash = (key) => {
  let hash = 14695981039346656037n;

  for (const letter of key)
    hash = BigInt.asUintN(64, (hash ^ BigInt(letter.codePointAt(0))) * 1099511628211n);

  return hash.toString(16).padStart(16, "0");
};

export const get = (key, fallback = null, area = "local") => {
  let value = fallback;

  try {
    const storage = globalThis[`${area}Storage`];
    const target = name(key);
    const current = storage.getItem(target);

    value =
      current ??
      (aliases[key] ? storage.getItem(aliases[key]) : null) ??
      storage.getItem(hash(key)) ??
      storage.getItem(key);

    if (value === null) return fallback;

    if (current === null) storage.setItem(target, value);

    if (target !== key) storage.removeItem(key);

    storage.removeItem(hash(key));

    if (aliases[key]) storage.removeItem(aliases[key]);
  } catch {}

  return value;
};

export const set = (key, value, area = "local") => {
  try {
    const storage = globalThis[`${area}Storage`];
    const target = name(key);

    storage.setItem(target, String(value));
    if (target !== key) storage.removeItem(key);

    storage.removeItem(hash(key));

    if (aliases[key]) storage.removeItem(aliases[key]);

    return true;
  } catch {
    return false;
  }
};

export const remove = (key, area = "local") => {
  try {
    const storage = globalThis[`${area}Storage`];

    storage.removeItem(name(key));
    storage.removeItem(key);
    storage.removeItem(hash(key));
    if (aliases[key]) storage.removeItem(aliases[key]);
  } catch {}
};

export const clear = () => {
  try {
    localStorage.clear();

    return true;
  } catch {
    return false;
  }
};
