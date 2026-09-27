import * as css from "#common/css";
import * as dom from "#common/dom";
import * as history from "#common/back";
import * as i18n from "#common/i18n";
import mount from "#common/mount";
import overlay from "#common/overlay";
import snap from "#common/sheet/snap";
import swipe, { resolve } from "#common/swipe";
import * as pointer from "#common/pointer";
import vibrate from "#common/vibrate";
import viewport from "#common/viewport";
import fit from "#common/dialog/fit";
import once from "#common/once";
import * as button from "#common/button";
import * as caption from "./caption.js";
import * as toast from "./toast.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const motions = {
  "→": ["x", "translateX(100vw)"],
  "↘": ["xy", "translate(100vw, 100dvh)"],
  "↓": ["y", "translateY(100dvh)"],
  "↙": ["xy", "translate(-100vw, 100dvh)"],
  "←": ["x", "translateX(-100vw)"],
  "↖": ["xy", "translate(-100vw, -100dvh)"],
  "↑": ["y", "translateY(-100dvh)"],
  "↗": ["xy", "translate(100vw, -100dvh)"]
};

const attrs = { x: "data-swipe-x", y: "data-swipe-y", xy: "data-swipe-xy" };

const types = {
  dialog: "data-dialog",
  popover: "data-popover",
  drawer: "data-drawer",
  sheet: "data-sheet"
};
const opening = once();

const inputTypes = ["text", "email", "password", "search", "tel", "url", "number"];

const text = (tag, name, key) => {
  const element = dom.create(tag);

  element.className = name;

  if (key) {
    dom.set(element, "data-i18n", key);
  }

  return element;
};

const insert = (target, content, name) => {
  if (content instanceof Node) {
    target.append(content);

    return;
  }

  target.append(text("span", name, content));
};

const action = (item, wearable) => {
  const { text: key, icon, data = [] } = item;
  const button = dom.create("button");

  button.type = "button";

  if (item.head) {
    button.className = "layer-action";
    dom.set(button, "data-blur", "");
  }

  data.forEach((value) => dom.set(button, value, ""));

  if ((wearable || item.head) && icon) {
    dom.set(button, "data-icon", icon);
    dom.set(button, "data-circle", "");
    dom.set(button, "data-scale", "");
  }

  if (item.head) {
    dom.set(button, "data-tooltip", key);
  }

  dom.set(button, "data-response", "");
  button.append(text("span", "layer-label", key));

  return button;
};

const build = (type, options) => {
  const { title, content, actions = [] } = options;
  const dialog = type === "dialog";
  const enabled = options.back && !options.locked;
  const back = enabled ? dom.create("button") : null;
  const name = dialog ? "dialog" : "layer";
  const wearable = dom.has("wearable");
  const wrap = dom.create("div");
  const element = dom.create("dialog");

  dom.set(element, types[type], "");
  dom.set(element, "data-background", "");

  if (options.blur) {
    dom.set(element, "data-backdrop", "");
  }

  if (type !== "drawer") {
    dom.set(element, "data-border", "");
  }

  dom.set(element, "data-shadow", "");
  dom.set(element, "closedby", "none");

  if (back) {
    dom.set(element, "data-back", "");
  }

  if (options.fullscreen || wearable) {
    dom.set(element, "data-fullscreen", "");
  }

  if (options.side) {
    dom.set(element, "data-side", options.side);
  }

  if (options.size) {
    css.set(element, { "--layer-size": options.size });
  }

  const head = dom.create("header");

  head.className = `${name}-head`;

  if (back) {
    back.type = "button";
    back.className = "layer-back";
    dom.set(back, "data-blur", "");
    dom.set(back, "data-icon", "arrow");
    dom.set(back, "data-circle", "");
    dom.set(back, "data-scale", "");
    dom.set(back, "data-response", "");
    dom.set(back, "data-angle", "left");
  }

  const heading = text("h2", `${name}-title`, title);

  if (title || title === "" || dialog) {
    head.append(heading);
  }

  const submit = actions.findIndex((item) => item.submit === true);
  const body = dom.create(submit < 0 ? "div" : "form");

  if (submit >= 0) {
    body.id = crypto.randomUUID();
    body.noValidate = true;
  }

  body.className = `${name}-content`;
  if (typeof content !== "function") insert(body, content, dialog ? "" : "layer-text");

  const footer = dom.create("footer");

  footer.className = "layer-actions";

  const buttons = actions.map((item) => action(item, wearable));

  if (submit >= 0) {
    buttons[submit].type = "submit";
    dom.set(buttons[submit], "form", body.id);
  }

  const validate = () => {
    actions.forEach((item, index) => {
      const value = item.disabled;

      buttons[index].disabled = typeof value === "function" ? value() : Boolean(value);
    });
  };

  validate();
  dom.on(body, "input", validate);

  const headed = actions.some((item) => item.head);

  if (back) element.append(back);

  actions.forEach((item, index) => {
    (item.head ? element : footer).append(buttons[index]);
  });

  if (title || title === "" || dialog || headed) {
    element.append(head);
  }

  element.append(body);

  if (footer.childElementCount) {
    element.append(footer);
  }

  if (options.toolbar instanceof Node) {
    element.append(options.toolbar);
  }

  wrap.append(element);

  return { wrap, element, body, buttons, back, submit };
};

