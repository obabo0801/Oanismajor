import * as dom from "#common/dom";
import * as back from "#common/back";
import * as css from "#common/css";
import popover from "#common/popover";
import sound from "#common/sound";
import vibrate from "#common/vibrate";
import * as route from "#common/route";

const bound = new WeakSet();
const pending = new WeakSet();

let current;
let listening = false;

const source = (element) => dom.query(":scope > select", element);
const disabled = (option) => !option || option.matches(":disabled");

const menu = (element) => dom.query(":scope > .select-menu", element);

const sync = (element) => {
  const input = source(element);
  const button = dom.query(":scope > .select-toggle", element);
  const value = dom.query(".select-value", button);
  const option = input?.selectedOptions[0];
  const key = dom.get(option, "data-i18n");

  if (!input || !button || !value) {
    return;
  }

  value.textContent = option?.textContent ?? "";
  button.disabled = input.matches(":disabled");

  if (key) {
    dom.set(value, "data-i18n", key);
  } else {
    dom.remove(value, "data-i18n");
  }

  const lists = [menu(element), ...(current?.element === element ? [current.content] : [])];

  lists.filter(Boolean).forEach((list) =>
    dom.all(".select-option", list).forEach((item) => {
      const at = Number(item.dataset.index);
      const selected = at === input.selectedIndex;

      item.disabled = input.matches(":disabled") || disabled(input.options[at]);

      if (selected) {
        dom.set(item, "data-selected", "");
      } else {
        dom.remove(item, "data-selected");
      }
    })
  );
};

const close = (focus = false) => {
  if (!current) {
    return;
  }

  const session = current;
  const { element, list } = session;

  current = undefined;
  session.closed = true;
  session.off.forEach((remove) => remove());
  cancelAnimationFrame(session.frame);
  session.dismiss?.(false);
  if (list.matches(":popover-open")) list.hidePopover();

  dom.remove(list, "popover");
  css.remove(list);
  dom.remove(element, "data-open");

  if (focus) {
    dom.query(":scope > .select-toggle", element)?.focus({ preventScroll: true });
  }
};

const focusOption = (list) => {
  const option =
    dom.query(".select-option[data-selected]:enabled", list) ??
    dom.query(".select-option:enabled", list);

  option?.focus({ preventScroll: true });
};

const place = (session) => {
  const { element, list } = session;

  if (!element.isConnected) {
    close();

    return;
  }

  const rect = dom.query(":scope > .select-toggle", element).getBoundingClientRect();
  const view = window.visualViewport;
  const left = (view?.offsetLeft ?? 0) + 8;
  const top = (view?.offsetTop ?? 0) + 8;
  const right = left + (view?.width ?? dom.root.clientWidth) - 16;
  const bottom = top + (view?.height ?? dom.root.clientHeight) - 16;
  const below = Math.max(0, bottom - rect.bottom - 4);
  const above = Math.max(0, rect.top - top - 4);
  const down = below >= Math.min(list.scrollHeight, 320) || below >= above;
  const width = Math.min(rect.width, Math.max(0, right - left));

  css.set(list, {
    width: `${width}px`,
    "--select-left": `${Math.max(left, Math.min(rect.left, right - width))}px`,
    "max-height": `${Math.min(320, down ? below : above)}px`
  });

  css.set(list, {
    "--select-top": `${Math.max(top, down ? rect.bottom + 4 : rect.top - list.offsetHeight - 4)}px`
  });
};

const fullscreen = async (session) => {
  const { element, list } = session;
  const content = list.cloneNode(true);

  session.content = content;

  dom.set(content, "data-fullscreen", "");
  dom.set(content, "data-pan", "");
  dom.all(".select-option", content).forEach((item) => {
    dom.set(item, "data-layer-action", item.dataset.index);
    dom.set(item, "data-pan", "");
  });

  pending.add(element);
  try {
    const result = await popover({
      route:
        source(element)?.name || source(element)?.id
          ? ["select", source(element).name || source(element).id]
          : undefined,
      content,
      fullscreen: true,
      direction: "left",
      translate: false,
      ready: (_, dismiss) => {
        session.dismiss = dismiss;
        if (session.closed || !element.isConnected) dismiss(false, false);
        else focusOption(content);
      }
    });

    if (!session.closed && typeof result === "string") {
      choose(element, Number(result));
    }
  } catch (error) {
    console.error(error);
  } finally {
    pending.delete(element);
    if (current === session) close();
  }
};

