import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import progress from "#common/progress";
import "../../../css/common/image/load.css";

i18n.preload("gallery.failed", "gallery.retry");

const memory = new Map();
const maximum = 8;
const budget = 16000000;

const key = (item) => {
  try {
    return `${item.route || ""}|${new URL(item.url, location.href).href}`;
  } catch {
    return "";
  }
};

const trim = () => {
  let pixels = [...memory.values()].reduce((total, item) => total + item.pixels, 0);

  for (const [name, item] of memory) {
    if (memory.size <= maximum && pixels <= budget) break;

    memory.delete(name);
    pixels -= item.pixels;
  }
};

const cached = (item) => {
  const name = key(item);
  const value = memory.get(name);

  if (!value?.loaded) return null;

  memory.delete(name);
  memory.set(name, value);

  return value;
};

const borrow = (entry) => {
  let released = false;

  entry.uses += 1;

  return {
    ready: entry.ready,
    release() {
      if (released) return;

      released = true;
      entry.uses -= 1;
      if (!entry.loaded && !entry.uses) entry.cancel();
    }
  };
};

const acquire = (item) => {
  const name = key(item);
  const previous = memory.get(name);

  if (previous) return borrow(previous);

  const image = dom.create("img");
  const entry = { image, loaded: false, pixels: 0, ready: null, uses: 0, cancel: null };

  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  memory.set(name, entry);
  trim();

  entry.ready = new Promise((resolve, reject) => {
    let done = false;

    const timer = setTimeout(() => finish(false), 30000);

    function finish(ok) {
      if (done) return;

      done = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;

      if (!ok) {
        if (memory.get(name) === entry) memory.delete(name);

        image.removeAttribute("src");
        reject(new Error("Image unavailable"));
        return;
      }

      entry.loaded = true;
      entry.pixels = image.naturalWidth * image.naturalHeight;
      trim();
      resolve(entry);
    }

    entry.cancel = () => finish(false);

    image.onload = async () => {
      try {
        await image.decode();
        finish(image.naturalWidth > 0);
      } catch {
        finish(false);
      }
    };

    image.onerror = () => finish(false);

    Promise.resolve()
      .then(() => {
        if (done) return "";

        return item.resolve ? item.resolve() : item.url;
      })
      .then((value) => {
        if (done) return;

        if (!value) throw new Error("Missing image");

        image.src = new URL(value, location.href).href;
      })
      .catch(() => finish(false));
  });

  return borrow(entry);
};