const fade = (element, out = false) => {
  if (reduce.matches) {
    return Promise.resolve();
  }

  const opacity = out ? [1, 0] : [0, 1];
  const options = {
    duration: 160,
    easing: out ? "ease-in" : "ease-out",
    fill: out ? "forwards" : "none"
  };

  const animations = [...element.children].map((item) =>
    item.animate({ opacity }, options).finished.catch(() => {})
  );

  return Promise.all(animations);
};

const anchorRect = (anchor) => (anchor instanceof Element ? anchor.getBoundingClientRect() : null);

const origin = (element, anchor) => {
  const rect = anchorRect(anchor);
  const box = element.getBoundingClientRect();
  const { width, height } = box;
  const scale = rect ? Math.max(0.1, Math.min(rect.width / width, rect.height / height)) : 0.2;

  const x = rect ? rect.left + rect.width / 2 - box.left : width / 2;

  const y = rect ? rect.top + rect.height / 2 - box.top : height / 2;

  css.set(element, { "transform-origin": `${x}px ${y}px` });

  return scale;
};

const enter = (element, type, anchor) => {
  const fullscreen = dom.get(element, "data-fullscreen") !== null;

  const scale =
    type === "popover" && (!fullscreen || anchor instanceof Element) ? origin(element, anchor) : 1;

  if (reduce.matches) {
    return null;
  }

  const keyframes = {
    popover: [
      { opacity: 0, transform: `scale(${scale})` },
      { opacity: 1, transform: "scale(1)" }
    ],
    drawer: [
      {
        transform:
          dom.get(element, "data-side") === "right" ? "translateX(100%)" : "translateX(-100%)"
      },
      { transform: "translateX(0)" }
    ],
    sheet: [{ transform: "translateY(100dvh)" }, { transform: "translateY(0)" }]
  }[type];

  return element.animate(keyframes, { duration: 240, easing: "ease-out", fill: "both" });
};

const length = (element, axis, screen = false) => {
  const { width, height } = viewport();

  if (axis === "x") {
    return screen ? width : element.clientWidth;
  }

  if (axis === "y") {
    return screen ? height : element.clientHeight;
  }

  return screen ? Math.hypot(width, height) : Math.hypot(element.clientWidth, element.clientHeight);
};

const strength = (element) => {
  const rect = element.getBoundingClientRect();
  const screen = viewport();
  const total = screen.width * screen.height;
  const area = rect.width * rect.height;

  return total ? Math.min(1, Math.max(0, area / total)) : 0;
};

