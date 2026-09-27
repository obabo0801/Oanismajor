export const defaults = Object.freeze({
  notification: true,
  chat: false,
  mention: true,
  web: true,
  whisper: true,
  message: true
});

export const read = (source) => {
  let value = source;

  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch {
      value = null;
    }
  }

  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof value?.[key] === "boolean" ? value[key] : fallback
    ])
  );
};

export const allows = (value, mentioned, push = false) =>
  value.notification && (mentioned ? value.mention : value.chat) && (!push || value.web);
