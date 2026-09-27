import * as dom from "./dom.js";
import * as css from "./css.js";
import viewport from "./viewport.js";
import * as i18n from "./i18n.js";
import progress from "./progress.js";
import sound from "./sound.js";
import swipe from "./swipe.js";
import vibrate from "./vibrate.js";
import * as emoji from "#common/emoji";
import summary from "#common/chatting/summary";

const render = (element, value) => {
  element.replaceChildren();
  emoji.render(element, value);
};

i18n.register("data-i18n-emoji", render);

const icons = Object.freeze({
  error: "error",
  warning: "warning",
  success: "check",
  info: "info",
  notify: "notify"
});

const signals = Object.freeze({
  error: ["failure", "error"],
  warning: ["alert", "alert"],
  success: ["success", "success"],
  info: ["pop", "response"],
  notify: ["bell", "receive"]
});

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

let stack;
let placement;

const place = () => {
  cancelAnimationFrame(placement);
  placement = requestAnimationFrame(() => {
    if (!stack?.isConnected) return;
    const view = window.visualViewport;
    const { width } = viewport();

    css.set(stack, {
      "--toast-top": `${view?.offsetTop ?? 0}px`,
      "--toast-left": `${(view?.offsetLeft ?? 0) + width / 2}px`,
      "--toast-width": `${width}px`
    });
  });
};

const observe = (listen) => {
  const method = listen ? "addEventListener" : "removeEventListener";

  for (const target of [window, window.visualViewport]) {
    target?.[method]("resize", place);
    target?.[method]("scroll", place);
  }
};

const seen = new Set();
const active = new Set();

export const raise = () => {
  if (!stack?.isConnected) {
    return;
  }

  if (stack.matches(":popover-open")) {
    stack.hidePopover();
  }

  const parent = dom.all("dialog:modal").at(-1) || dom.body;

  if (stack.parentElement !== parent) parent.append(stack);

  stack.showPopover();
  place();
};

const host = () => {
  if (!stack?.isConnected) {
    stack = dom.create("div");
    stack.className = "toasts";

    dom.set(stack, "popover", "manual");
    dom.body.append(stack);
    observe(true);
  }

  raise();

  return stack;
};

const createText = (tag, name, value) => {
  if (!value) {
    return null;
  }

  const element = dom.create(tag);

  element.className = name;
  if (name === "toast-text") {
    render(element, i18n.message(value) || value);
    dom.set(element, "data-i18n-emoji", value);
  } else {
    element.textContent = i18n.message(value) || value;
    dom.set(element, "data-i18n", value);
  }

  return element;
};

const wait = (element) => {
  const animations = element.getAnimations().map((animation) => animation.finished);

  return Promise.allSettled(animations);
};

const loadImage = (target, options) => {
  if (!options.image) {
    return Promise.resolve();
  }

  const media = dom.create("div");
  const image = dom.create("img");

  media.className = "toast-media";
  image.className = "toast-image";
  image.alt = options.alt ?? "";
  image.draggable = false;
  image.hidden = true;
  media.append(image);
  target.append(media);

  return new Promise((resolve) => {
    let done = false;

    const finish = async (loaded) => {
      if (done) {
        return;
      }

      done = true;

      if (loaded) {
        image.hidden = false;
      } else {
        dom.set(media, "data-close", "");

        if (!reduce.matches) {
          await wait(media);
        }

        media.remove();
      }

      resolve();
    };

    dom.on(image, "load", () => finish(true), { once: true });

    dom.on(image, "error", () => finish(false), { once: true });

    image.src = options.image;

    if (image.complete) {
      queueMicrotask(() => finish(image.naturalWidth > 0));
    }
  });
};

export default function toast(options = {}) {
  if (options.id) {
    if (seen.has(options.id)) return;

    seen.add(options.id);
    if (seen.size > 100) seen.delete(seen.values().next().value);
  }

  if (typeof options === "string") {
    options = { text: options };
  }

  const group = options.group;

  if (group && active.has(group)) return;

  if (group) active.add(group);

  const requested = String(options.type ?? "custom").toLowerCase();

  const type = Object.hasOwn(icons, requested) ? requested : "custom";
  const element = dom.create("section");

  element.className = "toast";

  if (type === "custom") {
    dom.set(element, "data-background", "");

    if (options.background) {
      css.set(element, { "--toast-color": options.background });
    }

    if (options.color) {
      css.set(element, { "--toast-text": options.color });
    }
  }

  dom.set(element, "data-toast", type);

  const mark = dom.create("span");

  mark.className = "toast-mark";
  dom.set(mark, "data-background", "");
  dom.set(mark, "data-icon", options.icon ?? icons[type] ?? "info");

  const content = dom.create("div");

  content.className = "toast-content";

  const title = createText("h3", "toast-title", options.title);
  const text = createText("p", "toast-text", summary(options));

  if (title) {
    content.append(title);
  }

  if (text) {
    content.append(text);
  }

  const imageReady = loadImage(content, options);
  const button = dom.create("button");

  button.type = "button";
  button.className = "toast-close";
  dom.set(button, "data-opacity", "");
  dom.set(button, "data-icon", "close");
  dom.set(button, "data-response", "");

  element.append(mark, content, button);

  const gauge = progress({ value: 0, show: false, target: element });
  const url = String(options.url ?? "").trim();
  const duration = Math.max(1000, Number(options.duration) || 5000);

  const [defaultSound, defaultVibration] = signals[type] ?? [];
  const effect = options.sound ?? defaultSound;
  const vibration = options.vibration ?? defaultVibration;

  if (url || options.run) {
    dom.set(element, "data-url", "");

    dom.on(element, "click", (event) => {
      if (event.target.closest(".toast-close")) {
        return;
      }

      if (options.run) Promise.resolve(options.run()).catch(() => {});
      else location.assign(url);
    });
  }

  host().append(element);
  i18n.translate().catch(() => false);

  if (effect) {
    sound.play(effect, { channel: type === "notify" ? "notify" : "system" });
  }

  if (vibration) {
    vibrate.play(vibration);
  }

  let frame;
  let off = () => {};

  let closing = false;

  const close = async () => {
    if (closing) {
      return;
    }

    closing = true;
    off();
    cancelAnimationFrame(frame);
    dom.remove(element, "data-open");

    if (!reduce.matches) {
      await wait(element);
    }

    css.remove(element);
    element.remove();
    if (group) active.delete(group);

    if (stack && !stack.children.length) {
      if (stack.matches(":popover-open")) {
        stack.hidePopover();
      }

      observe(false);
      cancelAnimationFrame(placement);
      css.remove(stack);
      stack.remove();
      stack = undefined;
    }
  };

  dom.on(button, "click", close);

  off = swipe("←", {
    target: element,

    end: (complete) => {
      if (complete) {
        close();
      }
    }
  });

  frame = requestAnimationFrame(() => {
    if (closing) {
      return;
    }

    dom.set(element, "data-open", "");

    imageReady.then(() => {
      if (closing) {
        return;
      }

      frame = requestAnimationFrame((start) => {
        const update = (time) => {
          const elapsed = time - start;
          const value = Math.min(100, (elapsed / duration) * 100);

          gauge.set(value);

          if (value >= 100) {
            close();

            return;
          }

          frame = requestAnimationFrame(update);
        };

        frame = requestAnimationFrame(update);
      });
    });
  });

  return { element, close };
}
