import * as dom from "#common/dom";
import vibrate from "#common/vibrate";

let paused = 0;

export const pause = () => {
  paused += 1;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      paused = Math.max(0, paused - 1);
    });
  });
};

export function scrollable(node) {
  let item = node instanceof Element ? node : null;

  const layer = item?.closest("dialog[open]");

  while (item && item !== dom.body) {
    if (item instanceof HTMLElement && !item.hidden) {
      const style = getComputedStyle(item);
      const x =
        item.scrollWidth > item.clientWidth + 1 && ["auto", "scroll"].includes(style.overflowX);

      const y =
        item.scrollHeight > item.clientHeight + 1 && ["auto", "scroll"].includes(style.overflowY);

      if (x || y) {
        return item;
      }
    }

    item = item.parentElement;
  }

  return layer ? null : dom.scroller;
}

export default function scroll() {
  const previous = new WeakMap();
  const bound = (target) => {
    const max = target.scrollHeight - target.clientHeight;

    if (max <= 1) {
      return null;
    }

    if (target.scrollTop <= 1) {
      return "top";
    }

    if (target.scrollTop >= max - 1) {
      return "bottom";
    }

    return null;
  };

  if (dom.scroller) {
    previous.set(dom.scroller, { top: dom.scroller.scrollTop, edge: bound(dom.scroller) });
  }

  dom.on(
    document,
    "scroll",
    (event) => {
      const target = event.target === document ? dom.scroller : event.target;

      if (
        !(target instanceof HTMLElement) ||
        (target !== dom.scroller && (!dom.has("wearable") || !target.closest("dialog[open]")))
      ) {
        return;
      }

      const position = bound(target);
      const last = previous.get(target) ?? { top: 0, edge: "top" };

      if (!paused && position && position !== last.edge && target.scrollTop !== last.top) {
        vibrate.play("touch");
      }

      previous.set(target, { top: target.scrollTop, edge: position });
    },
    { passive: true, capture: true }
  );
}
