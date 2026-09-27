import * as dom from "#common/dom";

export const clear = (target) => {
  target?.replaceChildren();
};

export default function write(target, value, type = "log") {
  if (!(target instanceof Element)) {
    return null;
  }

  const line = dom.create("div");

  line.className = "console-line";
  line.textContent = String(value ?? "");
  dom.set(line, "data-console", type);

  target.append(line);
  target.scrollTop = target.scrollHeight;

  return line;
}
