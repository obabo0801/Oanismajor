import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import api from "#common/api";
import dialog from "#common/dialog";
import toast from "#common/toast";
import once from "#common/once";
import { validId } from "#shared/chatting";
import { report as path } from "#shared/route";
import * as rules from "#shared/report";

const opening = once();

i18n.preload(
  "report.user",
  "report.message",
  "report.reason",
  "report.detail",
  "report.send",
  "report.success",
  "report.error",
  "profile.cancel",
  ...rules.reasons.map((reason) => `report.${reason}`)
);

export default function report(type, target, own = false, evidence) {
  if (
    own ||
    !target ||
    !["user", "message"].includes(type) ||
    (type === "message" && !validId(target))
  )
    return Promise.resolve(false);

  return opening("report", async () => {
    const root = dom.create("div");
    const field = dom.create("div");
    const select = dom.create("select");
    const input = dom.create("div");
    const detail = dom.create("textarea");
    const status = dom.create("p");

    root.className = "profile";
    field.className = "select";
    select.name = "report-reason";
    for (const value of ["", ...rules.reasons]) {
      const option = dom.create("option");
      const key = `report.${value || "reason"}`;

      option.value = value;
      option.textContent = i18n.message(key);
      dom.set(option, "data-i18n", key);
      select.append(option);
    }

    field.append(select);
    input.className = "input";
    detail.name = "report-detail";
    detail.maxLength = rules.length;
    detail.rows = 4;
    dom.set(detail, "data-control", "");
    dom.set(detail, "data-i18n-placeholder", "report.detail");
    input.append(detail);
    status.className = "profile-error";
    status.hidden = true;
    status.textContent = i18n.message("report.error");
    dom.set(status, "data-i18n", "report.error");
    root.append(field, input, status);

    let busy = false;
    let active = true;
    let request;

    try {
      return await dialog({
        title: `report.${type}`,
        content: root,
        direction: "→",
        actions: [
          { text: "profile.cancel", icon: "close", value: false, data: ["data-neutral"] },
          {
            text: "report.send",
            icon: "flag",
            submit: true,
            data: ["data-confirm"],
            disabled: () => busy || !rules.reasons.includes(select.value),
            run: async () => {
              if (!active || busy || !rules.reasons.includes(select.value)) return false;

              busy = true;
              status.hidden = true;
              select.disabled = true;
              detail.disabled = true;
              request = new AbortController();

              const result = await api(path, {
                method: "POST",
                signal: request.signal,
                data: {
                  type,
                  target,
                  reason: select.value,
                  detail: detail.value,
                  ...(evidence && { evidence })
                }
              });

              if (!active) return false;

              if (!result.ok) {
                busy = false;
                select.disabled = false;
                detail.disabled = false;
                status.hidden = false;

                return false;
              }

              toast({ type: "success", text: "report.success" });

              return true;
            }
          }
        ]
      });
    } finally {
      active = false;
      request?.abort();
    }
  });
}
