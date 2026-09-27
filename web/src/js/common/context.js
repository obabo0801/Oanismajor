import * as dom from "#common/dom";

export default function context(message, show, ignore = "audio") {
  const pointers = new Set();

  let timer;
  let pointer;
  let held = false;
  let blocked = false;
  let off = [];

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pointer = undefined;
  };

  const stop = () => {
    cancel();
    off.forEach((remove) => remove());
    off = [];
    pointers.clear();
    blocked = false;
  };

  const move = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;

    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) {
      blocked = true;
      cancel();
    }
  };

  const release = (event) => {
    pointers.delete(event.pointerId);
    cancel();
    if (!pointers.size) stop();
  };

  dom.on(message, "pointerdown", (event) => {
    if (event.target.closest?.(ignore) || event.pointerType === "mouse") return;

    if (!pointers.size) {
      off = [
        dom.on(window, "pointermove", move, true),
        dom.on(window, "blur", stop),
        ...["pointerup", "pointercancel", "lostpointercapture"].map((type) =>
          dom.on(window, type, release, true)
        )
      ];
    }

    held = false;
    pointers.add(event.pointerId);
    cancel();
    if (pointers.size !== 1) blocked = true;

    if (blocked) return;

    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      const valid = message.isConnected && pointers.size === 1;

      stop();
      if (!valid) return;

      held = true;
      show(event);
    }, 500);
  });

  dom.on(
    message,
    "click",
    (event) => {
      if (!held) return;

      held = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );

  dom.on(message, "contextmenu", (event) => {
    if (event.target.closest?.(ignore)) return;

    event.preventDefault();
    event.stopPropagation();

    const touch = event.pointerType === "touch" || pointers.size > 0;

    stop();
    if (held) return;

    held = touch;
    show(event);
  });
}
