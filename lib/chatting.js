export const length = 2000;
export const size = 50;
export const maximum = 100;
export const notices = {
  mute: { text: "chatting.muteNotice", type: "info" },
  kick: { text: "chatting.kickNotice", type: "info" },
  block: { text: "chatting.kickNotice", type: "info" },
  unkick: { text: "chatting.unkickNotice", type: "mute", admin: true },
  unblock: { text: "chatting.unblockNotice", type: "mute", admin: true }
};
export const validId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const date = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);

  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return null;

  return [`${value} 00:00:00`, `${new Date(stamp + 86400000).toISOString().slice(0, 10)} 00:00:00`];
};
