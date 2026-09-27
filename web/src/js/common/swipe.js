import { on } from "#common/dom";
import { listen } from "#common/drag";
import * as pointer from "#common/pointer";
import viewport from "#common/viewport";

const directions = {
  right: "→",
  "bottom-right": "↘",
  bottom: "↓",
  "bottom-left": "↙",
  left: "←",
  "top-left": "↖",
  top: "↑",
  "top-right": "↗"
};

const vectors = {
  "→": [1, 0],
  "↘": [1, 1],
  "↓": [0, 1],
  "↙": [-1, 1],
  "←": [-1, 0],
  "↖": [-1, -1],
  "↑": [0, -1],
  "↗": [1, -1]
};
const arrows = Object.values(directions);
const ignored = "input, select, textarea, [contenteditable]";
const handlers = [];

let point = null;
let off = [];

function hasSelection() {
  const selection = window.getSelection();

  if (selection && !selection.isCollapsed) {
    return true;
  }

  const active = document.activeElement;

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.selectionStart !== active.selectionEnd;
  }

  return false;
}

function arrow(x, y) {
  const angle = Math.atan2(y, x) / (Math.PI / 4);
  const index = (Math.round(angle) + 8) % 8;

  return arrows[index];
}

function minimum() {
  const { width, height } = viewport();

  return Math.min(width, height) * 0.15;
}

function trigger(x, y, event) {
  if (hasSelection() || Math.hypot(x, y) < minimum()) {
    return;
  }

  const value = arrow(x, y);

  [...handlers].forEach((handler) => {
    if (handler.arrow === value) {
      handler.callback(event);
    }
  });
}

function start(event) {
  if (event.touches.length !== 1 || hasSelection()) {
    point = null;

    return;
  }

  const touch = event.touches[0];

  point = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
}

function end(event) {
  if (!point || hasSelection()) {
    point = null;

    return;
  }

  const touch = [...event.changedTouches].find((item) => item.identifier === point.id);

  if (!touch) {
    return;
  }

  const x = touch.clientX - point.x;
  const y = touch.clientY - point.y;

  point = null;
  trigger(x, y, event);
}

function cancel() {
  point = null;
}

function watch() {
  if (off.length) {
    return;
  }

  const options = { passive: true };

  off = [
    on(document, "touchstart", start, options),
    on(document, "touchend", end, options),
    on(document, "touchcancel", cancel, options),

    listen((x, y, event) => {
      trigger(x, y, event);
    })
  ];
}

function unwatch() {
  if (handlers.length) {
    return;
  }

  off.forEach((run) => {
    run();
  });

  off = [];
  point = null;
}

function size(target, direction) {
  const [x, y] = vectors[direction];

  if (!y) {
    return target.clientWidth;
  }

  if (!x) {
    return target.clientHeight;
  }

  return Math.hypot(target.clientWidth, target.clientHeight);
}

function distance(direction, x, y) {
  const [moveX, moveY] = vectors[direction];
  const diagonal = moveX !== 0 && moveY !== 0;
  const value = x * moveX + y * moveY;

  return diagonal ? value / Math.SQRT2 : value;
}

function match(direction, x, y) {
  const horizontal = Math.abs(x) >= Math.abs(y);

  switch (direction) {
    case "←":
      return x < 0 && horizontal;

    case "→":
      return x > 0 && horizontal;

    case "↑":
      return y < 0 && !horizontal;

    case "↓":
      return y > 0 && !horizontal;

    default:
      return arrow(x, y) === direction;
  }
}

function blocked(event, selector) {
  const custom = typeof selector === "function" ? selector(event) : selector;

  if (custom === true) return true;
  const value = custom ? `${ignored}, ${custom}` : ignored;

  return event.target.closest?.(value);
}

