import * as css from "#common/css";
import * as dom from "#common/dom";
import device from "#common/device";
import popover from "#common/popover";
import double from "#common/image/double";
import toolbar from "#common/toolbar";
import range from "#common/range";
import * as i18n from "#common/i18n";
import { bounds } from "#shared/image";

i18n.preload("image.title", "image.confirm", "image.rotate", "image.zoom");

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const create = (tag, name) => {
  const element = dom.create(tag);

  element.className = name;

  return element;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const distance = ([first, second]) => Math.hypot(second.x - first.x, second.y - first.y);

const midpoint = ([first, second]) => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
});

const loadImage = async (file) => {
  const image = dom.create("img");
  const url = URL.createObjectURL(file);

  image.className = "image-preview";
  image.alt = "";
  image.draggable = false;
  image.src = url;

  try {
    await image.decode();

    return { image, url, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    URL.revokeObjectURL(url);

    return null;
  }
};

const loadCanvas = async (file, limit) => {
  if (typeof createImageBitmap !== "function") {
    return null;
  }

  let bitmap;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const ratio = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));

    const width = Math.max(1, Math.round(bitmap.width * ratio));

    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const image = dom.create("canvas");
    const context = image.getContext("2d");

    if (!context) {
      return null;
    }

    image.className = "image-preview";
    image.width = width;
    image.height = height;
    image.draggable = false;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    return { image, url: null, width, height };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
};

const animated = (file) =>
  file.type?.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name || "");

const load = async (file, limit) =>
  animated(file) ? loadImage(file) : (await loadCanvas(file, limit)) || loadImage(file);

const createState = () => ({
  model: { angle: 0, scale: 1, x: 0, y: 0, view: null },
  gesture: { pointers: new Map(), pan: null, pinch: null },
  timer: { cursor: null },
  raf: { draw: null, measure: null },
  layout: { width: 0, height: 0, left: 0, top: 0, visualWidth: 0, visualHeight: 0 }
});

