import * as css from "#common/css";
import * as dom from "#common/dom";

const types = new Set(["text", "search", "email", "password", "tel", "url", "number"]);

export default function fit(element) {
  const view = window.visualViewport;

  if (
    !view ||
    !dom.has("mobile") ||
    dom.has("wearable") ||
    dom.get(element, "data-fullscreen") !== null
  ) {
    return () => {};
  }

  let frame;
  let previous = "";

  const reset = () => {
    if (!previous) return;

    previous = "";
    dom.remove(element, "data-keyboard");
    css.set(element, { "--dialog-top": null, "--dialog-height": null });
  };

  const update = () => {
    frame = undefined;

    const active = document.activeElement;

    if (!element.open || !element.contains(active)) {
      reset();

      return;
    }

    if (Math.abs(view.scale - 1) > 0.01) return;

    const height = Math.round(view.height);
    const top = Math.max(0, Math.round(view.offsetTop));
    const layout = Math.max(dom.root.clientHeight, window.innerHeight);
    const input =
      active.matches("textarea, input") &&
      !active.disabled &&
      !active.readOnly &&
      active.inputMode !== "none" &&
      (active.matches("textarea") || types.has(active.type));

    if (layout - height < 100 || (!input && !previous)) {
      reset();

      return;
    }

    const next = `${top}:${height}`;

    if (next === previous) return;

    previous = next;
    css.set(element, { "--dialog-top": `${top}px`, "--dialog-height": `${height}px` });

    dom.set(element, "data-keyboard", "");
  };

  const schedule = () => {
    frame ??= requestAnimationFrame(update);
  };

  const off = [
    dom.on(view, "resize", schedule),
    dom.on(view, "scroll", schedule),
    dom.on(window, "resize", schedule),
    dom.on(element, "focusin", schedule),
    dom.on(element, "focusout", schedule)
  ];

  schedule();

  return () => {
    off.forEach((remove) => remove());
    cancelAnimationFrame(frame);
  };
}
