import * as css from "#common/css";
import * as dom from "#common/dom";
import * as pointer from "#common/pointer";
import vibrate from "#common/vibrate";

const stages = ["peek", "half", "full"];

const index = (value) => {
  const result = stages.indexOf(value);

  return result < 0 ? 1 : result;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const points = () => {
  const height = window.innerHeight;
  const rem = Number.parseFloat(getComputedStyle(dom.root).fontSize) || 16;
  const half = height * 0.5;
  const peek = Math.min(half, Math.min(rem * 12, Math.max(rem * 6, height * 0.2)));

  return [peek, half, height * 0.9];
};

const nearest = (height, sizes) => {
  const target = sizes.reduce((result, size) =>
    Math.abs(size - height) < Math.abs(result - height) ? size : result
  );

  return Math.abs(target - height) <= 48 ? target : height;
};

export default function snap(element, options = {}) {
  const initial = index(options.stage);

  let sizes = points();
  let height = sizes[initial];
  let resizeFrame;
  let gesture = null;
  let dragged = false;

  const render = (value) => {
    height = clamp(value, sizes[0], sizes[2]);
    css.set(element, { "--sheet-height": `${height}px` });
  };

  const configure = () => {
    const ratio = sizes[2] ? height / sizes[2] : 1;

    sizes = points();
    render(nearest(sizes[2] * ratio, sizes));
  };

  const blocked = (step) => {
    const top = element.scrollTop;
    const max = element.scrollHeight - element.clientHeight;
    const up = step > 0;
    const full = height >= sizes[2] - 1;
    const scrolling = full && (up ? top < max : top > 0);

    return (up && full) || scrolling;
  };

  const resize = () => {
    if (gesture || resizeFrame) {
      return;
    }

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;

      if (!gesture) {
        configure();
      }
    });
  };

  const stop = () => {
    const current = gesture;

    gesture = null;
    dom.remove(element, "data-swipe");

    if (current?.mouse && element.hasPointerCapture?.(current.id)) {
      element.releasePointerCapture(current.id);
    }
  };

  const finish = (y, cancelled = false) => {
    if (!gesture) {
      return;
    }

    const { from, startY, moving } = gesture;

    stop();

    if (!moving) {
      configure();

      return;
    }

    if (cancelled) {
      render(from);
    } else {
      const next = Number.isFinite(y) ? clamp(from + startY - y, 0, sizes[2]) : height;

      if (next < sizes[0] * 0.5) {
        options.close?.(false, false);

        return;
      }

      const snapped = nearest(next, sizes);

      render(snapped);

      if (from < sizes[2] - 1 && snapped === sizes[2]) {
        vibrate.play(25);
      }
    }

    configure();
  };

  const start = (event, id, x, y, mouse) => {
    if (gesture) return;

    dragged = false;

    if (window.getSelection()?.isCollapsed === false || pointer.blocked(event)) {
      return;
    }

    gesture = {
      id,
      mouse,
      startX: x,
      startY: y,
      from: element.getBoundingClientRect().height,
      up: !blocked(1),
      down: !blocked(-1),
      moving: false
    };
  };

  const move = (event, x, y) => {
    if (!gesture) return;

    if (!gesture.moving) {
      if (event.defaultPrevented || element.hasAttribute("data-swipe")) {
        gesture = null;

        return;
      }

      const dx = x - gesture.startX;
      const dy = y - gesture.startY;

      if (
        Math.abs(dy) < 4 ||
        Math.abs(dx) >= Math.abs(dy) ||
        !(dy < 0 ? gesture.up : gesture.down)
      ) {
        return;
      }

      options.finish?.();
      gesture.moving = true;
      dragged = true;
      dom.set(element, "data-swipe", "");

      if (gesture.mouse) element.setPointerCapture?.(gesture.id);
    }

    window.getSelection()?.removeAllRanges();
    if (event.cancelable) event.preventDefault();

    height = clamp(gesture.from + gesture.startY - y, 0, sizes[2]);
    css.set(element, { "--sheet-height": `${height}px` });
  };

  const touchStart = (event) => {
    if (event.touches.length !== 1) {
      finish(undefined, true);

      return;
    }

    const touch = event.touches[0];

    start(event, touch.identifier, touch.clientX, touch.clientY, false);
  };

  const touchMove = (event) => {
    if (!gesture || gesture.mouse) return;

    if (event.touches.length !== 1) {
      finish(undefined, true);

      return;
    }

    const touch = [...event.touches].find((item) => item.identifier === gesture.id);

    if (touch) move(event, touch.clientX, touch.clientY);
  };

  const touchEnd = (event) => {
    if (!gesture || gesture.mouse) return;

    const touch = [...event.changedTouches].find((item) => item.identifier === gesture.id);

    if (touch) finish(touch.clientY, event.type === "touchcancel");
  };

  const pointerStart = (event) => {
    if (pointer.press(event)) {
      start(event, event.pointerId, event.clientX, event.clientY, true);
    }
  };

  const pointerMove = (event) => {
    if (gesture?.mouse && pointer.match(event, gesture.id)) {
      move(event, event.clientX, event.clientY);
    }
  };

  const pointerEnd = (event) => {
    if (gesture?.mouse && pointer.match(event, gesture.id)) {
      finish(event.clientY, event.type !== "pointerup");
    }
  };

  const click = (event) => {
    if (!dragged) return;

    event.preventDefault();
    event.stopPropagation();
    dragged = false;
  };

  render(height);

  const remove = [
    dom.on(element, "touchstart", touchStart, { passive: true }),
    dom.on(element, "touchmove", touchMove, { passive: false }),
    dom.on(element, "touchend", touchEnd, { passive: true }),
    dom.on(element, "touchcancel", touchEnd, { passive: true }),
    dom.on(element, "pointerdown", pointerStart),
    dom.on(window, "pointermove", pointerMove),
    dom.on(window, "pointerup", pointerEnd),
    dom.on(window, "pointercancel", pointerEnd),
    dom.on(element, "lostpointercapture", pointerEnd),
    dom.on(element, "click", click, true),
    dom.on(window, "resize", resize)
  ];

  return () => {
    remove.forEach((off) => off());
    cancelAnimationFrame(resizeFrame);
    stop();
    dragged = false;
    css.set(element, { "--sheet-height": null });
  };
}
