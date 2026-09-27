import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as rules from "#shared/attach";
import view from "#common/image/view";
import * as assets from "#common/chatting/asset";
import load from "#common/image/load";
import * as rendition from "#shared/rendition";
import * as giphy from "#common/giphy";
import * as files from "#common/file";
import * as video from "#common/video";
import * as playback from "#common/media";

i18n.preload("chatting.attach.reveal");

export default function media(target, options) {
  const items = options.attachments?.length
    ? options.attachments
    : options.image
      ? [
          {
            type: "image",
            image: options.image,
            preview: options.preview || options.image,
            description: "",
            spoiler: false
          }
        ]
      : [];

  if (!rules.valid(items)) return;

  const pictures = [];
  const collection = () =>
    pictures
      .filter(({ button }) => {
        const image = button.querySelector("img:not(.image-load-preview)");

        return !button.hasAttribute("data-spoiler") && image?.src && !image.hidden;
      })
      .map(({ button, url, route, resolve }) => {
        const image = button.querySelector("img:not(.image-load-preview)");

        return {
          url: url || image.src,
          preview: image.src,
          name: image.alt,
          route,
          resolve,
          sender: options,
          time: options.time,
          message: target.closest(".chatting-message")
        };
      });

  const grouped = items.length > 1;
  const content = grouped ? dom.create("div") : target;

  if (grouped) {
    content.className = "chatting-image-group";
  }

  for (const item of items) {
    if (item.type === "file") {
      const url = `${item.file}?${new URLSearchParams({ name: item.name })}`;
      const kind = rules.mime(item.name).split("/")[0];

      if (kind === "image") {
        const button = dom.create("button");
        const image = dom.create("img");

        button.type = "button";
        button.className = "chatting-image";
        image.src = url;
        image.alt = item.name;
        image.draggable = false;
        image.loading = "lazy";
        button.append(image);
        if (item.spoiler) playback.spoiler(button, url, true);

        dom.on(button, "click", () => {
          if (button.hasAttribute("data-spoiler")) {
            playback.spoiler(button, url, false);
            return;
          }

          view(url, button);
        });

        content.append(button);
        assets.bind(button, {
          kind: "image",
          url,
          name: item.name,
          sender: options,
          time: options.time,
          open: () => view(url, button)
        });

        continue;
      }

      if (kind === "audio") {
        const audio = dom.create("audio");
        const wrapper = dom.create("span");

        wrapper.className = "chatting-audio";
        audio.src = url;
        audio.controls = true;
        audio.dataset.name = item.title || item.name;
        audio.dataset.artist = item.artist || "";
        audio.dataset.message = options.token || options.url || "";
        if (item.cover) audio.dataset.cover = item.cover;
        else if (item.cover === false) audio.dataset.cover = "none";

        audio.dataset.size = String(item.size);
        wrapper.append(audio);
        content.append(wrapper);
        assets.bind(wrapper, {
          kind: "audio",
          url,
          name: item.name,
          size: item.size,
          title: item.title,
          artist: item.artist,
          cover: item.cover,
          sender: options,
          time: options.time,
          open: () => audio.play().catch(() => {})
        });

        continue;
      }

      const link =
        kind === "video"
          ? video.thumbnail(url, item.title || item.name, true, item.cover).root
          : files.card(item.name, "a");

      link.classList.add(kind === "video" ? "chatting-image" : "chatting-document");
      if (kind === "video")
        link.querySelector("video").dataset.message = options.token || options.url || "";

      if (link.tagName === "A") {
        link.href = url;
        link.download = item.name;
      }

      dom.set(link, "data-response", "");
      if (item.spoiler && kind === "video") {
        video.spoiler(link, true);
      }

      content.append(link);
      assets.bind(link, {
        kind: ["audio", "video"].includes(kind) ? kind : "file",
        url,
        name: item.name,
        title: item.title,
        cover: item.cover,
        spoiler: item.spoiler,
        sender: options,
        time: options.time,
        ...(kind === "video" && { open: () => video.default(url, link, item.title || item.name) })
      });

      continue;
    }

    if (item.provider === "giphy") {
      const button = dom.create("button");

      button.type = "button";
      button.className = "chatting-image";
      dom.set(button, "data-response", "");
      dom.set(button, "data-giphy", item.type);
      giphy.image(button, item);
      pictures.push({ button, route: `giphy-${item.id}`, resolve: () => giphy.resolve(item.id) });

      dom.on(button, "click", () => {
        const image = button.querySelector("img:not(.image-load-preview)");

        if (image?.src && !image.hidden)
          view(image.src, button, "", `giphy-${item.id}`, collection());
      });

      assets.bind(
        button,
        () => {
          const image = button.querySelector("img:not(.image-load-preview)");

          return (
            image?.src && {
              kind: "image",
              sender: options,
              time: options.time,
              url: image.src,
              preview: image.src,
              name: image.alt,
              resolve: () => giphy.resolve(item.id),
              open: () => view(image.src, button, "", `giphy-${item.id}`, collection())
            }
          );
        },
        false
      );

      content.append(button);
      continue;
    }

    const button = dom.create("button");
    const image = dom.create("img");
    const sticker = item.type === "ogq";
    const source = sticker ? rules.source(item) : item.image;

    button.type = "button";
    button.className = "chatting-image";
    dom.set(button, "data-response", "");

    const still = !sticker && /\.(jpg|png)(?:[?#]|$)/i.test(source);
    const preview =
      (still && rendition.source(source, 640, location.origin)) ||
      (sticker ? source : item.preview || source);

    image.alt = sticker ? "OGQ" : item.description;
    image.draggable = false;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    if (sticker) dom.set(button, "data-ogq", "");

    if (item.spoiler) {
      playback.spoiler(button, source, true);
      image.alt = "";
    }

    button.append(image);
    load(image, {
      target: button,
      source: preview,
      preview: options.previews?.[items.indexOf(item)],
      shown: Boolean(options.previews),
      lazy: !options.previews
    });

    pictures.push({ button, url: source });
    dom.on(button, "click", () => {
      if (button.hasAttribute("data-spoiler")) {
        playback.spoiler(button, source, false);
        image.alt = item.description;
      } else view(source, button, "", undefined, collection());
    });

    assets.bind(
      button,
      () => ({
        kind: "image",
        sender: options,
        time: options.time,
        url: source,
        preview,
        name: image.alt,
        open: () => view(source, button, "", undefined, collection())
      }),
      false
    );

    content.append(button);
  }

  if (grouped) {
    target.append(content);
  }
}
