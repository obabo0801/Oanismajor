import { date } from "#shared/chatting";

export const actions = {
  mute: "profile.historyMute",
  kick: "profile.historyKick",
  unkick: "profile.historyUnkick",
  block: "profile.historyBlock",
  unblock: "profile.historyUnblock"
};

export const filters = (query) => {
  const search = query.search ?? "";
  const range = query.date === undefined ? null : date(query.date);

  if (typeof search !== "string" || search.length > 100 || (query.date !== undefined && !range))
    throw Object.assign(new Error("Invalid history filter"), { status: 400 });

  return { search: search.trim(), range };
};
