import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import dialog from "#common/dialog";
import toolbar, { badge } from "#common/toolbar";
import * as time from "#common/chatting/time";
import { date } from "#shared/chatting";
import calendar from "#common/profile/history/date";

i18n.preload(
  "profile.historySearch",
  "profile.historyDate",
  "profile.historyType",
  "profile.historyAll",
  "profile.cancel",
  "profile.confirm",
  "image.reset"
);

export const append = (list, entries, render) => {
  for (const entry of entries) {
    let day = "";

    try {
      if (entry.time) day = time.day(entry.time);
    } catch {}

    let section = list.lastElementChild;

    if (!section || dom.get(section, "data-date") !== day) {
      section = dom.create("section");

      const heading = dom.create("h3");
      const records = dom.create("div");

      section.className = "history-day";
      dom.set(section, "data-date", day);
      heading.className = "history-date";
      if (day) heading.textContent = time.label(`${day} 00:00:00`);

      records.className = "profile-section";
      if (day) section.append(heading);

      section.append(records);
      list.append(section);
    }

    section.lastElementChild.append(render(entry));
  }
};

export function create(change, types = {}, kind = "action") {
  const values = { search: "", date: "", [kind]: "" };
  const entries = [
    ["search", "search", "profile.historySearch"],
    ["date", "calendar", "profile.historyDate"],
    ...(Object.keys(types).length ? [[kind, "setting", "profile.historyType"]] : [])
  ];

  const root = toolbar(
    entries.map(([name, icon, text]) => ({
      icon,
      text,
      run: async (button) => {
        if ((name === "search" || name === "date") && values[name]) {
          values[name] = "";
          dom.remove(button, "data-selected");
          badge(button);
          change();

          return;
        }

        const field = dom.create("div");
        const input = dom.create(name === kind ? "select" : "input");

        field.className = name === kind ? "select" : name === "date" ? "" : "input";

        input.name = `history-${name}`;
        if (name === kind) {
          for (const [value, key] of Object.entries({ "": "profile.historyAll", ...types })) {
            const option = dom.create("option");

            option.value = value;
            option.textContent = i18n.message(key);
            dom.set(option, "data-i18n", key);
            input.append(option);
          }
        } else if (name !== "date") {
          input.type = name;
          input.maxLength = 100;
          input.enterKeyHint = "done";
          dom.set(input, "data-control", "");
          dom.set(input, "data-i18n-placeholder", text);
        }

        input.value = values[name];
        if (name === "date") field.append(calendar(input));

        field.append(input);

        const result = await dialog({
          title: text,
          content: field,
          direction: "→",
          actions: [
            { text: "profile.cancel", icon: "close", value: false, data: ["data-neutral"] },
            { text: "image.reset", icon: "reload", value: "reset" },
            {
              text: "profile.confirm",
              icon: "check",
              value: true,
              submit: true,
              data: ["data-confirm"],
              disabled: () => name === "date" && Boolean(input.value) && !date(input.value)
            }
          ]
        });

        if (result !== true && result !== "reset") return;

        values[name] = result === "reset" ? "" : input.value.trim();
        if (values[name]) dom.set(button, "data-selected", "");
        else dom.remove(button, "data-selected");

        change();
      }
    }))
  );

  root.classList.add("history-tools");

  const count = (total) => {
    entries.forEach(([name], index) => {
      badge(root.children[index], values[name] ? total : undefined);
    });
  };

  return { root, values, count };
}
