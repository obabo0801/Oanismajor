import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as clock from "../chatting/time.js";
import dialog from "#common/dialog";
import toast from "#common/toast";

i18n.preload("profile.copy", "profile.copied", "profile.copyError");

export default function label(key, value, { short = false, date = false, icon = "" } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const full = String(value);
  const compact = short && full.length > 13;
  const row = dom.create("div");
  const element = dom.create("div");
  const name = dom.create("span");
  const result = dom.create("div");
  const text = dom.create(short ? "button" : "span");

  row.className = "group-item";
  if (icon) {
    dom.set(row, "data-icon", icon);
    dom.set(row, "data-color", "");
  }

  element.className = "label";
  name.className = "label-key";
  result.className = "label-content";
  text.className = "label-value";
  name.textContent = i18n.message(key);
  dom.set(name, "data-i18n", key);

  text.textContent = date ? clock.datetime(value, date === "seconds") : full;

  result.append(text);
  if (short) {
    text.type = "button";
    text.textContent = compact ? `${full.slice(0, 8)}…${full.slice(-4)}` : full;

    dom.set(text, "data-response", "");
    dom.on(text, "click", async () => {
      const content = dom.create("p");

      content.className = "profile-id";
      content.textContent = full;
      await dialog({
        title: key,
        content,
        direction: "→",
        actions: [{ text: "profile.confirm", icon: "check", data: ["data-confirm"] }]
      });
    });

    const copy = dom.create("button");

    copy.type = "button";
    copy.className = "label-copy";
    dom.set(copy, "data-icon", "copy");
    dom.set(copy, "data-color", "");
    dom.set(copy, "data-tooltip", "profile.copy");
    dom.set(copy, "data-response", "");
    dom.on(copy, "click", async () => {
      if (copy.disabled) return;

      copy.disabled = true;
      try {
        await navigator.clipboard.writeText(full);
        toast({ type: "success", title: "profile.copied" });
      } catch {
        toast({ type: "error", title: "profile.copyError" });
      } finally {
        copy.disabled = false;
      }
    });

    result.append(copy);
  }

  element.append(name, result);
  row.append(element);

  return row;
}