export default function load(image, options = {}) {
  const target = options.target || image.parentElement;
  const overlay = dom.create("span");
  const label = dom.create("span");
  const retry = options.retry ? dom.create("button") : null;
  const preview = image.cloneNode(false);
  const loading =
    options.progress === true ? progress({ type: "circular", value: 25, show: false }) : null;

  let item;
  let decoded;
  let token = 0;
  let dead = false;
  let pending = false;
  let started = false;
  let timer;
  let finish;
  let ready = Promise.resolve(false);
  let off = [];

  image.hidden = true;
  image.decoding = "async";
  image.loading = options.lazy ? "lazy" : "eager";
  preview.removeAttribute("src");
  preview.removeAttribute("srcset");
  preview.removeAttribute("id");
  preview.removeAttribute("data-css");
  preview.classList.add("image-load-preview");
  preview.alt = "";
  preview.draggable = false;
  preview.decoding = "async";
  preview.loading = "eager";
  preview.hidden = true;
  overlay.className = "image-loading";
  label.className = "image-loading-label";
  dom.set(label, "data-i18n", "gallery.failed");
  label.textContent = i18n.message("gallery.failed");
  label.hidden = true;
  overlay.hidden = true;
  if (loading) overlay.append(loading.element);

  overlay.append(label);

  if (retry) {
    retry.type = "button";
    retry.className = "image-loading-retry";
    dom.set(retry, "data-i18n", "gallery.retry");
    dom.set(retry, "data-response", "");
    retry.textContent = i18n.message("gallery.retry");
    retry.hidden = true;
    overlay.append(retry);
  }

  if (options.retry && image.parentElement === target) {
    target.insertBefore(preview, image);
  } else target.append(preview);

  target.append(overlay);

  const cancel = () => {
    token += 1;
    clearTimeout(timer);
    off.forEach((remove) => remove());
    off = [];
    finish?.(false);
    finish = undefined;
  };

  const settle = (ok, id) => {
    if (dead || id !== token || !pending) return;

    pending = false;
    clearTimeout(timer);
    off.forEach((remove) => remove());
    off = [];
    if (ok) dom.remove(preview, "data-soft");

    image.hidden = !ok;
    image.toggleAttribute("data-pending", !ok);
    overlay.hidden = ok;
    if (loading) loading.element.hidden = true;

    label.hidden = ok;
    if (retry) retry.hidden = ok;

    if (ok) preview.hidden = true;

    dom.set(target, "data-image-state", ok ? "ready" : "error");
    finish?.(ok);
    finish = undefined;
    options.change?.(ok);
  };

  const start = async () => {
    if (dead || started || !item) return ready;

    started = true;

    const id = token;

    if (!options.lazy) timer = setTimeout(() => settle(false, id), 30000);

    try {
      if (options.cache && item.cache !== false) {
        const request = acquire(item);

        off.push(request.release);

        const value = await request.ready;

        if (dead || id !== token || !pending) return false;

        decoded = value.image;
        if (image.src !== decoded.src) image.src = decoded.src;

        image.hidden = false;
        await image.decode();
        if (dead || id !== token || !pending) return false;

        settle(true, id);
        return ready;
      }

      const value = item.resolve ? await item.resolve() : item.url;

      if (dead || id !== token || !pending) return false;

      if (!value) throw new Error("Missing image");

      const url = new URL(value, location.href).href;
      const loaded = async () => {
        if (dead || id !== token || image.src !== url) return;

        try {
          if (typeof image.decode === "function") await image.decode();

          if (!image.naturalWidth) throw new Error("Invalid image");

          settle(true, id);
        } catch {
          settle(false, id);
        }
      };

      off.push(dom.on(image, "load", loaded));
      off.push(dom.on(image, "error", () => settle(false, id)));
      image.src = url;
      image.hidden = false;
      if (image.complete && image.naturalWidth) void loaded();
    } catch {
      settle(false, id);
    }

    return ready;
  };

  const set = (value, defer = false) => {
    const next = typeof value === "string" ? { url: value } : value;

    if (dead || !next) return Promise.resolve(false);

    if (
      item &&
      key(next) === key(item) &&
      !pending &&
      target.getAttribute("data-image-state") === "ready"
    ) {
      return Promise.resolve(true);
    }

    if (item && key(next) === key(item) && pending) {
      if (!defer && !started) void start();

      return ready;
    }

    cancel();
    item = next;
    if (dead || !item) return Promise.resolve(false);

    pending = true;
    started = false;
    ready = new Promise((resolve) => {
      finish = resolve;
    });

    const saved = options.cache && item.cache !== false && cached(item);

    decoded = saved ? saved.image : null;
    image.hidden = true;
    label.hidden = true;
    if (retry) retry.hidden = true;

    image.toggleAttribute("data-cached", Boolean(saved));
    if (saved) {
      started = true;

      const id = token;

      preview.hidden = true;
      dom.set(image, "data-pending", "");
      if (image.src !== decoded.src) image.src = decoded.src;

      image.hidden = false;
      void image
        .decode()
        .then(() => {
          if (!dead && id === token) settle(true, id);
        })
        .catch(() => settle(false, id));

      return ready;
    }

    image.removeAttribute("src");
    dom.set(image, "data-pending", "");
    dom.set(target, "data-image-state", "loading");
    label.hidden = true;
    if (retry) retry.hidden = true;

    overlay.hidden = !loading;
    if (loading) loading.element.hidden = false;

    preview.hidden = true;
    preview.toggleAttribute("data-soft", item.shown !== true);

    if (item.preview && (item.shown || item.preview !== item.url || item.resolve)) {
      const url = new URL(item.preview, location.href).href;
      const id = token;

      if (preview.src !== url) preview.src = url;

      const reveal = () => {
        if (!dead && id === token && pending && preview.naturalWidth) preview.hidden = false;
      };

      if (preview.complete && preview.naturalWidth) reveal();
      else
        void preview
          .decode()
          .then(reveal)
          .catch(() => {});
    } else preview.removeAttribute("src");

    if (!defer) void start();

    return ready;
  };

  const failed = dom.on(preview, "error", () => {
    if (preview.complete && !preview.naturalWidth) preview.hidden = true;
  });

  const repeat = dom.on(retry, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void set(item);
  });

  if (options.source) {
    void set(
      { url: options.source, preview: options.preview, shown: options.shown },
      options.defer
    );
  }

  return {
    set,
    start,
    get pending() {
      return pending;
    },
    get ready() {
      return ready;
    },
    cached(value) {
      return cached(value)?.image.src || "";
    },
    get width() {
      return decoded?.naturalWidth || image.naturalWidth || preview.naturalWidth;
    },
    get height() {
      return decoded?.naturalHeight || image.naturalHeight || preview.naturalHeight;
    },
    destroy() {
      if (dead) return;

      dead = true;
      pending = false;
      cancel();
      failed();
      repeat();
      loading?.destroy();
      decoded = null;
      image.removeAttribute("src");
      image.removeAttribute("data-pending");
      image.removeAttribute("data-cached");
      target.removeAttribute("data-image-state");
      preview.removeAttribute("src");
      preview.remove();
      overlay.remove();
    }
  };
}
