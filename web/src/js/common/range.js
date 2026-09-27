import * as dom from "#common/dom";
import * as css from "#common/css";
import sound from "#common/sound";

const bound = new WeakSet();
const moving = new WeakMap();
const paint = (input) => {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const size = max - min;
  const percent = size ? Math.min(100, Math.max(0, ((value - min) / size) * 100)) : 0;
  const container = input.closest(".range");
  const fill = dom.query(".range-fill", container);
  const thumb = dom.query(".range-thumb", container);

  if (fill) {
    css.set(fill, { width: `${percent}%` });
  }

  if (thumb) {
    css.set(thumb, { "inset-inline-start": `${percent}%` });
  }
};

export const move = (input, value) => {
  if (!input) {
    return false;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return false;
  }

  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const container = input.closest(".range");

  clearTimeout(moving.get(input));
  dom.set(container, "data-move", "");
  input.value = String(Math.min(max, Math.max(min, number)));

  if (bound.has(input)) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    paint(input);
  }

  const timer = setTimeout(() => {
    dom.remove(container, "data-move");
    moving.delete(input);
  }, 320);

  moving.set(input, timer);

  return true;
};

const play = (input) => {
  const effect = dom.get(input, "data-effect")?.trim();
  const channel = dom.get(input, "data-channel")?.trim();

  if (effect) {
    sound.play(effect, { channel: channel || "system", overlap: true });
  }

  const music = dom.get(input, "data-music")?.trim();

  if (music) {
    sound.music(music);
  }
};

const drag = (input) => {
  const container = input.closest(".range");

  if (!container) {
    return;
  }

  let pointer;

  const update = (event) => {
    const rect = input.getBoundingClientRect();
    const vertical = rect.height > rect.width;
    const length = vertical ? rect.height : rect.width;

    if (!length) return;
    let fraction = vertical
      ? (rect.bottom - event.clientY) / length
      : (event.clientX - rect.left) / length;

    if (!vertical && getComputedStyle(input).direction === "rtl") fraction = 1 - fraction;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = input.step === "any" ? 0 : Number(input.step || 1);

    let value = min + Math.max(0, Math.min(1, fraction)) * (max - min);

    if (step) value = min + Math.round((value - min) / step) * step;

    input.value = String(Math.max(min, Math.min(max, value)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  dom.on(input, "pointerdown", (event) => {
    if (input.disabled || event.button !== 0 || pointer) return;

    event.preventDefault();
    input.focus({ preventScroll: true });
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    input.setPointerCapture(event.pointerId);
    update(event);
  });

  dom.on(input, "pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;

    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 4)
      dom.set(container, "data-drag", "");

    update(event);
  });

  const stop = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;

    pointer = undefined;
    dom.remove(container, "data-drag");
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);

    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  dom.on(input, "pointerup", stop);
  dom.on(input, "pointercancel", stop);
  dom.on(input, "lostpointercapture", stop);
};

export default function range(root = document) {
  dom.find('.range input[type="range"]', root).forEach((input) => {
    paint(input);

    if (bound.has(input)) {
      return;
    }

    dom.on(input, "input", () => {
      paint(input);
      play(input);
    });

    drag(input);
    bound.add(input);
  });
}
