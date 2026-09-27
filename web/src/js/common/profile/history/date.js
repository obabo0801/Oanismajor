import * as dom from "#common/dom";
import * as picker from "#common/picker";
import * as time from "#common/chatting/time";

export default function date(input) {
  const root = dom.create("div");
  const today = time.day(new Date());
  const parts = (input.value || today).split("-").map(Number);
  const limits = [
    [1900, Math.max(Number(today.slice(0, 4)), parts[0])],
    [1, 12],
    [1, 31]
  ];

  root.className = "picker";
  input.type = "hidden";

  const columns = limits.map(([min, max], index) => {
    const column = dom.create("div");

    column.className = "picker-column";
    dom.set(column, "data-min", min);
    dom.set(column, "data-max", max);
    dom.set(column, "data-value", parts[index]);
    dom.set(column, "data-name", `history-${["year", "month", "day"][index]}`);
    root.append(column);
    if (index < 2) {
      const separator = dom.create("span");

      separator.className = "picker-text";
      separator.textContent = "-";
      root.append(separator);
    }

    return column;
  });

  const sync = () => {
    const [year, month, day] = columns.map((column) => Number(dom.get(column, "data-value")));
    const max = new Date(Date.UTC(year, month, 0)).getUTCDate();

    if (Number(dom.get(columns[2], "data-max")) !== max) {
      dom.set(columns[2], "data-max", max);
      picker.update(columns[2]);
    }

    dom.set(columns[2], "data-value", Math.min(day, max));
    input.value = [year, month, Math.min(day, max)]
      .map((value, index) => String(value).padStart(index ? 2 : 4, "0"))
      .join("-");

    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  columns.forEach((column) => dom.on(column, "change", sync));
  sync();

  return root;
}
