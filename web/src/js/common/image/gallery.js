import * as dom from "#common/dom";
import * as css from "#common/css";
import * as i18n from "#common/i18n";
import * as quality from "#common/image/quality";
import "../../../css/common/image/gallery.css";

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

i18n.preload("gallery.image", "gallery.failed", "gallery.previous", "gallery.next", "player.full");

const source = (value) => {
  try {
    const url = new URL(value, location.href);

    return ["http:", "https:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

export default function gallery(root, stage, image, options = {}) {
  const rail = dom.create("div");
  const left = dom.create("img");
  const right = dom.create("img");
  const off = [];
  const previous = dom.create("button");
  const next = dom.create("button");

  let index = 0;

  for (const [button, direction, key] of [
    [previous, -1, "J"],
    [next, 1, "L"]
  ]) {
    button.type = "button";
    button.className = direction < 0 ? "image-view-previous" : "image-view-next";
    dom.set(button, "data-icon", "arrow");
    if (direction < 0) dom.set(button, "data-angle", "left");

    dom.set(button, "data-circle", "");
    dom.set(button, "data-tooltip", direction < 0 ? "gallery.previous" : "gallery.next");
    dom.set(button, "data-key", key);
    off.push(
      dom.on(button, "click", () => {
        void move(index + direction);
      })
    );

    root.append(button);
  }

  let items = [];
  let width = 0;
  let busy = false;
  let dead = false;
  let visible = true;
  let motion;
  let token = 0;
  let press;
  let dragged = false;
  let frame;
  let position = 0;
  let scrolling;
  let offset = 0;
  let exhausted = !options.more;

  rail.className = "image-view-preview";
  dom.set(rail, "data-blur", "");
  left.className = right.className = "image-view-media image-view-neighbor";
  left.draggable = right.draggable = false;
  left.alt = right.alt = "";
  left.hidden = right.hidden = true;
  stage.prepend(left, right);
  root.append(rail);

  const title = (at) => i18n.message("gallery.image").replace("{count}", at + 1);

  function selected(align = false, smooth = true) {
    previous.disabled = index <= 0;
    next.disabled = index >= items.length - 1 && (exhausted || options.end?.() === true);
    for (const [at, button] of [...rail.children].entries()) {
      const current = at === index;

      if (button.hasAttribute("data-selected") === current) continue;

      button.toggleAttribute("data-selected", current);
    }

    const button = rail.children[index];

    if (!align || !button || rail.hidden || press) return;

    rail.scrollTo({
      left: button.offsetLeft - (rail.clientWidth - button.offsetWidth) / 2,
      behavior: smooth && !reduce.matches ? "smooth" : "instant"
    });
  }

  const show = (value) => {
    const changed = rail.hidden;

    visible = value;
    rail.hidden = !visible || items.length < 2;
    previous.hidden = next.hidden = !visible || items.length < 2;
    if (changed && !rail.hidden) selected(true);
  };

  const display = (node, item, side) => {
    node.hidden = !item;
    if (item) {
      const url = quality.neighbor(item);

      if (node.src !== url) {
        node.hidden = true;
        node.src = url;
      }

      node.decoding = "async";
    } else {
      node.removeAttribute("src");
    }

    dom.remove(node, "data-preview");
    css.set(node, { transform: `translateX(${side * width}px)` });
  };

  const neighbors = () => {
    display(left, items[index - 1], -1);
    display(right, items[index + 1], 1);
  };

  const paint = (value) => {
    cancelAnimationFrame(frame);
    frame = undefined;
    position = value;
    css.set(stage, { "--gallery-x": `${value}px` });
  };

  const refresh = (align = false) => {
    const old = items[index]?.url || source(options.source);
    const raw = typeof options.items === "function" ? options.items() : options.items;

    const values = (Array.isArray(raw) ? raw : [])
      .map((item) => {
        const entry = typeof item === "string" ? { url: item } : item || {};

        return {
          ...entry,
          url: source(entry.url || entry.src),
          preview: source(entry.preview || entry.url || entry.src)
        };
      })
      .filter((item) => item.url);

    if (old && !values.some((item) => item.url === old)) {
      values.unshift({ url: old, preview: old });
    }

    items = values;
    index = Math.max(
      0,
      items.findIndex((item) => item.url === old)
    );

    width = root.clientWidth || window.innerWidth;

    while (rail.children.length > items.length) rail.lastElementChild.remove();

    for (const [at, item] of items.entries()) {
      let button = rail.children[at];

      if (!button) {
        button = dom.create("button");
        button.type = "button";
        button.className = "image-view-thumb";
        dom.set(button, "data-response", "");

        const preview = dom.create("img");

        preview.alt = "";
        preview.loading = "lazy";
        preview.decoding = "async";
        preview.draggable = false;
        preview.referrerPolicy = "no-referrer";

        dom.on(preview, "load", () => {
          preview.toggleAttribute("data-pending", !preview.naturalWidth);
        });

        dom.on(preview, "error", () => {
          dom.set(preview, "data-pending", "");
        });

        button.append(preview);
        dom.on(button, "click", () => {
          void move(at);
        });

        rail.append(button);
      }

      const preview = button.firstElementChild;
      const url = quality.thumb(item);

      button.title = item.name || title(at);
      if (preview.src !== url) {
        dom.set(preview, "data-pending", "");
        preview.src = url;
      }
    }

    neighbors();
    show(visible);
    selected(align, false);
  };

  const animate = async (from, to) => {
    cancelAnimationFrame(frame);
    frame = undefined;
    motion?.cancel();
    if (reduce.matches || Math.abs(to - from) < 0.5) {
      paint(to);
      return;
    }

    motion = stage.animate(
      [{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${to}px, 0, 0)` }],
      { duration: 220, easing: "cubic-bezier(.22,.61,.36,1)", fill: "both" }
    );

    await motion.finished.catch(() => {});
  };

  async function move(next, from = 0) {
    if (dead || busy || !options.enabled()) return false;

    const id = ++token;

    busy = true;
    try {
      if (next >= items.length && options.more) {
        const count = items.length;
        const result = await options.more();

        if (dead || id !== token) return false;

        refresh();
        if (result !== false && items.length === count) exhausted = true;

        if (result === false) {
          await animate(from, 0);
          return false;
        }
      }

      if (next < 0 || next >= items.length || next === index) {
        await animate(from, 0);
        return false;
      }

      const side = next > index ? 1 : -1;
      const ghost = side > 0 ? right : left;

      display(ghost, items[next], side);
      await animate(from, -side * width);
      if (dead || id !== token) return false;

      index = next;

      const saved = options.cached?.(items[index]);
      const loading = options.load({
        ...items[index],
        preview: ghost.currentSrc || items[index].preview,
        shown: !ghost.hidden && ghost.complete && ghost.naturalWidth > 0
      });

      if (saved) await loading;
      else await new Promise((resolve) => requestAnimationFrame(resolve));

      if (dead || id !== token) return false;

      image.alt = items[index].name || "";
      if (options.empty) options.empty.hidden = true;

      options.reset(items[index]);
      neighbors();
      selected(true);
      return true;
    } finally {
      if (id === token && !dead) {
        motion?.cancel();
        motion = undefined;
        paint(0);
        busy = false;
        options.show();
      }
    }
  }

  const reset = () => {
    token += 1;
    motion?.cancel();
    motion = undefined;
    paint(0);
    busy = false;
  };

  const drag = (value) => {
    if (dead || busy || !options.enabled()) return;

    position = value;
    if (frame !== undefined) return;

    frame = requestAnimationFrame(() => {
      frame = undefined;
      css.set(stage, { "--gallery-x": `${position}px` });
    });
  };

  const end = (value, commit) => move(commit ? index + (value < 0 ? 1 : -1) : index, value);

  for (const node of [left, right]) {
    off.push(
      dom.on(node, "load", () => {
        node.hidden = !node.naturalWidth;
      })
    );

    off.push(
      dom.on(node, "error", () => {
        node.hidden = true;
      })
    );
  }

  off.push(
    dom.on(window, "keydown", (event) => {
      const modal = root.closest("dialog:modal");
      const key = event.key.toLowerCase();

      if (!modal || modal !== dom.all("dialog:modal").at(-1)) return;

      if (!options.enabled() || !["arrowleft", "arrowright", "j", "l"].includes(key)) return;

      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.target.closest?.(
          "input, textarea, select, [contenteditable]:not([contenteditable='false'])"
        )
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      void move(index + (["arrowleft", "j"].includes(key) ? -1 : 1));
    }),
    dom.on(window, "resize", () => {
      reset();
      width = root.clientWidth || window.innerWidth;
      neighbors();
      options.show();
    }),
    dom.on(rail, "pointerdown", (event) => {
      if (event.button !== 0) return;

      rail.scrollTo({ left: rail.scrollLeft, behavior: "instant" });
      dragged = false;
      press = {
        id: event.pointerId,
        x: event.clientX,
        left: rail.scrollLeft,
        mouse: event.pointerType === "mouse"
      };
    }),
    dom.on(rail, "pointermove", (event) => {
      if (press?.id !== event.pointerId) return;

      const distance = event.clientX - press.x;

      if (Math.abs(distance) > 6) dragged = true;

      if (!dragged || !press.mouse) return;

      event.preventDefault();
      if (!rail.hasPointerCapture(event.pointerId)) {
        rail.setPointerCapture(event.pointerId);
      }

      offset = press.left - distance;
      if (scrolling !== undefined) return;

      scrolling = requestAnimationFrame(() => {
        scrolling = undefined;
        rail.scrollLeft = offset;
      });
    }),
    ...["pointerup", "pointercancel", "lostpointercapture"].map((type) =>
      dom.on(rail, type, () => {
        press = undefined;
      })
    ),
    dom.on(
      rail,
      "click",
      (event) => {
        if (!dragged || event.detail === 0) return;

        dragged = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    )
  );

  refresh();
  paint(0);
  selected(true, false);

  return {
    edge(value) {
      if (!value || busy) return false;
      const next = index + (value < 0 ? 1 : -1);

      return next < 0 || (next >= items.length && (exhausted || options.end?.() === true));
    },
    drag,
    end,
    reset,
    show,
    refresh,
    get current() {
      return items[index];
    },
    get busy() {
      return busy;
    },
    destroy() {
      dead = true;
      token += 1;
      motion?.cancel();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrolling);
      off.forEach((remove) => remove());
      css.remove(left);
      css.remove(right);
      css.remove(stage);
      left.remove();
      right.remove();
      rail.remove();
      previous.remove();
      next.remove();
    }
  };
}
