import * as dom from "#common/dom";

export default function double(element, { scale, point, zoom, enabled = () => true }) {
  const pointers = new Set();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  let press;
  let tap;
  let frame;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = null;
  };

  const cancel = () => {
    stop();
    press = null;
    tap = null;
  };

  const animate = (center) => {
    const start = scale();
    const end = start > 1.01 ? 1 : 2;
    const time = performance.now();

    const step = (now) => {
      const progress = reduce.matches ? 1 : Math.min(1, (now - time) / 240);
      const ease = 1 - (1 - progress) ** 3;

      zoom(start + (end - start) * ease, center);
      frame = progress < 1 ? requestAnimationFrame(step) : null;
    };

    stop();
    frame = requestAnimationFrame(step);
  };

  const moved = (event, from) => Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;

  const release = (event) => {
    if (!pointers.delete(event.pointerId)) {
      return;
    }

    const current = press;

    press = null;

    if (
      event.type !== "pointerup" ||
      pointers.size ||
      !current ||
      current.id !== event.pointerId ||
      moved(event, current) ||
      event.timeStamp - current.time > 300
    ) {
      tap = null;

      return;
    }

    if (
      tap &&
      tap.type === event.pointerType &&
      event.timeStamp - tap.time <= 300 &&
      !moved(event, tap)
    ) {
      tap = null;
      event.preventDefault();
      animate(point(event));
    } else {
      tap = { x: event.clientX, y: event.clientY, time: event.timeStamp, type: event.pointerType };
    }
  };

  const off = [
    dom.on(
      element,
      "pointerdown",
      (event) => {
        if (
          !enabled() ||
          event.button !== 0 ||
          event.target.closest?.("button, .image-view-preview")
        ) {
          return;
        }

        event.preventDefault();
        stop();
        pointers.add(event.pointerId);
        press =
          pointers.size === 1
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp }
            : null;

        if (!press) {
          tap = null;
        }
      },
      true
    ),
    dom.on(
      element,
      "pointermove",
      (event) => {
        if (press?.id === event.pointerId && moved(event, press)) {
          press = null;
          tap = null;
        }
      },
      true
    ),
    ...["pointerup", "pointercancel", "lostpointercapture"].map((type) =>
      dom.on(element, type, release, true)
    ),
    dom.on(element, "wheel", cancel, { capture: true, passive: true }),
    ...["selectstart", "dragstart", "dblclick"].map((type) =>
      dom.on(element, type, (event) => event.preventDefault(), true)
    ),
    dom.on(window, "resize", cancel)
  ];

  return {
    cancel,
    destroy: () => {
      cancel();
      pointers.clear();
      off.forEach((remove) => remove());
    }
  };
}
