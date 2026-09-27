import context from "#common/context";
import * as assets from "#common/chatting/asset";
import * as manage from "#common/chatting/manage";
import * as dom from "#common/dom";
import sheet from "#common/sheet";

export { link, copy as copyLink } from "#common/chatting/manage";

const opened = new WeakSet();

const open = async (message, options) => {
  if (opened.has(message)) return;

  opened.add(message);
  dom.set(message, "data-action", "");
  try {
    let menu;

    const value = await sheet({
      route: options.url
        ? ["target", `/?message=${encodeURIComponent(options.url)}`]
        : ["target", `${location.pathname}?message=${encodeURIComponent(options.token || "")}`],
      direction: "↓",
      content: async () => {
        menu = await manage.menu(message, options);
        return { content: menu.root, dispose: menu.off };
      }
    });

    await menu?.run(value);
  } finally {
    dom.remove(message, "data-action");
    opened.delete(message);
  }
};

export default function action(message, options) {
  manage.bind(message, options);
  for (const node of dom.all(".chatting-text a.link, .chatting-text .embed", message)) {
    const anchor = node.matches("a") ? node : dom.query(".embed-title", node);

    if (!anchor?.href) continue;

    assets.bind(
      node,
      {
        kind: "link",
        url: anchor.href,
        name: anchor.textContent,
        sender: options,
        time: options.time,
        message
      },
      false
    );
  }

  context(message, (event) => {
    if (message.hasAttribute("data-deleted") && !manage.allowed(message, options)) return;
    const quick =
      event?.shiftKey &&
      options.own &&
      !message.hasAttribute("data-deleted") &&
      manage.allowed(message, options);

    if (quick) {
      manage.change(message, options, undefined, true).catch(console.error);
      return;
    }

    const target = assets.find(event?.target) || assets.single(message);

    if (target && message.contains(target)) {
      assets.open(target).catch(console.error);
      return;
    }

    open(message, options).catch(console.error);
  });
}
