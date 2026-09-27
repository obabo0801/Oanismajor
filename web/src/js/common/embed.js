import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as link from "#common/link";
import { parse } from "#shared/link";
import { chatting } from "#shared/route";
import api from "#common/api";
import view from "#common/image/view";
import "../../css/common/embed.css";

const cards = new WeakMap();
const live = new Map();
const waiting = new Map();
const cache = new Map();

let observer;
let visible;

i18n.preload("embed.failed");

export const source = (value) => {
  const href = link.resolve(value);

  if (!href) return null;

  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "www.youtube-nocookie.com",
      "youtu.be"
    ].includes(host)
  ) {
    const id =
      host === "youtu.be"
        ? path.slice(1).split("/")[0]
        : path === "/watch"
          ? url.searchParams.get("v")
          : path.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];

    if (/^[\w-]{11}$/.test(id || "")) {
      return {
        type: "iframe",
        url: `https://www.youtube-nocookie.com/embed/${id}`,
        title: "YouTube"
      };
    }
  }

  if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
    const match = path.match(/^\/(?:video\/)?(\d+)(?:\/([a-f\d]+))?\/?$/i);

    if (match) {
      const target = new URL(`https://player.vimeo.com/video/${match[1]}`);
      const hash = match[2] || url.searchParams.get("h");

      target.searchParams.set("dnt", "1");
      if (/^[a-f\d]+$/i.test(hash || "")) target.searchParams.set("h", hash);

      return { type: "iframe", url: target.href, title: "Vimeo" };
    }
  }

  const extension = path.split(".").at(-1)?.toLowerCase();
  const type = ["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(extension)
    ? "img"
    : ["mp4", "webm", "ogv"].includes(extension)
      ? "video"
      : ["mp3", "wav", "ogg", "m4a"].includes(extension)
        ? "audio"
        : "";

  return type ? { type, url: url.href, title: url.hostname } : null;
};

const metadata = (url) => {
  const saved = cache.get(url);

  if (saved && saved.until > Date.now()) return saved.value;

  const value = api(`${chatting}/embed`, {
    method: "POST",
    data: { url },
    signal: AbortSignal.timeout(8000)
  }).then((result) => (result.ok ? result.data : null));

  cache.set(url, { value, until: Date.now() + 600000 });
  if (cache.size > 100) cache.delete(cache.keys().next().value);

  return value;
};

const release = (root) => {
  const media = live.get(root);

  if (media instanceof HTMLMediaElement) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }

  media?.remove();
  live.delete(root);
};

const clean = (root) => {
  const state = waiting.get(root);

  if (!state) return;

  state.dead = true;
  visible?.unobserve(root);
  release(root);
  waiting.delete(root);
  if (!waiting.size) {
    observer?.disconnect();
    visible?.disconnect();
    observer = visible = undefined;
  }
};

const watch = (root, state) => {
  waiting.set(root, state);
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const [node, value] of waiting) {
        if (node.isConnected) value.connected = true;
        else if (value.connected) clean(node);
      }
    });

    observer.observe(document, { childList: true, subtree: true });
  }

  if (typeof IntersectionObserver === "function") {
    visible ||= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !entry.target.isConnected) continue;

          const value = waiting.get(entry.target);

          if (!value) continue;

          value.connected = true;
          visible.unobserve(entry.target);
          void value.load();
        }
      },
      { rootMargin: "128px" }
    );

    visible.observe(root);
  } else {
    queueMicrotask(() => {
      if (root.isConnected) {
        state.connected = true;
        void state.load();
      }
    });
  }
};

export function update(root, value) {
  const state = cards.get(root);

  if (!state || !value || state.dead) return;

  state.data = value;
  state.title.textContent = String(value.title || state.name);
  state.description.textContent = String(value.description || "");
  state.description.hidden = !state.description.textContent;
  if (state.active && state.loaded && !live.has(root)) void state.load();
}

export default function embed(value, options = {}) {
  const href = link.resolve(value);

  if (!href || !/^https?:/i.test(href)) return null;

  const root = dom.create("span");
  const title = dom.create("a");
  const origin = dom.create("span");
  const description = dom.create("span");
  const body = dom.create("span");
  const notice = dom.create("span");
  const url = new URL(href);
  const state = {
    name: String(options.title || href),
    title,
    description,
    data: options.data || null,
    load: null,
    busy: false,
    loaded: false,
    active: false,
    connected: root.isConnected,
    dead: false
  };

  root.className = "embed";
  title.className = "embed-title";
  origin.className = "embed-origin";
  description.className = "embed-description";
  body.className = "embed-body";
  notice.className = "embed-notice";
  title.textContent = state.name;
  origin.textContent = url.origin;
  description.hidden = body.hidden = notice.hidden = true;
  dom.set(notice, "data-i18n", "embed.failed");
  notice.textContent = i18n.message("embed.failed");
  link.bind(title, {
    url: href,
    name: state.name,
    target: options.target,
    confirm: options.confirm
  });

  root.append(title, origin, description, notice, body);
  cards.set(root, state);

  const valid = () => !state.dead && root.isConnected;
  const failed = () => {
    if (!valid()) return;

    notice.hidden = false;
    body.hidden = true;
    release(root);
  };

  state.load = async () => {
    if (state.busy || state.dead || live.has(root) || !root.isConnected) return;

    state.active = state.busy = true;
    notice.hidden = true;
    try {
      let item = source(href);

      if (!item) {
        const data =
          state.data || (options.metadata ? await options.metadata() : await metadata(href));

        if (!valid()) return;

        if (!data) throw new Error("Metadata unavailable");

        update(root, data);

        const image = link.resolve(data.image);

        if (image && /^https?:/i.test(image)) {
          item = { type: "img", url: image, title: state.name };
        }
      }

      if (!valid() || !item) return;

      const media = dom.create(item.type);

      if (item.type === "iframe") {
        media.title = item.title;
        media.referrerPolicy = "strict-origin-when-cross-origin";
        media.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");

        media.allow = "fullscreen; picture-in-picture; encrypted-media";
        media.allowFullscreen = true;
      } else if (item.type === "img") {
        media.alt = state.title.textContent;
        media.draggable = false;
        media.decoding = "async";
        media.referrerPolicy = "no-referrer";
        media.hidden = true;
        dom.on(media, "load", async () => {
          try {
            await media.decode();
            if (valid() && live.get(root) === media) media.hidden = false;
          } catch {
            if (live.get(root) === media) failed();
          }
        });

        dom.on(media, "click", () => {
          void view(item.url, media).catch(console.error);
        });
      } else {
        media.controls = true;
        media.preload = "metadata";
        if (item.type === "video") media.playsInline = true;
      }

      dom.on(
        media,
        "error",
        () => {
          if (live.get(root) === media) failed();
        },
        { once: true }
      );

      live.set(root, media);
      media.src = item.url;
      body.replaceChildren(media);
      body.hidden = false;
    } catch {
      failed();
    } finally {
      state.busy = false;
      state.loaded = true;
    }
  };

  if (state.data) update(root, state.data);

  watch(root, state);

  return root;
}

export function append(target, value) {
  const urls = new Set();

  for (const part of parse(value, location.href)) {
    if (!part.url || !/^https?:/i.test(part.url) || urls.has(part.url)) continue;

    if (new URL(part.url).origin === location.origin && !source(part.url)) continue;

    urls.add(part.url);

    const root = embed(part.url, { title: part.text });

    if (root) target.append(root);

    if (urls.size >= 3) break;
  }
}
