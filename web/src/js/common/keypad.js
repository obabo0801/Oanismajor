import * as css from "#common/css";
import * as dom from "#common/dom";
import * as back from "#common/back";
import { pause } from "#common/scroll";
import sound from "#common/sound";
import vibrate from "#common/vibrate";

const states = new WeakMap();

let active = null;
let listening = false;

const dismiss = () => {
  const field = active?.field;

  if (!field) {
    return;
  }

  active.close?.(field);
  active = null;
};

export function listen() {
  if (listening) return;

  listening = true;
  dom.on(document, "visibilitychange", () => {
    if (document.hidden) {
      dismiss();
    }
  });

  dom.on(window, "pagehide", dismiss);
}

const empty = Object.freeze({ show() {}, hide() {}, submit() {}, update() {} });

const fields = (root) => (root.matches?.("input") ? [root] : dom.all("input", root));

const source = (field) => (field?.matches?.("input") ? field : dom.query("input", field));

const reveal = (target, keypad) => {
  if (dom.has("wearable")) {
    return;
  }

  dom.set(dom.root, "data-unlock", "");

  target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });

  const bottom = target.getBoundingClientRect().bottom;
  const top = keypad.offsetTop;

  if (bottom > top) {
    dom.scroller.scrollTop += bottom - top + 12;
  }

  dom.remove(dom.root, "data-unlock");
};

const write = (input, value) => {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const length = input.value.length - end + start + 1;
  const max = input.maxLength > 0 ? input.maxLength : Infinity;

  if (length <= max) {
    input.setRangeText(value, start, end, "end");
  }
};

const erase = (input) => {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const from = start === end ? Math.max(0, start - 1) : start;

  input.setRangeText("", from, end, "end");
};

export default function keypad(root, actions = {}) {
  if (!root) {
    return empty;
  }

  if (states.has(root)) {
    return states.get(root);
  }

  const element = dom.create("div");

  element.className = "keypad";

  const state = { element, field: null, fields: () => fields(root), input: source, ...actions };

  let off;

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  keys.forEach((value) => {
    const button = dom.create("button");

    button.type = "button";
    button.value = value;
    button.textContent = value;
    dom.set(button, "data-background", "");
    element.append(button);
  });

  const key = dom.create("button");

  key.type = "button";
  key.className = "keypad-back";
  key.value = "delete";
  dom.set(key, "data-background", "");
  dom.set(key, "data-icon", "delete");
  element.append(key);

  const zero = dom.create("button");

  zero.type = "button";
  zero.value = "0";
  zero.textContent = "0";
  dom.set(zero, "data-background", "");
  element.append(zero);

  const action = dom.create("button");

  action.type = "button";
  action.className = "keypad-action";
  action.value = "action";
  action.disabled = true;
  dom.set(action, "data-background", "");
  dom.set(action, "data-icon", "arrow");
  element.append(action);

  if (dom.has("wearable")) {
    dom.set(key, "data-circle", "");
    dom.set(key, "data-scale", "");
    dom.set(action, "data-circle", "");
    dom.set(action, "data-scale", "");
  }

  const update = (field) => {
    const input = state.input(field);

    if (!input) {
      return;
    }

    const filled = input.value.trim().length > 0;
    const valid = filled && (state.valid?.(input) ?? true);
    const signed = Number(input.min) < 0;

    let icon = signed ? "minus" : "close";

    if (filled) {
      icon = "delete";
    }

    key.value = icon === "minus" ? "sign" : icon;
    action.disabled = !valid;
    dom.set(key, "data-icon", icon);
  };

  const fit = () => {
    if (dom.has("wearable")) {
      return;
    }

    const height = element.scrollHeight;

    css.set(dom.root, { "--keypad-height": `${height}px` });
    reveal(state.field, element);
  };

  const show = (field) => {
    if (active && active !== state) {
      dismiss();
    }

    active = state;

    const list = state.fields(root);
    const icon = list.at(-1) === field ? "check" : "arrow";
    const opened = dom.get(element, "data-open") !== null;
    const previous = state.input(state.field);
    const input = state.input(field);

    if (previous !== input) {
      dom.remove(previous, "data-edit");
    }

    state.field = field;
    dom.set(input, "data-edit", "");
    dom.remove(element, "data-close");

    off?.();
    off = back.add(() => {
      state.close?.(field);
    });

    dom.set(action, "data-icon", icon);
    update(field);

    if (opened) {
      return;
    }

    requestAnimationFrame(() => {
      if (state.field === field) {
        dom.set(element, "data-open", "");
        requestAnimationFrame(() => {
          if (state.field === field) {
            fit();
          }
        });
      }
    });
  };

  const hide = (field) => {
    if (state.field !== field) {
      return;
    }

    off?.();
    off = undefined;
    dom.remove(state.input(field), "data-edit");
    state.field = null;

    if (active === state) {
      active = null;
    }

    dom.set(element, "data-close", "");
    dom.remove(element, "data-open");

    const animations = element.getAnimations().map((animation) => animation.finished);

    Promise.allSettled(animations).then(() => {
      if (dom.get(element, "data-open") !== null) {
        return;
      }

      pause();
      dom.remove(element, "data-close");
      css.set(dom.root, { "--keypad-height": null });
    });
  };

  const submit = (field) => {
    if (action.disabled) {
      return false;
    }

    const input = state.input(field);

    if (!input) {
      return false;
    }

    const list = state.fields(root);
    const next = list[list.indexOf(field) + 1];

    if (!next) {
      state.commit?.(field);

      return true;
    }

    state.commit?.(field, true);
    state.edit?.(next, state.selected?.(next));

    return true;
  };

  state.show = show;
  state.hide = hide;
  state.submit = submit;
  state.update = update;

  let frame;

  const resize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = undefined;

        if (state.field && dom.get(element, "data-open") !== null) {
          fit();
        }
      });
    });
  };

  dom.on(window, "resize", resize);
  dom.on(window.visualViewport, "resize", resize);

  dom.on(element, "pointerdown", (event) => {
    event.preventDefault();
  });

  dom.on(element, "click", (event) => {
    const button = event.target.closest("button");
    const field = state.field;

    if (!button || !field) {
      return;
    }

    const input = state.input(field);

    if (!input) {
      return;
    }

    if (button.value === "close") {
      sound.play("click");
      vibrate.play("click");
      state.close?.(field);

      return;
    }

    if (button.value === "delete") {
      sound.play("click");
      vibrate.play("click");
      erase(input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      update(field);

      return;
    }

    if (button.value === "sign") {
      sound.play("click");
      vibrate.play("click");
      write(input, "-");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      update(field);

      return;
    }

    if (button.value === "action") {
      if (submit(field)) {
        sound.play("click");
        vibrate.play("click");
      }

      return;
    }

    sound.play("click");
    vibrate.play("click");
    write(input, button.value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    update(field);
  });

  const boundary = root.closest("dialog") ?? document;

  dom.on(boundary, "click", (event) => {
    const field = state.field;
    const target = event.target;

    if (!field || element.contains(target) || root.contains(target)) {
      return;
    }

    state.close?.(field);
  });

  root.after(element);
  states.set(root, state);

  return state;
}
