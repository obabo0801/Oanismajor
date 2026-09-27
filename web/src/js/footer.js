import * as dom from "#common/dom";
import toolbar from "#common/toolbar";

const items = [];

export default function footer(app) {
  if (!items.length) return;

  const root = toolbar(items, { compact: true });

  root.className = "footer";
  dom.remove(root, "data-blur");
  dom.remove(root, "data-shadow");
  app.append(root);
}
