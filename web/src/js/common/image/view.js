import * as css from "#common/css";
import * as dom from "#common/dom";
import popover from "#common/popover";
import double from "#common/image/double";
import gallery from "#common/image/gallery";
import load from "#common/image/load";
import * as assets from "#common/chatting/asset";
import * as quality from "#common/image/quality";
import * as theme from "#common/theme";
import * as route from "#common/route";
import * as images from "#shared/image";
import * as giphy from "#common/giphy";
import * as media from "../media.js";

route.register("image", async (id) => {
  const remote = id.startsWith("giphy-");
  const source = remote ? await giphy.resolve(id.slice(6), true) : images.source(id);

  const items = remote
    ? [{ url: source, preview: source, route: id, resolve: () => giphy.resolve(id.slice(6)) }]
    : [];

  return source ? view(source, undefined, "", id, items) : false;
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const distance = ([first, second]) => Math.hypot(second.x - first.x, second.y - first.y);

const midpoint = ([first, second]) => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
});

export default async function view(
  source,
  anchor,
  icon = "",
  id = images.identify(source, location.origin),
  collection = []
) {
  if (!source && !icon) {
    return false;
  }

  const root = dom.create("div");
  const stage = dom.create("div");
  const empty = dom.create("span");
  const image = dom.create("img");
  const full = dom.create("button");
  const back = dom.create("button");

  root.className = "image-view";
  stage.className = "image-view-stage";
  empty.className = "image-view-empty";
  image.className = "image-view-media";
  full.type = "button";
  full.className = "image-view-full";
  back.type = "button";
  back.className = "image-view-back";

  empty.classList.add("image-view-media");

  if (icon) {
    dom.set(empty, "data-icon", icon);
  }

  image.hidden = true;
  image.alt = "";
  image.draggable = false;

  dom.set(root, "data-drag", "none");

  dom.set(full, "data-blur", "");
  dom.set(full, "data-icon", "full");
  dom.set(full, "data-tooltip", "player.full");
  dom.set(full, "data-key", "F");
  dom.set(full, "data-circle", "");
  dom.set(full, "data-scale", "");
  dom.set(full, "data-response", "");

  dom.set(back, "data-blur", "");
  dom.set(back, "data-icon", "arrow");
  dom.set(back, "data-circle", "");
  dom.set(back, "data-scale", "");
  dom.set(back, "data-response", "");
  dom.set(back, "data-angle", "left");

  stage.append(empty, image);
  root.append(stage, full, back);

  const state = {
    scale: 1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    pointers: new Map(),
    pan: null,
    pinch: null,
    frame: null,
    close: null,
    closing: false,
    screening: false,
    visible: true,
    disposed: false,
    loading: null,
    box: null,
    drawn: "",
    bridge: null,
    edge: null,
    settling: false
  };

  let album;
  let picture;
  let current;

  const controls = (visible) => {
    const showing = visible && !state.closing;
    const hidden = !showing;

    if (back.hidden !== hidden) back.hidden = hidden;

    full.hidden = hidden || !document.fullscreenEnabled || !root.requestFullscreen;

    if (root.hasAttribute("data-controls") !== showing) {
      root.toggleAttribute("data-controls", showing);
    }

    album?.show(showing);
  };

  const paint = () => {
    if (!state.box || state.disposed) return;

    const width = state.width;
    const height = state.height;
    const wide = picture?.width || image.naturalWidth || width;
    const high = picture?.height || image.naturalHeight || height;
    const fit = Math.min(width / wide, height / high);
    const x = Math.max(0, (wide * fit * state.scale - state.box.width) / 2);
    const y = Math.max(0, (high * fit * state.scale - state.box.height) / 2);

    state.x = clamp(state.x, -x, x);
    state.y = clamp(state.y, -y, y);

    const next = `${state.x}:${state.y}:${state.scale}`;

    if (next === state.drawn) return;

    state.drawn = next;
    css.set(stage, {
      "--image-x": `${state.x}px`,
      "--image-y": `${state.y}px`,
      "--image-scale": state.scale
    });
  };

  const render = () => {
    if (state.frame) {
      return;
    }

    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      paint();
    });
  };

  const measure = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const wide = root.clientWidth;
    const high = root.clientHeight;
    const rect = root.getBoundingClientRect();

    if (!width || !height || !rect.width || !rect.height) return;

    if (state.width && state.height) {
      state.x *= width / state.width;
      state.y *= height / state.height;
    }

    state.width = width;
    state.height = height;
    state.box = {
      left: rect.left,
      top: rect.top,
      width: wide,
      height: high,
      horizontal: wide / rect.width,
      vertical: high / rect.height
    };

    render();
  };

  const point = (event) => {
    const box = state.box;

    return {
      x: (event.clientX - box.left) * box.horizontal - box.width / 2,
      y: (event.clientY - box.top) * box.vertical - box.height / 2
    };
  };

  const zoom = (value, center) => {
    const next = clamp(value, 1, 4);

    if (state.scale <= 1.01 && next > 1.01) album?.reset();

    const ratio = next / state.scale;

    state.x = center.x + (state.x - center.x) * ratio;
    state.y = center.y + (state.y - center.y) * ratio;
    state.scale = next;

    if (state.pan) {
      state.pan.start = null;
      state.pan.press = null;
    }

    const visible = next <= 1.01;

    if (state.visible !== visible) {
      state.visible = visible;
      controls(visible);
    }

    render();
  };

  const gesture = double(root, {
    scale: () => state.scale,
    point,
    zoom,
    enabled: () => !album?.busy && !state.closing && !state.settling
  });

  const beginPinch = () => {
    state.edge?.control.reset();
    state.edge = null;
    album?.reset();

    const points = [...state.pointers.values()].slice(0, 2);

    state.pinch = {
      distance: distance(points) || 1,
      scale: state.scale,
      x: state.x,
      y: state.y,
      center: midpoint(points)
    };

    state.pan = null;
    state.visible = false;
    controls(false);
    dom.set(root, "data-pinching", "");
    dom.remove(root, "data-moving");
  };

  const dismiss = async () => {
    if (state.closing || state.screening || !state.close) {
      return;
    }

    state.closing = true;
    controls(false);

    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
      }

      await state.close(false);
    } finally {
      state.closing = false;
    }
  };

  picture = load(image, {
    target: stage,
    retry: true,
    cache: true,
    progress: false,
    change: render
  });

  album = gallery(root, stage, image, {
    source,
    empty,
    items: Array.isArray(collection) ? collection : collection.items,
    more: collection.more,
    end: collection.end,
    cached: (item) => picture.cached(quality.prepare(item)),
    load: (item) => select(item),
    show: () => controls(state.visible),
    enabled: () => state.scale <= 1.01 && !state.closing,
    reset: (item) => {
      gesture.cancel();
      state.scale = 1;
      state.x = state.y = 0;
      paint();

      const next = item.route || images.identify(item.url, location.origin);

      if (id && next) route.replace("image", ["popover", "image", next]);
    }
  });

  function select(item, defer = false) {
    current = { ...item, message: item.message || anchor?.closest?.(".chatting-message") };

    const prepared = quality.prepare(current);

    if (current.shown && current.preview) prepared.preview = current.preview;

    return picture.set(prepared, defer);
  }

  const release = (event) => {
    if (!state.pointers.has(event.pointerId)) {
      return;
    }

    const pan = state.pan?.id === event.pointerId ? state.pan : null;
    const start = pan?.start;
    const press = pan?.press;
    const tapped =
      event.type === "pointerup" &&
      !event.defaultPrevented &&
      press &&
      event.timeStamp - press.time <= 300 &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 8;

    if (state.edge) {
      const edge = state.edge;
      const current = point(event);
      const distance = Math.max(0, (current.x - start.x) * edge.sign);
      const amount = Math.min(1, distance / Math.max(1, edge.control.size()));
      const complete =
        event.type === "pointerup" && !event.defaultPrevented && amount >= edge.control.ratio();

      edge.control.move(amount);
      state.edge = null;
      state.settling = true;
      void edge.control
        .end(complete)
        .catch(console.error)
        .finally(() => {
          state.settling = false;
        });
    } else if (!tapped && start && state.scale <= 1.01 && pan.axis === "x") {
      const current = point(event);
      const x = current.x - start.x;
      const y = Math.abs(start.y - current.y);
      const minimum = Math.max(24, Math.min(80, state.box.width * 0.2));
      const commit =
        event.type === "pointerup" &&
        !event.defaultPrevented &&
        Math.abs(x) >= minimum &&
        Math.abs(x) > y * 1.5;

      void album.end(Math.abs(x) > y ? x : 0, commit);
    }

    state.pointers.delete(event.pointerId);
    state.pinch = null;
    dom.remove(root, "data-pinching");

    if (state.pointers.size === 1) {
      const [id, current] = state.pointers.entries().next().value;

      state.pan = { id, ...current };
      dom.set(root, "data-moving", "");
    } else {
      state.pan = null;
      dom.remove(root, "data-moving");
      if (tapped) state.visible = press.hidden;

      controls(state.visible);
    }
  };

  const screen = async () => {
    if (
      !root.requestFullscreen ||
      (document.fullscreenElement && document.fullscreenElement !== root) ||
      state.screening ||
      state.closing
    ) {
      return;
    }

    state.screening = true;

    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
      } else {
        await root.requestFullscreen();
      }
    } finally {
      state.screening = false;
    }
  };

  const screenState = () => {
    const active = document.fullscreenElement === root;

    dom.set(full, "data-icon", active ? "full-exit" : "full");
    state.visible = !active && state.scale <= 1.01;
    controls(state.visible);

    measure();
    album?.refresh(true);
  };

  const off = [
    media.keys(root, (key) => {
      if (key !== "f") return false;

      void screen().catch(() => {});
      return true;
    }),
    dom.on(image, "load", render),
    dom.on(window, "resize", () => {
      gesture.cancel();
      state.edge?.control.reset();
      state.edge = null;
      state.pan = state.pinch = null;
      state.pointers.clear();
      dom.remove(root, "data-moving");
      dom.remove(root, "data-pinching");
      measure();
    }),
    dom.on(full, "click", () => {
      screen().catch(() => {});
    }),
    dom.on(back, "click", () => {
      dismiss().catch(() => {});
    }),
    dom.on(document, "fullscreenchange", screenState),
    dom.on(
      root,
      "wheel",
      (event) => {
        if (
          event.ctrlKey ||
          album.busy ||
          state.edge ||
          state.settling ||
          event.target.closest?.(".image-view-preview")
        ) {
          return;
        }

        event.preventDefault();
        if (!state.box) measure();

        zoom(
          state.scale *
            Math.exp(
              -event.deltaY *
                (event.deltaMode === 1 ? 0.024 : event.deltaMode === 2 ? 0.25 : 0.0015)
            ),
          point(event)
        );
      },
      { passive: false }
    ),
    dom.on(root, "pointerdown", (event) => {
      if (
        state.closing ||
        state.settling ||
        album.busy ||
        event.target.closest?.("button, .image-view-preview")
      ) {
        return;
      }

      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      if (!state.pointers.size) {
        state.bridge?.finish();
        measure();
      }

      if (!state.box) return;

      const current = point(event);
      const hidden = !state.visible;

      state.pointers.set(event.pointerId, current);
      root.setPointerCapture(event.pointerId);

      if (state.pointers.size === 1) {
        state.pan = {
          id: event.pointerId,
          ...current,
          start: state.scale <= 1.01 ? { ...current } : null,
          axis: null,
          press: { x: event.clientX, y: event.clientY, time: event.timeStamp, hidden }
        };

        dom.set(root, "data-moving", "");
      } else if (state.pointers.size === 2) {
        beginPinch();
      }
    }),
    dom.on(root, "pointermove", (event) => {
      if (!state.pointers.has(event.pointerId)) {
        return;
      }

      const current = point(event);

      state.pointers.set(event.pointerId, current);

      if (state.pointers.size >= 2 && state.pinch) {
        const points = [...state.pointers.values()].slice(0, 2);

        const center = midpoint(points);
        const next = clamp(state.pinch.scale * (distance(points) / state.pinch.distance), 1, 4);
        const ratio = next / state.pinch.scale;

        state.x = center.x + (state.pinch.x - state.pinch.center.x) * ratio;

        state.y = center.y + (state.pinch.y - state.pinch.center.y) * ratio;

        state.scale = next;
        render();

        return;
      }

      if (state.pan?.id === event.pointerId) {
        if (state.pan.start && state.scale <= 1.01) {
          const pan = state.pan;
          const x = current.x - pan.start.x;
          const y = current.y - pan.start.y;

          if (!pan.axis && Math.hypot(x, y) > 8) {
            pan.axis = Math.abs(x) > Math.abs(y) ? "x" : "y";
            pan.press = null;
          }

          if (pan.axis === "x") {
            if (state.edge && x * state.edge.sign <= 0) {
              state.edge.control.reset();
              state.edge = null;
            }

            if (!state.edge && album.edge(x) && state.bridge) {
              const control = state.bridge.slide(
                x < 0 ? "←" : "→",
                document.fullscreenElement === root ? root : undefined
              );

              if (control?.start) {
                album.reset();
                control.start();
                state.edge = { control, sign: Math.sign(x) };
              }
            }

            if (state.edge) {
              const { control, sign } = state.edge;

              control.move(Math.max(0, x * sign) / Math.max(1, control.size()));
            } else album.drag(x);
          }

          state.x = state.y = 0;
          render();
          return;
        }

        const press = state.pan.press;

        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
          state.pan.press = null;
        }

        state.x += current.x - state.pan.x;
        state.y += current.y - state.pan.y;
        state.pan.x = current.x;
        state.pan.y = current.y;
        render();
      }
    }),
    dom.on(root, "pointerup", release),
    dom.on(root, "pointercancel", release),
    dom.on(root, "lostpointercapture", release)
  ];

  assets.bind(root, () => current && { ...current, kind: "image", open: false });

  controls(state.visible);

  if (source) {
    empty.hidden = true;

    const item = album.current || { url: source };
    const visible = anchor?.matches?.("img")
      ? anchor
      : anchor?.querySelector?.("img:not(.image-load-preview)");

    const shown = Boolean(visible?.complete && visible.naturalWidth && !visible.hidden);
    const preview = shown ? visible.currentSrc : item.preview;

    void select({ ...item, preview, shown }, true);
  } else {
    image.hidden = true;
  }

  let restore;

  try {
    return await popover({
      route: id ? ["image", id] : undefined,
      anchor,
      content: root,
      fullscreen: true,
      ready: (element, close, bridge) => {
        state.bridge = bridge;
        state.close = close;
        restore = theme.color(root);
        screenState();
        state.loading = requestAnimationFrame(() => {
          state.loading = requestAnimationFrame(async () => {
            state.loading = null;

            const animations = element.getAnimations();

            await Promise.allSettled(animations.map((item) => item.finished));
            if (!state.disposed && !state.closing && root.isConnected) {
              measure();
              void picture.start();
            }
          });
        });
      }
    });
  } finally {
    state.disposed = true;
    cancelAnimationFrame(state.loading);
    picture.destroy();
    restore?.();
    album.destroy();
    gesture.destroy();
    off.forEach((remove) => remove());
    cancelAnimationFrame(state.frame);
    css.remove(root);
  }
}
