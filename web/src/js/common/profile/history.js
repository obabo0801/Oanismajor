import * as route from "#common/route";
import { profile as path } from "#shared/route";
import { actions } from "#shared/history";
import list from "#common/profile/history/list";
import record from "#common/profile/history/record";

for (const type of ["chatting", "sanction"]) {
  route.register(
    `history-${type}`,
    (id) => (/^[a-f\d]{32}$/.test(id) ? history(id, type) : false),
    "drawer"
  );
}

export default function history(id, type) {
  return list({
    url: `${path}/${encodeURIComponent(id)}/history/${type}`,
    route: [`history-${type}`, id],
    title: type === "chatting" ? "profile.chatHistory" : "profile.blockHistory",
    types: type === "sanction" ? actions : {},
    render: (entry) => record(entry, type),
    accept: (entry) => entry.id === id
  });
}