function progress(direction, options) {
  const { target, start, move, reach, end } = options;
  const { ignore, length, ratio } = options;

  if (!(target instanceof Element)) {
    return () => {};
  }

  let id = undefined;
  let startX = 0;
  let startY = 0;
  let moving = false;
  let reached = false;
  let dragged = false;
  let value = 0;
  let source;

  const scrolling = (x, y) => {
    if (!options.scroll) return false;
    const horizontal = Math.abs(x) >= Math.abs(y);
    const delta = horizontal ? x : y;

    for (let node = source; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflow = horizontal ? style.overflowX : style.overflowY;
      const position = horizontal ? node.scrollLeft : node.scrollTop;
      const maximum = horizontal
        ? node.scrollWidth - node.clientWidth
        : node.scrollHeight - node.clientHeight;

      if (
        ["auto", "scroll"].includes(overflow) &&
        (delta < 0 ? position < maximum - 1 : position > 1)
      ) {
        return true;
      }

      if (node === target) break;
    }

    return false;
  };

  const limit = () => {
    const result = Number(typeof ratio === "function" ? ratio() : ratio);

    return Number.isFinite(result) ? result : 0.35;
  };

  const prepare = (nextId, x, y) => {
    id = nextId;
    startX = x;
    startY = y;
    moving = false;
    reached = false;
    value = 0;
  };

  const reset = () => {
    id = undefined;
    source = undefined;
    moving = false;
    reached = false;
    value = 0;
  };

  const finish = (event, cancelled = false) => {
    const active = moving;
    const complete = !cancelled && active && value >= limit();
    const current = value;

    reset();

    if (active) {
      end?.(complete, current, event, cancelled);
    }
  };

  const update = (x, y, event) => {
    if (!moving) {
      if (event.defaultPrevented) {
        reset();

        return false;
      }

      if (Math.hypot(x, y) < 4) {
        return false;
      }

      if (!match(direction, x, y)) {
        return false;
      }

      if (scrolling(x, y)) {
        reset();

        return false;
      }

      if (options.accept?.(event) === false) {
        reset();

        return false;
      }

      window.getSelection()?.removeAllRanges();

      moving = true;
      dragged = true;

      start?.(event);
    } else if (hasSelection()) {
      window.getSelection()?.removeAllRanges();
    }

    const amount = typeof length === "function" ? length() : length;
    const total = Number(amount) || size(target, direction);

    value = total ? Math.min(1, Math.max(0, distance(direction, x, y) / total)) : 0;

    move?.(value, event);

    if (value < limit()) {
      reached = false;
    } else if (!reached) {
      reached = true;
      reach?.(event);
    }

    return true;
  };

  const touchStart = (event) => {
    if (event.touches.length !== 1) {
      finish(event, true);

      return;
    }

    if (hasSelection() || blocked(event, ignore)) {
      return;
    }

    const touch = event.touches[0];

    dragged = false;
    source = event.target;
    prepare(touch.identifier, touch.clientX, touch.clientY);
  };

  const touchMove = (event) => {
    const touch = [...event.touches].find((item) => item.identifier === id);

    if (!touch) {
      return;
    }

    const x = touch.clientX - startX;
    const y = touch.clientY - startY;

    if (update(x, y, event)) {
      event.preventDefault();
    }
  };

  const touchEnd = (event) => {
    if (id === undefined) {
      return;
    }

    const touch = [...event.changedTouches].find((item) => item.identifier === id);

    if (!touch) {
      return;
    }

    if (moving) {
      update(touch.clientX - startX, touch.clientY - startY, event);
    }

    finish(event);
  };

  const touchCancel = (event) => {
    if (id === undefined) {
      return;
    }

    finish(event, true);
  };

  const pointerStart = (event) => {
    if (event.isPrimary) {
      dragged = false;
    }

    if (!pointer.press(event) || hasSelection() || blocked(event, ignore)) {
      return;
    }

    source = event.target;
    prepare(event.pointerId, event.clientX, event.clientY);
  };

  const pointerMove = (event) => {
    if (!pointer.match(event, id)) {
      return;
    }

    const x = event.clientX - startX;
    const y = event.clientY - startY;

    if (update(x, y, event)) {
      event.preventDefault();
    }
  };

  const pointerEnd = (event) => {
    if (!pointer.match(event, id)) {
      return;
    }

    if (moving) {
      update(event.clientX - startX, event.clientY - startY, event);
    }

    finish(event);
  };

  const pointerCancel = (event) => {
    if (!pointer.match(event, id)) {
      return;
    }

    finish(event, true);
  };

  const click = (event) => {
    if (!dragged) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragged = false;
  };

  const listeners = [
    on(target, "touchstart", touchStart, { passive: true }),
    on(target, "touchmove", touchMove, { passive: false }),
    on(target, "touchend", touchEnd, { passive: true }),
    on(target, "touchcancel", touchCancel, { passive: true }),
    on(target, "pointerdown", pointerStart),
    on(window, "pointermove", pointerMove),
    on(window, "pointerup", pointerEnd),
    on(window, "pointercancel", pointerCancel),
    on(target, "click", click, true)
  ];

  return () => {
    listeners.forEach((run) => {
      run();
    });

    reset();
    dragged = false;
  };
}

function simple(direction, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  const handler = { arrow: direction, callback };

  handlers.push(handler);
  watch();

  return () => {
    const index = handlers.indexOf(handler);

    if (index >= 0) {
      handlers.splice(index, 1);
    }

    unwatch();
  };
}

export function resolve(direction) {
  const name = String(direction).trim().toLowerCase();

  return directions[name] ?? (arrows.includes(name) ? name : null);
}

export default function swipe(direction, callback) {
  const value = resolve(direction);

  if (!value) {
    return () => {};
  }

  if (callback && typeof callback === "object") {
    return progress(value, callback);
  }

  return simple(value, callback);
}