const dismiss = (element, options) => {
  const { dir, close, finish, shade, manual = false } = options;
  const arrow = resolve(dir);

  if (!arrow || !motions[arrow]) {
    return () => {};
  }

  const [axis, exit] = motions[arrow];

  dom.set(element, attrs[axis], "");

  let animation;
  let frame;
  let progress = 0;
  let done;

  const update = (value) => {
    progress = value;

    if (animation) {
      animation.currentTime = value * 1000;
    }

    shade(value);
  };

  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = undefined;
    done?.();
    done = undefined;
  };

  const settle = (target) =>
    new Promise((finish) => {
      cancel();
      done = finish;

      const from = progress;

      if (reduce.matches || from === target) {
        update(target);
        done();
        done = undefined;

        return;
      }

      const start = performance.now();
      const duration = 180 * Math.max(0.4, Math.abs(target - from));

      const run = (now) => {
        const time = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - time, 3);

        update(from + (target - from) * ease);

        if (time < 1) {
          frame = requestAnimationFrame(run);

          return;
        }

        done();
        done = undefined;
      };

      frame = requestAnimationFrame(run);
    });

  const stop = () => {
    cancel();
    animation?.cancel();
    animation = undefined;
  };

  const ratio = () => {
    const total = length(element, axis, true);
    const size = length(element, axis);

    return total ? Math.min(0.35, (size / total) * 0.35) : 0.35;
  };

  let dead = false;
  let reached = false;
  let revision = 0;

  const start = () => {
    if (dead) return;

    revision += 1;
    stop();
    progress = 0;
    reached = false;
    finish?.();
    animation = element.animate([{ transform: "translate(0)" }, { transform: exit }], {
      duration: 1000,
      fill: "both"
    });

    animation.pause();
    animation.currentTime = 0;
    dom.set(element, "data-swipe", "");
  };

  const move = (value) => {
    if (dead) return;
    const next = Math.max(0, Math.min(1, value));
    const active = next >= ratio();

    if (manual && active && !reached) vibrate.play(25);

    reached = active;
    update(next);
  };

  const reset = () => {
    revision += 1;
    stop();
    update(0);
    dom.remove(element, "data-swipe");
  };

  const end = async (complete) => {
    if (dead) return;

    const id = ++revision;

    dom.remove(element, "data-swipe");
    await settle(complete ? 1 : 0);
    if (dead || id !== revision) return;

    if (complete) await close(false, false);
    else reset();
  };

  const off = manual
    ? () => {}
    : swipe(arrow, {
        target: element,
        ignore: pointer.blocked,
        scroll: true,
        length: () => length(element, axis, true),
        ratio,
        start,
        move,
        reach: () => vibrate.play(25),
        end
      });

  return Object.assign(
    () => {
      dead = true;
      off();
      stop();
    },
    { start, move, end, reset, ratio, size: () => length(element, axis, true) }
  );
};

