import * as dom from "#common/dom";
import keypad from "#common/keypad";
import sound from "#common/sound";
import vibrate from "#common/vibrate";

const held = new WeakSet();
const values = new WeakMap();

let press;
let listening = false;

const limit = (input, value) => {
  const min = input.min === "" ? -Infinity : Number(input.min);

  const max = input.max === "" ? Infinity : Number(input.max);

  return Math.min(max, Math.max(min, value));
};

const valid = (input) => {
  const value = Number(input.value);

  return input.value !== "" && Number.isFinite(value) && value === limit(input, value);
};

const paint = (input) => {
  const value = Number(input.value);
  const display = input.closest(".stepper-value");
  const number = dom.query(".stepper-number", display);

  if (number) {
    number.textContent = input.value;
  }

  if (Number.isFinite(value) && value >= 0) {
    dom.set(display, "data-positive", "");
  } else {
    dom.remove(display, "data-positive");
  }
};

const keyboard = (input) => keypad(input.closest(".stepper"), { close, commit, valid });

const hide = (input) => {
  const display = input.closest(".stepper-value");
  const number = dom.query(".stepper-number", display);

  input.hidden = true;
  number.hidden = false;
  keyboard(input).hide(input);
};

const edit = (input) => {
  const display = input.closest(".stepper-value");
  const number = dom.query(".stepper-number", display);

  values.set(input, input.value);
  number.hidden = true;
  input.hidden = false;
  keyboard(input).show(input);
  input.focus({ preventScroll: true });
  input.select();
};

function commit(input) {
  const value = Number(input.value);

  if (Number.isFinite(value)) {
    input.value = String(limit(input, value));
  } else {
    input.value = values.get(input) ?? "0";
  }

  values.delete(input);
  paint(input);
  hide(input);
}

function close(input) {
  input.value = values.get(input) ?? input.value;
  values.delete(input);
  paint(input);
  hide(input);
}

const move = (input, direction) => {
  const value = Number(input.value) || 0;
  const step = Number(input.step) || 1;
  const next = limit(input, value + step * direction);

  if (next === value) {
    return;
  }

  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  sound.play("snap");
  vibrate.play("stepper");
};

const change = (button) => {
  const container = button.closest(".stepper");
  const input = dom.query(".stepper-value input", container);
  const direction = Number(dom.get(button, "data-step"));

  if (!input || !Number.isFinite(direction)) {
    return;
  }

  move(input, direction);
};

const stop = () => {
  if (!press) {
    return;
  }

  clearTimeout(press.delay);
  clearInterval(press.repeat);

  if (press.held) {
    const button = press.button;

    setTimeout(() => {
      held.delete(button);
    });
  }

  press = undefined;
};

export default function stepper(root = document) {
  dom.find(".stepper-value input", root).forEach((input) => {
    input.type = "text";
    input.inputMode = "none";
    paint(input);
    keyboard(input);
  });
}

export function listen() {
  if (listening) {
    return;
  }

  listening = true;
  dom.on(document, "click", (event) => {
    const number = event.target.closest?.(".stepper-number");

    if (!number) {
      return;
    }

    const display = number.closest(".stepper-value");
    const input = dom.query("input", display);

    if (input) {
      edit(input);
    }
  });

  dom.on(
    document,
    "blur",
    (event) => {
      const input = event.target;

      if (!input.matches?.(".stepper-value input")) {
        return;
      }

      commit(input);
    },
    true
  );

  dom.on(document, "keydown", (event) => {
    const input = event.target;

    if (!input.matches?.(".stepper-value input")) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      keyboard(input).submit(input);

      return;
    }

    if (event.key === "Escape") {
      close(input);
    }
  });

  dom.on(document, "pointerdown", (event) => {
    const button = event.target.closest?.(".stepper " + "button[data-step]:enabled");

    if (!button) {
      return;
    }

    stop();
    press = { button, held: false };
    press.delay = setTimeout(() => {
      if (!press || press.button !== button) {
        return;
      }

      press.held = true;
      held.add(button);
      change(button);
      press.repeat = setInterval(() => {
        change(button);
      }, 90);
    }, 350);
  });

  dom.on(document, "pointerup", stop);
  dom.on(document, "pointercancel", stop);
  dom.on(document, "click", (event) => {
    const button = event.target.closest?.(".stepper " + "button[data-step]:enabled");

    if (!button) {
      return;
    }

    if (held.has(button)) {
      return;
    }

    change(button);
  });

  dom.on(document, "input", (event) => {
    const input = event.target;

    if (!input.matches?.(".stepper-value input")) {
      return;
    }

    const signed = Number(input.min) < 0 && input.value.startsWith("-");
    const digits = input.value.replace(/\D/g, "");
    const value = `${signed ? "-" : ""}${digits}`;

    if (input.value !== value) {
      input.value = value;
    }

    paint(input);
    keyboard(input).update(input);
  });

  dom.on(document, "change", (event) => {
    const input = event.target;

    if (!input.matches?.(".stepper-value input")) {
      return;
    }

    const value = Number(input.value);

    if (!Number.isFinite(value)) {
      return;
    }

    input.value = String(limit(input, value));
    paint(input);
  });
}