export default async function edit(file, options = {}) {
  if (!(file instanceof Blob) || !file.size) {
    return null;
  }

  let width = Math.max(1, Number(options.width) || 512);
  let height = Math.max(1, Number(options.height) || 512);

  const loaded = await load(file, Math.max(width, height) * 3);

  if (!loaded) {
    return null;
  }

  const shape = ["circle", "original"].includes(options.shape) ? options.shape : "square";

  const { image, url, width: sourceWidth, height: sourceHeight } = loaded;

  if (shape === "original") {
    const ratio = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));

    width = Math.max(1, Math.round(sourceWidth * ratio));
    height = Math.max(1, Math.round(sourceHeight * ratio));
  }

  const root = create("div", "image-editor");
  const stage = create("div", "image-stage");
  const frame = create("div", "image-frame");
  const dock = create("div", "image-tools");
  const controls = create("div", "image-controls");
  const label = create("label", "image-value");
  const ruler = create("div", "range");
  const track = create("div", "range-track");
  const thumb = create("div", "range-thumb");
  const slider = dom.create("input");

  slider.type = "range";
  slider.id = crypto.randomUUID();
  slider.step = "1";
  label.htmlFor = slider.id;

  dom.set(root, "data-drag", "none");
  dom.set(dock, "data-drag", "none");
  dom.set(stage, "data-shape", shape);
  css.set(root, { "--image-aspect": width / height });

  frame.append(image);
  stage.append(frame);
  ruler.append(track, thumb, slider);
  controls.append(label, ruler);
  root.append(stage);

  const { model, gesture, timer, raf, layout } = createState();

  let tool = "rotate";
  let initial;

  const size = () => {
    if (shape !== "original") return;
    const rotated = bounds(sourceWidth, sourceHeight, model.angle);
    const ratio = Math.min(1, 1024 / Math.max(rotated.width, rotated.height));

    width = Math.max(1, Math.round(rotated.width * ratio));
    height = Math.max(1, Math.round(rotated.height * ratio));
    css.set(root, { "--image-aspect": rotated.width / rotated.height });
  };

  const state = () => [
    ((model.angle % 360) + 360) % 360,
    model.scale,
    model.x / (layout.width || 1),
    model.y / (layout.height || 1)
  ];

  const unchanged = () =>
    !initial || state().every((value, index) => Math.abs(value - initial[index]) < 0.000001);

  const sync = () => {
    const rotation = tool === "rotate";
    const angle = ((((model.angle + 180) % 360) + 360) % 360) - 180;
    const value = rotation ? (model.angle === 180 ? 180 : angle) : model.scale * 100;

    slider.min = rotation ? "-180" : "100";
    slider.max = rotation ? "180" : "300";
    slider.value = String(Math.round(value));
    label.textContent = `${Math.round(value)}${rotation ? "°" : "%"}`;
    dom.set(slider, "data-tooltip", `image.${tool}`);
    range(controls);
  };

  const metrics = () => {
    const { width: stageWidth, height: stageHeight } = layout;
    const radians = (model.angle * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const horizontal = Math.abs(cosine);
    const vertical = Math.abs(sine);
    const rotated = bounds(sourceWidth, sourceHeight, model.angle);
    const base =
      shape === "original"
        ? Math.min(stageWidth / rotated.width, stageHeight / rotated.height)
        : Math.max(stageWidth / sourceWidth, stageHeight / sourceHeight);

    const cover =
      shape === "circle" || shape === "original"
        ? base
        : Math.max(
            (stageWidth * horizontal + stageHeight * vertical) / sourceWidth,
            (stageWidth * vertical + stageHeight * horizontal) / sourceHeight
          );

    return {
      width: stageWidth,
      height: stageHeight,
      base,
      cosine,
      sine,
      horizontal,
      vertical,
      cover
    };
  };

  const paint = () => {
    const {
      width: stageWidth,
      height: stageHeight,
      base,
      cosine,
      sine,
      horizontal,
      vertical,
      cover
    } = metrics();

    if (!stageWidth || !stageHeight) {
      return;
    }

    model.view = { width: stageWidth, height: stageHeight, base, cover };

    const zoom = base * model.scale;
    const localX = model.x * cosine + model.y * sine;
    const localY = -model.x * sine + model.y * cosine;
    const requiredX =
      shape === "circle" ? stageWidth : stageWidth * horizontal + stageHeight * vertical;

    const requiredY =
      shape === "circle" ? stageHeight : stageWidth * vertical + stageHeight * horizontal;

    const limitX = Math.max(0, (sourceWidth * zoom - requiredX) / 2);

    const limitY = Math.max(0, (sourceHeight * zoom - requiredY) / 2);
    const nextX = clamp(localX, -limitX, limitX);
    const nextY = clamp(localY, -limitY, limitY);

    model.x = nextX * cosine - nextY * sine;
    model.y = nextX * sine + nextY * cosine;

    if (shape === "original") {
      const rotated = bounds(sourceWidth * zoom, sourceHeight * zoom, model.angle);
      const limitX = Math.max(0, (rotated.width - stageWidth) / 2);
      const limitY = Math.max(0, (rotated.height - stageHeight) / 2);

      model.x = clamp(localX * cosine - localY * sine, -limitX, limitX);
      model.y = clamp(localX * sine + localY * cosine, -limitY, limitY);
    }

    css.set(root, {
      "--image-width": `${sourceWidth * base}px`,
      "--image-height": `${sourceHeight * base}px`,
      "--image-scale": model.scale,
      "--image-x": `${model.x}px`,
      "--image-y": `${model.y}px`,
      "--image-angle": `${model.angle}deg`
    });

    sync();
    root.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const render = () => {
    if (raf.draw) {
      return;
    }

    raf.draw = requestAnimationFrame(() => {
      raf.draw = null;
      paint();
    });
  };

  const measure = () => {
    const rect = stage.getBoundingClientRect();
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;

    if (!stageWidth || !stageHeight) return;

    if (shape === "original" && model.view?.base) {
      const rotated = bounds(sourceWidth, sourceHeight, model.angle);
      const base = Math.min(stageWidth / rotated.width, stageHeight / rotated.height);
      const ratio = base / model.view.base;

      model.x *= ratio;
      model.y *= ratio;
    } else if (layout.width && layout.height) {
      model.x *= stageWidth / layout.width;
      model.y *= stageHeight / layout.height;
    }

    Object.assign(layout, {
      width: stageWidth,
      height: stageHeight,
      left: rect.left,
      top: rect.top,
      visualWidth: rect.width,
      visualHeight: rect.height
    });

    render();
  };

  const position = (event) => ({
    x:
      (event.clientX - layout.left) * (layout.width / (layout.visualWidth || layout.width)) -
      layout.width / 2,
    y:
      (event.clientY - layout.top) * (layout.height / (layout.visualHeight || layout.height)) -
      layout.height / 2
  });

  const zoomTo = (value, point) => {
    const next = clamp(value, 1, 3);
    const ratio = next / model.scale;

    model.x = point.x + (model.x - point.x) * ratio;
    model.y = point.y + (model.y - point.y) * ratio;
    model.scale = next;
    render();
  };

  const showZoom = (next) => {
    if (next === model.scale) {
      return false;
    }

    dom.set(stage, "data-zoom", next > model.scale ? "in" : "out");

    clearTimeout(timer.cursor);
    timer.cursor = setTimeout(() => {
      dom.remove(stage, "data-zoom");
    }, 160);

    return true;
  };

  const tapping = double(stage, {
    scale: () => model.scale,
    point: position,
    zoom: (value, point) => {
      showZoom(value);
      zoomTo(value, point);
    }
  });

  const tools = toolbar(
    ["rotate", "zoom"].map((name) => ({
      icon: name === "rotate" ? "rotate" : "search",
      text: `image.${name}`,
      run: (button) => {
        if (tool === name) return;

        tapping.cancel();
        tool = name;
        [...tools.children].forEach((item) => dom.remove(item, "data-active"));
        dom.set(button, "data-active", "");
        sync();
        controls.getAnimations().forEach((animation) => animation.cancel());
        if (!reduce.matches) controls.animate({ opacity: [0.4, 1] }, { duration: 160 });
      }
    }))
  );

  dom.set(tools.firstElementChild, "data-active", "");
  dock.append(controls, tools);

  const beginPinch = () => {
    const points = [...gesture.pointers.values()].slice(0, 2);
    const center = midpoint(points);

    gesture.pinch = {
      distance: distance(points) || 1,
      scale: model.scale,
      x: model.x,
      y: model.y,
      center
    };

    gesture.pan = null;
    dom.remove(stage, "data-moving");
  };

  dom.on(
    stage,
    "wheel",
    (event) => {
      if (event.ctrlKey) {
        return;
      }

      event.preventDefault();

      const next = clamp(
        model.scale *
          Math.exp(
            -event.deltaY * (event.deltaMode === 1 ? 0.024 : event.deltaMode === 2 ? 0.25 : 0.0015)
          ),
        1,
        3
      );

      if (showZoom(next)) {
        zoomTo(next, position(event));
      }
    },
    { passive: false }
  );

  dom.on(stage, "pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    measure();

    const point = position(event);

    gesture.pointers.set(event.pointerId, point);
    stage.setPointerCapture(event.pointerId);

    if (gesture.pointers.size === 1) {
      gesture.pan = { id: event.pointerId, ...point };
      dom.set(stage, "data-moving", "");
    } else if (gesture.pointers.size === 2) {
      beginPinch();
    }
  });

  dom.on(stage, "pointermove", (event) => {
    if (!gesture.pointers.has(event.pointerId)) {
      return;
    }

    const current = position(event);

    gesture.pointers.set(event.pointerId, current);

    if (gesture.pointers.size >= 2 && gesture.pinch) {
      const points = [...gesture.pointers.values()].slice(0, 2);
      const center = midpoint(points);

      const next = clamp(gesture.pinch.scale * (distance(points) / gesture.pinch.distance), 1, 3);
      const ratio = next / gesture.pinch.scale;

      showZoom(next);
      model.x = center.x + (gesture.pinch.x - gesture.pinch.center.x) * ratio;

      model.y = center.y + (gesture.pinch.y - gesture.pinch.center.y) * ratio;

      model.scale = next;
      render();

      return;
    }

    if (gesture.pan?.id === event.pointerId) {
      model.x += current.x - gesture.pan.x;
      model.y += current.y - gesture.pan.y;
      gesture.pan.x = current.x;
      gesture.pan.y = current.y;
      render();
    }
  });

  const releasePointer = (event) => {
    if (!gesture.pointers.has(event.pointerId)) {
      return;
    }

    gesture.pointers.delete(event.pointerId);
    gesture.pinch = null;
    dom.remove(stage, "data-zoom");

    if (gesture.pointers.size === 1) {
      const [id, point] = gesture.pointers.entries().next().value;

      gesture.pan = { id, ...point };
      dom.set(stage, "data-moving", "");
    } else {
      gesture.pan = null;
      dom.remove(stage, "data-moving");
    }
  };

  dom.on(stage, "pointerup", releasePointer);
  dom.on(stage, "pointercancel", releasePointer);
  dom.on(stage, "lostpointercapture", releasePointer);

  const rotateBy = (difference) => {
    tapping.cancel();

    const radians = (difference * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const nextX = model.x * cosine - model.y * sine;
    const nextY = model.x * sine + model.y * cosine;

    model.x = nextX;
    model.y = nextY;
    model.angle += difference;
    size();
    if (shape === "original") measure();

    render();
  };

  dom.on(slider, "input", () => {
    tapping.cancel();

    const value = Number(slider.value);

    if (tool === "rotate") rotateBy(value - model.angle);
    else zoomTo(value / 100, { x: 0, y: 0 });
  });

  const resize = () => {
    if (raf.measure) {
      return;
    }

    raf.measure = requestAnimationFrame(() => {
      raf.measure = null;
      measure();
    });
  };

  const removeResize = [dom.on(window, "resize", resize)];

  let confirmed;

  try {
    confirmed = await popover({
      anchor: options.anchor,
      back: true,
      title: options.title || "image.title",
      content: root,
      toolbar: dock,
      closing: () => {
        tapping.cancel();
        dock.inert = root.inert = true;
        controls.getAnimations().forEach((animation) => animation.cancel());
      },
      ready: () => {
        measure();

        if (options.edit) {
          const number = (value, fallback = 0) =>
            Number.isFinite(Number(value)) ? Number(value) : fallback;

          model.angle = number(options.edit.angle) % 360;
          size();
          measure();
          Object.assign(model, {
            scale: clamp(number(options.edit.scale, 1), 1, 3),
            x: number(options.edit.x) * layout.width,
            y: number(options.edit.y) * layout.height
          });

          paint();
        }

        initial = state();
        sync();
        root.dispatchEvent(new Event("input", { bubbles: true }));
      },
      actions: [
        {
          text: "image.confirm",
          icon: "check",
          head: true,
          value: true,
          disabled: unchanged,
          run: () => tapping.cancel()
        }
      ],
      fullscreen: !device().window
    });
  } catch (error) {
    if (url) {
      URL.revokeObjectURL(url);
    }

    css.remove(root);
    throw error;
  } finally {
    removeResize.forEach((remove) => remove());
    tapping.destroy();
    clearTimeout(timer.cursor);
    cancelAnimationFrame(raf.measure);
    cancelAnimationFrame(raf.draw);
    raf.measure = null;
    raf.draw = null;
  }

  if (confirmed) {
    paint();
  }

  let result = null;

  if (confirmed && model.view) {
    const base = Math.max(model.view.width / sourceWidth, model.view.height / sourceHeight);

    result = {
      file,
      edit: {
        width,
        height,
        shape,
        angle: model.angle,
        scale: model.scale,
        x: model.x / model.view.width,
        y: model.y / model.view.height,
        previewScale: base ? (model.view.cover * model.scale) / base : model.scale
      }
    };
  }

  if (url) {
    URL.revokeObjectURL(url);
  }

  css.remove(root);

  return result;
}
