import * as dom from "#common/dom";
import * as link from "#common/link";
import * as manage from "#common/chatting/manage";
import * as quality from "#common/image/quality";
import load from "#common/image/load";
import * as files from "#common/file";
import * as video from "#common/video";
import * as media from "#common/media";
import * as player from "#common/player";
import context from "#common/context";
import sheet from "#common/sheet";
import "../../../css/common/chatting/asset.css";

const entries = new WeakMap();
const opened = new WeakSet();

export const single = (message) => {
  const targets = dom.all(".chatting-text *", message).filter((element) => entries.has(element));

  return targets.length === 1 ? targets[0] : null;
};

const node = (tag, name, text = "") => {
  const element = dom.create(tag);

  element.className = name;
  element.textContent = text;

  return element;
};

export const find = (target) => {
  for (let element = target; element instanceof Element; element = element.parentElement) {
    if (entries.has(element)) return element;
  }

  return null;
};

export async function open(target) {
  if (!target || opened.has(target) || target.hasAttribute("data-spoiler")) return;

  if (target.closest(".chatting-message[data-pending]")) return;

  const stored = entries.get(target);
  const value = typeof stored === "function" ? stored() : stored;

  if (!value?.url) return;

  opened.add(target);

  const picture = value.kind === "image";
  const message = target.closest(".chatting-message") || value.message;
  const options = manage.read(message, value.record || {});

  if (message?.hasAttribute("data-deleted") && !manage.allowed(message, options)) {
    opened.delete(target);
    return;
  }

  let loading;
  let restore;
  let original;

  try {
    let selected;

    if (picture) {
      selected = node("span", "chatting-image");

      const image = node("img", "");

      image.hidden = true;
      image.alt = value.name || "";
      image.draggable = false;
      image.referrerPolicy = "no-referrer";
      selected.append(image);
      loading = load(image, { target: selected, source: quality.thumb(value), progress: false });
    } else if (value.kind === "video") {
      original = target.matches(".video-thumbnail")
        ? target
        : target.querySelector(".video-thumbnail");

      if (!original?.querySelector(".video-surface"))
        original = media
          .find(value.url, "video", options.token || options.url)
          ?.closest(".video-thumbnail");

      loading = video.thumbnail(value.url, value.title || value.name, !original, value.cover);
      selected = node("span", "video-preview");
      selected.append(loading.root);
    } else if (value.kind === "audio") {
      selected = node("span", "chatting-audio");
      original = target.matches(".player") ? target : target.querySelector(".player");
      original ||= media.find(value.url, "audio", options.token || options.url)?.closest(".player");

      if (!original) {
        const audio = dom.create("audio");
        const original = target.querySelector("audio");

        audio.src = value.url;
        audio.dataset.channel = original?.dataset.channel || value.channel || "media";
        audio.controls = true;
        audio.dataset.name = original?.dataset.name || value.title || value.name || "";
        audio.dataset.artist = original?.dataset.artist ?? value.artist ?? "";
        audio.dataset.cover =
          original?.dataset.cover || (value.cover === false ? "none" : value.cover || "");

        if (value.size) audio.dataset.size = String(value.size);

        audio.toggleAttribute(
          "data-stt",
          original?.hasAttribute("data-stt") ||
            Boolean(value.speech) ||
            /\.(mp3|webm|ogg|m4a)$/i.test(new URL(value.url, location.href).pathname)
        );

        audio.dataset.caption = original?.dataset.caption || value.caption || options.text || "";
        audio.dataset.message = original?.dataset.message || options.url || options.token || "";
        audio.dataset.room = original?.dataset.room || (options.private ? options.room : "") || "";
        selected.append(audio);
      }
    } else if (value.kind === "file") {
      selected = files.card(value.name || "");
    } else {
      selected = node("span", "asset");

      const icon = node("span", "asset-icon");
      const body = node("span", "asset-body");

      dom.set(icon, "data-icon", value.kind === "file" ? "download" : "link");
      if (value.name) body.append(node("span", "asset-title", value.name));

      body.append(node("span", "asset-address", value.url));
      selected.append(icon, body);
    }

    let menu;

    const result = await sheet({
      closing: () => {
        restore?.();
        restore = null;
        if (loading?.root) loading.root.hidden = false;
      },
      route: [
        "target",
        `${location.pathname}?${new URLSearchParams({ ...(options.url || options.token ? { message: options.url || options.token } : {}), [value.kind]: value.url })}`
      ],
      direction: "↓",
      content: async () => {
        menu = await manage.menu(message, options, { ...value, content: selected }, target);
        return {
          content: menu.root,
          dispose: menu.off,
          ready: () => {
            if (!original) return;

            if (loading?.root) loading.root.hidden = true;

            restore = media.borrow(original, selected);
          }
        };
      }
    });

    await menu?.run(result);

    if (result !== "open") return result;

    if (value.kind === "audio") return player.open(value, target);

    if (typeof value.open === "function") return value.open();

    if (picture) return false;

    return link.open(value.url, { file: value.kind === "file", confirm: true, name: value.name });
  } finally {
    restore?.();
    loading?.destroy();
    opened.delete(target);
  }
}

export const bind = (element, value, listen = true) => {
  const attached = entries.has(element);

  entries.set(element, value);
  if (listen && !attached) {
    const ignore = element.matches(".image-view")
      ? "button, .image-view-preview, audio, video"
      : "audio, video";

    context(
      element,
      () => {
        void open(element).catch(console.error);
      },
      ignore
    );
  }

  return element;
};
