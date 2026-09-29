import * as css from "#common/css";
import * as dom from "#common/dom";
import * as i18n from "#common/i18n";

const selector = "[data-tooltip], [title]";

let tip;
let source;
let closing;
let timeout;

i18n.register("data-tooltip", () => {});

const convert = (element) => {
  const title = dom.get(element, "title");

  if (title === null) {
    return element;
  }

  if (dom.get(element, "data-tooltip") === null && title.trim()) {
    dom.set(element, "data-tooltip", title.trim());
  }

  dom.remove(element, "title");

  return element;
};

const content = (element) => {
  const key = dom.get(element, "data-tooltip")?.trim();

  const value = key ? i18n.message(key) || key : "";
  const shortcut = dom.get(element, "data-key");

  return value && shortcut ? `${value} (${shortcut})` : value;
};

export const hide = (element = source) => {
  if (element !== source) {
    return;
  }

  dom.remove(source, "data-feedback");
  source = null;
  clearTimeout(timeout);
  dom.remove(tip, "data-open");
  clearTimeout(closing);
  closing = setTimeout(() => {
    if (!source && tip?.matches(":popover-open")) tip.hidePopover();
  }, 120);
};

const place = () => {
  if (!source?.isConnected || source.closest("[hidden]") || !tip) {
    hide();

    return;
  }

  const thumb = source.matches(".player-level input")
    ? source.closest(".range")?.querySelector(".range-thumb")
    : null;
  const target = (thumb || source).getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const viewport = dom.root;
  const gap = 8;
  const edge = 8;
  const above = target.top - gap - edge;
  const under = viewport.clientHeight - target.bottom - gap - edge;
  const below = above < height && under > above;
  const center = target.left + target.width / 2;
  const anchor = source.matches(".chatting-time") ? target.left : center - width / 2;

  const left = Math.max(edge, Math.min(viewport.clientWidth - width - edge, anchor));

  const top = Math.max(
    edge,
    Math.min(
      viewport.clientHeight - height - edge,
      below ? target.bottom + gap : target.top - height - gap
    )
  );

  const arrow = Math.min(width - 12, Math.max(12, center - left));

  css.set(tip, { left: `${left}px`, top: `${top}px`, "--tooltip-arrow": `${arrow}px` });

  dom.set(tip, "data-side", below ? "bottom" : "top");
};

const show = (element, text) => {
  if (!tip || !element.isConnected || element.closest("[hidden], dialog:not([open])")) return;

  element = convert(element);

  const value = text ?? content(element);

  if (!value) {
    hide();

    return;
  }

  clearTimeout(closing);
  clearTimeout(timeout);
  dom.remove(source, "data-feedback");
  if (source !== element && tip.matches(":popover-open")) tip.hidePopover();

  source = element;
  tip.textContent = value;
  if (!tip.matches(":popover-open")) tip.showPopover();

  place();
  dom.set(tip, "data-open", "");
};

export function flash(element, text) {
  if (!element) return;

  show(element, text);
  if (source === element) {
    dom.set(element, "data-feedback", "");
    timeout = setTimeout(() => hide(element), 1000);
  }
}

const target = (event) => event.target.closest?.(selector);
const enter = (event) => {
  const element = target(event);

  if (!element || element.contains(event.relatedTarget)) {
    return;
  }

  show(element);
};

const leave = (event) => {
  const element = target(event);

  if (!element || element.contains(event.relatedTarget)) {
    return;
  }

  hide(element);
};

export default function tooltip() {
  dom.all("[title]").forEach(convert);

  const wrap = dom.create("div");

  let press;
  let blocked;
  let keyboard = true;

  const cancel = () => {
    if (!press) return;

    clearTimeout(press.timer);
    press.cancelled = true;
    hide(press.element);
  };

  const finish = (event) => {
    if (!press || (event && event.pointerId !== press.id)) return;

    const previous = press;

    cancel();
    press = undefined;
    if (previous.shown) {
      blocked = { element: previous.element, until: performance.now() + 800 };
    }
  };

  const start = (event) => {
    keyboard = false;
    blocked = undefined;
    if (press) {
      cancel();

      return;
    }

    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;

    hide();

    const element = target(event);

    if (!element || event.isPrimary === false || event.button !== 0) return;

    const current = {
      id: event.pointerId,
      element: convert(element),
      x: event.clientX,
      y: event.clientY,
      shown: false,
      cancelled: false
    };

    press = current;
    current.timer = setTimeout(() => {
      if (press !== current || current.cancelled || !element.isConnected) return;

      show(element);
      current.shown = source === element;
    }, 500);
  };

  const move = (event) => {
    if (!press || event.pointerId !== press.id) return;

    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancel();
  };

  const click = (event) => {
    if (!blocked || performance.now() > blocked.until) return;

    if (!event.pointerType && event.detail === 0) return;

    if (event.pointerType && !["touch", "pen"].includes(event.pointerType)) return;

    if (!blocked.element.contains(event.target)) return;

    blocked = undefined;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const update = () => {
    cancel();
    place();
  };

  tip = dom.create("div");
  tip.className = "tooltip";
  dom.set(tip, "popover", "manual");
  dom.set(tip, "data-background", "");
  dom.set(tip, "data-shadow", "");
  wrap.append(tip);
  dom.body.append(wrap);

  dom.on(document, "pointerover", (event) => {
    if (event.pointerType === "mouse") enter(event);
  });

  dom.on(document, "pointerout", (event) => {
    if (event.pointerType === "mouse") leave(event);
  });

  dom.on(document, "focusin", (event) => {
    if (keyboard) enter(event);
  });

  dom.on(document, "focusout", leave);
  dom.on(
    document,
    "close",
    (event) => {
      if (source && event.target.contains(source)) hide();
    },
    true
  );

  const observer = new MutationObserver(() => {
    if (source && !source.isConnected) hide();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  dom.on(
    document,
    "keydown",
    () => {
      keyboard = true;
    },
    true
  );

  dom.on(document, "pointerdown", start, true);
  dom.on(document, "pointermove", move, true);
  dom.on(document, "pointerup", finish, true);
  dom.on(document, "pointercancel", finish, true);
  dom.on(document, "lostpointercapture", finish, true);
  dom.on(window, "click", click, true);
  dom.on(document, "contextmenu", (event) => {
    if (press && !press.cancelled && press.element.contains(event.target)) {
      event.preventDefault();
    }
  });

  dom.on(document, "scroll", update, true);
  dom.on(window, "resize", update);
  dom.on(window, "blur", () => {
    finish();
    hide();
  });

  dom.on(document, "visibilitychange", () => {
    if (document.hidden) {
      finish();
      hide();
    }
  });
}