async function open(type, options) {
  const { actions = [], scroll } = options;
  const dialog = type === "dialog";
  const locked = options.locked === true;
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const keyboard = trigger?.matches(":focus-visible") === true;

  const { wrap, element, body, buttons, back, submit } = build(type, options);

  const release = overlay(element);

  dom.body.append(wrap);
  mount(element);

  const translated =
    options.translate === false ||
    i18n.apply(element) ||
    (await i18n.translate().catch(() => false));

  if (!translated) {
    css.remove(element);
    wrap.remove();
    await release();

    return false;
  }

  return new Promise((finish) => {
    let opening;
    let closed = false;
    let removeHistory;
    let settle;

    const finished = new Promise((resolve) => {
      settle = resolve;
    });

    const off = [];
    const dispose = [];
    const confirm = () => {
      for (const button of buttons) {
        if (!button.matches('.layer-action[data-icon="check"]')) continue;

        button.toggleAttribute("data-confirm", !button.disabled);
        button.toggleAttribute("data-background", button.disabled);
      }
    };
    const observer = new MutationObserver(confirm);

    for (const button of buttons)
      observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
    off.push(() => observer.disconnect());
    confirm();

    const clearFocus = () => {
      if (trigger && !keyboard && document.activeElement === trigger) {
        trigger.blur();
      }
    };

    const close = async (value = false, smooth = true) => {
      if (closed) {
        return finished;
      }

      closed = true;
      if (document.fullscreenElement && element.contains(document.fullscreenElement))
        await document.exitFullscreen().catch(() => {});

      options.closing?.(value);
      off.forEach((remove) => remove());

      const dimming = release(smooth);

      if (smooth && dialog) {
        await fade(element, true);
      } else if (
        smooth &&
        opening &&
        !reduce.matches &&
        type === "popover" &&
        options.exit === "fade"
      ) {
        opening.pause();
        await element
          .animate(
            { opacity: [getComputedStyle(element).opacity, 0] },
            { duration: 160, easing: "ease-in", fill: "forwards" }
          )
          .finished.catch(() => {});
      } else if (smooth && opening && !reduce.matches) {
        if (type === "popover" && options.anchor instanceof Element) {
          const scale = origin(element, options.anchor);

          opening.effect.setKeyframes([
            { opacity: 0, transform: `scale(${scale})` },
            { opacity: 1, transform: "scale(1)" }
          ]);
        }

        opening.reverse();
        await opening.finished.catch(() => {});
      }

      await dimming;
      dispose.forEach((remove) => remove());

      if (element.open) {
        element.close();
      }

      caption.raise();
      toast.raise();
      clearFocus();
      css.remove(element);
      wrap.remove();

      clearFocus();
      await removeHistory?.();
      finish(value);
      settle();
    };

    const controls = [back, ...buttons.filter((_, index) => actions[index].head)].filter(Boolean);

    if (controls.length) {
      const shadow = () => {
        for (const control of controls) {
          if (element.scrollTop > 0) dom.set(control, "data-shadow", "");
          else dom.remove(control, "data-shadow");
        }
      };

      off.push(dom.on(element, "scroll", shadow, { passive: true }));
      shadow();
    }

    if (back) {
      off.push(
        dom.on(back, "click", () => {
          history.back().catch(console.error);
        })
      );
    }

    const bind = (item, index) => {
      let running = false;

      off.push(
        dom.on(buttons[index], "click", async (event) => {
          event.preventDefault();

          const disabled = item.disabled;

          if (
            closed ||
            running ||
            buttons[index].disabled ||
            (typeof disabled === "function" ? disabled() : disabled)
          ) {
            return;
          }

          running = true;

          try {
            const result = await item.run?.({ element, button: buttons[index], close });

            if (item.close === false || result === false) {
              return;
            }

            await close(result ?? item.value);
          } finally {
            running = false;
          }
        })
      );
    };

    actions.forEach(bind);

    if (submit >= 0) {
      let composing = false;

      off.push(
        dom.on(body, "compositionstart", () => {
          composing = true;
        }),
        dom.on(body, "compositionend", () => {
          composing = false;
        }),
        dom.on(body, "keydown", (event) => {
          const input = event.target;

          if (
            event.defaultPrevented ||
            event.key !== "Enter" ||
            !input.matches("input") ||
            input.form !== body ||
            !inputTypes.includes(input.type) ||
            input.readOnly ||
            input.matches(":disabled")
          ) {
            return;
          }

          event.preventDefault();

          if (
            composing ||
            event.isComposing ||
            event.keyCode === 229 ||
            event.repeat ||
            event.shiftKey ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
          ) {
            return;
          }

          if (input.enterKeyHint === "next") {
            const fields = dom
              .all("input", body)
              .filter(
                (field) =>
                  field.form === body &&
                  !field.matches(":disabled") &&
                  !field.readOnly &&
                  field.getClientRects().length &&
                  inputTypes.includes(field.type)
              );
            const next = fields[fields.indexOf(input) + 1];

            if (next) {
              next.focus();

              return;
            }
          }

          buttons[submit].click();
        }),
        dom.on(body, "submit", (event) => {
          event.preventDefault();

          if (event.target === body && !composing) {
            buttons[submit].click();
          }
        })
      );
    }

    off.push(
      dom.on(element, "click", (event) => {
        const button = event.target.closest?.("button:enabled[data-layer-action]");

        if (!button || !element.contains(button)) {
          return;
        }

        close(dom.get(button, "data-layer-action"));
      })
    );

    if (dialog) {
      off.push(dom.on(element, "cancel", (event) => event.preventDefault()));
    }

    if (!locked && (type === "popover" || type === "sheet")) {
      off.push(
        dom.on(element, "click", (event) => {
          if (event.target !== element) {
            return;
          }

          const rect = element.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;

          if (!inside) {
            close(false);
          }
        })
      );
    }

    window.getSelection()?.removeAllRanges();
    element.showModal();

    toast.raise();
    release.open();
    caption.raise();

    let overlayFrame;

    const updateOverlay = () => {
      if (overlayFrame) {
        return;
      }

      overlayFrame = requestAnimationFrame(() => {
        overlayFrame = undefined;
        release.strength(strength(element));
      });
    };

    updateOverlay();
    off.push(dom.on(window, "resize", updateOverlay));
    off.push(() => {
      cancelAnimationFrame(overlayFrame);
      overlayFrame = undefined;
    });

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(updateOverlay);

      observer.observe(element);
      off.push(() => observer.disconnect());
    }

    if (!dialog) {
      element.focus({ preventScroll: true });
    }

    element.scrollTop = Number.isFinite(scroll) ? scroll : 0;

    const transitions = new Map();
    const gesture = {
      finish: () => opening?.finish(),
      slide: (direction, target = element) => {
        if (closed || locked) return null;
        const key = `${direction}:${target === element ? "layer" : "content"}`;

        if (!transitions.has(key)) {
          const motion = dismiss(target, {
            dir: direction,
            manual: true,
            close,
            finish: () => opening?.finish(),
            shade: release.shade
          });

          transitions.set(key, motion);
          off.push(motion);
        }

        return transitions.get(key);
      }
    };

    options.ready?.(element, close, gesture);
    if (typeof options.content === "function") {
      const controller = new AbortController();

      dispose.push(() => {
        controller.abort();
      });

      void Promise.resolve()
        .then(() => options.content(controller.signal))
        .then(async (value) => {
          const loaded = value instanceof Node ? { content: value } : value;

          if (closed) {
            loaded?.dispose?.();
            return;
          }

          if (!(loaded?.content instanceof Node)) {
            await close(false);
            return;
          }

          if (loaded.dispose) dispose.push(loaded.dispose);

          if (loaded.closing) options.closing = loaded.closing;

          const fragment = document.createDocumentFragment();

          fragment.append(loaded.content);
          if (loaded.toolbar) fragment.append(loaded.toolbar);
          const controls = [];

          for (const item of loaded.actions || []) {
            const control = action(item, dom.has("wearable"));

            control.disabled =
              typeof item.disabled === "function" ? item.disabled() : Boolean(item.disabled);

            fragment.append(control);
            controls.push(control);
            actions.push(item);
            buttons.push(control);
            observer.observe(control, { attributes: true, attributeFilter: ["disabled"] });
            bind(item, buttons.length - 1);
          }
          const translated =
            options.translate === false ||
            i18n.apply(fragment) ||
            (await i18n.translate(undefined, fragment));

          if (closed) return;

          if (!translated) {
            await close(false);
            return;
          }

          body.replaceChildren(loaded.content);
          if (loaded.toolbar) element.append(loaded.toolbar);

          element.append(...controls);
          mount(element);
          i18n.apply(element);
          loaded.ready?.(element, close, gesture);
          confirm();
        })
        .catch(async (error) => {
          if (closed) return;

          console.error(error);
          await close(false);
        });
    }

    if (dialog) {
      off.push(fit(element));
      fade(element);
    } else {
      opening = enter(element, type, options.anchor);
    }

    if (
      type === "popover" &&
      (dom.get(element, "data-fullscreen") === null || options.anchor instanceof Element)
    ) {
      const update = () => origin(element, options.anchor);

      off.push(dom.on(window, "resize", update));
    }

    const address = new URL(window.location.href);

    address.searchParams.set(
      "view",
      (options.title || type)
        .replace(/\.title$/, "")
        .replace(/^menu\./, "")
        .replaceAll(".", "-")
    );

    const state = options.route
      ? [type, ...options.route]
      : dialog
        ? undefined
        : [type, "target", `${address.pathname}${address.search}`];

    removeHistory = history.add(() => {
      if (locked) {
        return false;
      }

      return close(false);
    }, state);

    if (!locked && type === "sheet" && !dom.has("wearable") && options.snap !== false) {
      off.push(snap(element, { stage: options.stage, close, finish: () => opening?.finish() }));
    } else if (!locked && options.direction) {
      off.push(
        dismiss(element, {
          dir: options.direction,
          close,
          finish: () => opening?.finish(),
          shade: release.shade
        })
      );
    }
  });
}

export default function layer(type, options = {}) {
  const source =
    options.anchor instanceof Element ? options.anchor : button.trigger || document.activeElement;

  const key = source?.matches?.("button, a, input, select, textarea") ? source : options;

  return opening(key, () => open(type, options));
}
