import * as navigation from "#common/route";
import * as route from "#shared/route";
import once from "#common/once";
import list from "#common/profile/history/list";
import record from "#common/profile/history/record";

const opening = once();

navigation.register(
  "reports",
  (id) => (!id || /^[a-f\d]{32}$/.test(id) ? inbox(id || undefined) : false),
  "drawer"
);

export default function inbox(id) {
  return opening(id || "inbox", () =>
    list({
      url: id ? `${route.profile}/${encodeURIComponent(id)}/history/report` : route.report,
      route: ["reports", typeof id === "string" ? id : ""],
      title: id ? "profile.reportHistory" : "report.inbox",
      types: { user: "report.user", message: "report.message" },
      kind: "type",
      cursorKey: "before",
      render: (entry) => record(entry, "report")
    })
  );
}