const open = (element, full = false) => {
  const input = source(element);
  const list = menu(element);

  if (!input || input.matches(":disabled") || !list || pending.has(element)) {
    return;
  }

  close();

  const mode =
    full || dom.has("wearable")
      ? "fullscreen"
      : dom.get(element, "data-expand") !== null
        ? "expand"
        : "float";

  const session = { element, list, mode, off: [], closed: false };

  current = session;
  dom.set(element, "data-open", "");

  const observer = new MutationObserver(() => {
    if (!element.isConnected && current === session) close();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  session.off.push(() => observer.disconnect());

  if (mode === "fullscreen") {
    return fullscreen(session);
  }

  session.off.push(back.add(() => close(true)));

  if (mode === "float") {
    dom.set(list, "popover", "manual");
    list.showPopover();
    place(session);

    const update = () => {
      cancelAnimationFrame(session.frame);
      session.frame = requestAnimationFrame(() => {
        if (current === session) place(session);
      });
    };

    session.off.push(
      dom.on(
        document,
        "scroll",
        (event) => {
          if (!list.contains(event.target)) update();
        },
        true
      ),
      dom.on(window, "resize", update),
      dom.on(window.visualViewport, "resize", update),
      dom.on(window.visualViewport, "scroll", update)
    );
  }

  requestAnimationFrame(() => {
    if (current === session) focusOption(list);
  });
};

function choose(element, index) {
  const input = source(element);
  const option = input?.options[index];

  if (!input || input.matches(":disabled") || disabled(option)) {
    return;
  }

  const changed = input.selectedIndex !== index;

  input.selectedIndex = index;
  sync(element);
  close(true);

  if (changed) {
    input.dispatchEvent(new Event("input", { bubbles: true }));

    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

const bind = (element) => {
  const input = source(element);

  if (!input || bound.has(input)) {
    return;
  }

  const button = dom.create("button");
  const value = dom.create("span");
  const list = dom.create("div");
  const options = [...input.options].map((option, index) => {
    const item = dom.create("button");
    const key = dom.get(option, "data-i18n");

    item.type = "button";
    item.className = "select-option";
    item.dataset.index = String(index);
    item.disabled = disabled(option);
    item.textContent = option.textContent;

    if (key) {
      dom.set(item, "data-i18n", key);
    }

    return item;
  });

  button.type = "button";
  button.className = "select-toggle";
  dom.set(button, "data-icon", "arrow right");

  value.className = "select-value";
  list.className = "select-menu";
  list.append(...options);

  input.hidden = true;
  dom.query(":scope > .select-arrow", element)?.remove();
  button.append(value);
  element.append(button, list);

  bound.add(input);
  sync(element);
};

export default function select(root = document) {
  dom.find(".select", root).forEach(bind);
}

export function listen() {
  if (listening) {
    return;
  }

  listening = true;

  dom.on(document, "click", (event) => {
    const toggle = event.target.closest?.(".select-toggle");

    if (toggle) {
      const element = toggle.closest(".select");

      sound.play("click");
      vibrate.play("click");

      if (current?.element === element) {
        close(true);
      } else {
        open(element);
      }

      return;
    }

    const option = event.target.closest?.(".select-option:enabled");

    if (option && current?.list.contains(option)) {
      choose(current.element, Number(option.dataset.index));
    }
  });

  dom.on(
    document,
    "reset",
    (event) => {
      const form = event.target;

      queueMicrotask(() => {
        if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;

        for (const input of form.elements) {
          const element = input.closest?.(".select");

          if (element && bound.has(input)) sync(element);
        }
      });
    },
    true
  );

  dom.on(document, "change", (event) => {
    const input = event.target;

    if (!input.matches?.(".select > select")) {
      return;
    }

    sync(input.closest(".select"));
    sound.play("click");
    vibrate.play("click");
  });

  dom.on(
    document,
    "pointerdown",
    (event) => {
      if (current && current.mode !== "fullscreen" && !current.element.contains(event.target)) {
        close();
      }
    },
    true
  );

  dom.on(document, "keydown", (event) => {
    if (!current || current.mode === "fullscreen") return;
    const { element, list } = current;

    if (!element.contains(event.target)) return;

    if (event.key === "Tab") {
      close();

      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();

    const options = dom.all(".select-option:enabled", list);
    const index = options.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;

    options[next]?.focus({ preventScroll: true });
    options[next]?.scrollIntoView({ block: "nearest" });
  });
}

route.register("select", (id) => {
  const element = dom.all(".select").find((item) => {
    const input = source(item);

    return id && (input?.name || input?.id) === id;
  });

  return element ? open(element, true) : false;
});
