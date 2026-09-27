import * as css from "#common/css";
import * as dom from "#common/dom";

const clamp = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);

export default function progress(options = {}) {
  if (typeof options === "number") {
    options = { value: options };
  }

  const type = options.type === "circular" ? "circular" : "linear";
  const root = dom.create("div");
  const track = dom.create("div");
  const fill = dom.create("div");
  const output = dom.create("output");

  root.className = "progress";
  dom.set(root, "data-progress", type);
  track.className = "progress-track";
  fill.className = "progress-fill";
  output.className = "progress-value";
  output.hidden = options.show === false;
  track.append(fill);
  root.append(track, output);

  let value = 0;

  const set = (next) => {
    value = clamp(next);

    css.set(root, { "--progress": `${value}%` });

    output.value = `${Math.round(value)}%`;

    return value;
  };

  set(options.value);
  options.target?.append(root);

  return {
    element: root,
    get: () => value,
    set,
    destroy: () => {
      css.remove(root);
      root.remove();
    }
  };
}
