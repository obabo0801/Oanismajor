import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as clock from "#common/chatting/time";
import { chatting as path } from "#shared/route";
import api from "#common/api";
import drawer from "#common/drawer";
import view from "#common/image/view";
import * as actions from "#common/chatting/asset";
import picture from "#common/image/load";
import * as quality from "#common/image/quality";
import * as link from "#common/link";
import * as files from "#common/file";
import mount from "#common/mount";
import retry from "#common/retry";
import format from "#common/format";
import once from "#common/once";
import * as player from "#common/player";
import * as video from "#common/video";
import * as media from "#common/media";
import "../../../css/common/chatting/assets.css";

const opening = once();
const kinds = ["media", "file", "link"];
const entries = new WeakMap();

dom.on(document, "chatting-asset", ({ detail: value }) => {
  for (const button of dom.all(".file-card")) {
    const item = entries.get(button);

    if (
      !item ||
      (item.record.token || item.record.url) !== value.id ||
      item.record.room !== value.room ||
      Boolean(item.record.private) !== Boolean(value.private) ||
      new URL(item.url, location.href).pathname !== value.item.file
    )
      continue;

    Object.assign(item, value.item);

    const extension = item.name.match(/\.[^.]+$/)?.[0] || "";
    const title = item.title || item.name;

    files.rename(
      button,
      title + (item.title && extension && !title.endsWith(extension) ? extension : "")
    );

    const image = button.querySelector(".file-cover");

    if (image) image.alt = title;
  }
});

const open = (item, button, gallery) => {
  if (button.hasAttribute("data-spoiler")) {
    media.spoiler(button, item.url, false);
    if (item.kind === "image") return;
  }

  if (item.kind === "audio") return player.open(item, button);

  if (item.kind === "video") {
    const source = media.find(item.url, "video", item.record?.token || item.record?.url);

    return video.default(
      item.url,
      source?.closest(".video-thumbnail") || button,
      item.title || item.name
    );
  }

  if (item.kind === "image") return view(item.url, button, "", undefined, gallery);
  return link.open(item.url, { file: item.kind === "file", confirm: true, name: item.name });
};

i18n.preload(
  "chatting.attach.reveal",
  "assets.title",
  "assets.summary",
  "assets.count",
  "assets.unknown",
  "assets.empty",
  "assets.error",
  ...kinds.map((kind) => `assets.${kind}`)
);

const node = (tag, name = "", text = "") => {
  const result = dom.create(tag);

  result.className = name;
  result.textContent = text;

  return result;
};

const thumbnail = (item, button) => {
  if (item.kind === "video") {
    const preview = video.thumbnail(item.url, item.title || item.name, false, item.cover);

    button.append(preview.root);

    const element = preview.root.querySelector("video");
    const update = () =>
      button.toggleAttribute(
        "data-cover",
        Boolean(element.poster) || (element.readyState >= 2 && !element.error)
      );
    const off = ["loadeddata", "canplay", "seeked", "error"].map((event) =>
      dom.on(element, event, update)
    );

    update();
    return () => {
      off.forEach((remove) => remove());
      preview.destroy();
    };
  }

  if (item.cover === false) return () => {};

  const controller = new AbortController();
  const image = node("img");

  image.alt = item.title || item.name || "";
  image.draggable = false;
  image.referrerPolicy = "no-referrer";
  image.className = "file-cover";

  const loaded = dom.on(image, "load", () => {
    if (controller.signal.aborted) return;

    button.prepend(image);
    dom.set(button, "data-cover", "");
  });

  const observer = new IntersectionObserver(async (entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;

    observer.disconnect();

    const source = item.cover || (await media.resolve(item.url, "cover", controller.signal));

    if (source && !controller.signal.aborted) image.src = source;
  });

  observer.observe(button);
  return () => {
    controller.abort();
    observer.disconnect();
    loaded();
    image.removeAttribute("src");
  };
};

export default function assets(selected = "media", room = "") {
  const base = room ? `${path}/rooms/${room}/assets` : `${path}/assets`;

  return opening(`assets:${room}`, async () => {
    const root = node("div", "chatting-assets");
    const tabs = node("div", "segment");
    const totals = node("p", "assets-summary");
    const list = node("div", "assets-list");
    const edge = node("div", "history-edge");

    const dates = new Map();
    const seen = new Set();
    const pictures = [];
    const previews = [];

    let kind = kinds.includes(selected) ? selected : "media";
    let cursor;
    let busy = false;
    let closed = false;
    let request = new AbortController();
    let observer;
    let element;

    const retries = retry(load, () => !closed);
    const image = (title) => {
      const img = node("img");

      img.decoding = "async";
      img.alt = title || "";
      img.loading = "lazy";
      img.draggable = false;
      img.referrerPolicy = "no-referrer";

      return img;
    };

    const render = (item) => {
      if (seen.has(item.id)) return;

      seen.add(item.id);

      const day = clock.day(item.time);

      if (!dates.has(day)) {
        const section = node("section", "group-section");
        const group = node("div", "group");

        dom.set(group, "data-background", "");
        dom.set(group, "data-view", "grid");

        section.append(node("h3", "group-title", clock.label(item.time)), group);

        list.append(section);
        dates.set(day, group);
      }

      const row = node("div", "group-item");
      const button = files.grid(item, "button");

      entries.set(button, item);

      if (item.spoiler && ["image", "video"].includes(item.kind))
        media.spoiler(button, item.url, true);

      if (kind === "media") {
        button.type = "button";

        if (item.kind === "image") {
          const img = image(item.name);

          img.className = "file-cover";
          button.append(img);
          dom.set(button, "data-cover", "");
          picture(img, { target: button, source: quality.thumb(item), lazy: true });
          pictures.push(item);
        } else {
          previews.push(thumbnail(item, button));
        }

        dom.on(button, "click", () =>
          open(item, button, { items: () => pictures, more: load, end: () => cursor === null })
        );
      } else {
        dom.on(button, "click", () => open(item, button));
      }

      actions.bind(button, () => ({
        ...item,
        open: () =>
          open(item, button, { items: () => pictures, more: load, end: () => cursor === null })
      }));

      row.append(button);
      dates.get(day).append(row);
    };

    async function load() {
      if (busy || closed) return false;

      if (cursor === null) return true;

      busy = true;
      observer?.unobserve(edge);
      edge.replaceChildren();

      const signal = request.signal;
      const query = new URLSearchParams({ kind });

      if (cursor) query.set("before", cursor);
      const result = await api(`${base}?${query}`, { signal });

      if (closed || signal.aborted) return false;

      busy = false;
      if (!result.ok) {
        if ([400, 401, 403, 404].includes(result.status))
          edge.replaceChildren(node("p", "", i18n.message("assets.error")));
        else retries.schedule();

        return false;
      }

      retries.reset();

      const data = result.data;

      const size = data.size === null ? i18n.message("assets.unknown") : format(data.size);

      totals.textContent = i18n
        .message(kind === "link" ? "assets.count" : "assets.summary")
        .replace("{count}", data.count)
        .replace("{size}", size);

      data.items.forEach(render);
      cursor = data.next;
      edge.replaceChildren();
      if (!seen.size) edge.append(node("p", "assets-empty", i18n.message("assets.empty")));

      mount(root);
      if (cursor !== null) observer?.observe(edge);

      return true;
    }

    for (const value of kinds) {
      const button = node("button", "", i18n.message(`assets.${value}`));

      button.type = "button";
      dom.set(button, "data-i18n", `assets.${value}`);
      button.toggleAttribute("data-selected", value === kind);
      dom.on(button, "click", () => {
        if (kind === value) return;

        request.abort();
        request = new AbortController();
        retries.reset();
        dates.clear();
        seen.clear();
        pictures.length = 0;
        previews.splice(0).forEach((close) => close());
        list.replaceChildren();
        root.append(edge);
        totals.replaceChildren();
        kind = value;
        cursor = undefined;
        busy = false;
        element.scrollTop = 0;
        dom.set(root, "data-kind", kind);
        load();
      });

      tabs.append(button);
    }

    root.append(tabs, totals, list, edge);
    dom.set(root, "data-kind", kind);
    try {
      return await drawer({
        title: "assets.title",
        content: root,
        back: true,
        side: "right",
        direction: "→",
        ready: (target) => {
          element = target;
          observer = new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) load();
            },
            { root: target, rootMargin: "128px" }
          );

          load();
        }
      });
    } finally {
      closed = true;
      request.abort();
      retries.reset();
      observer?.disconnect();
      previews.forEach((close) => close());
    }
  });
}

export function preview(kind, room = "", signal) {
  const base = room ? `${path}/rooms/${room}/assets` : `${path}/assets`;
  const root = node("div", "assets-preview");
  const grid = node("div", "group");
  const previews = [];

  signal?.addEventListener("abort", () => previews.forEach((close) => close()), { once: true });

  dom.set(grid, "data-view", "grid");

  root.append(grid);
  void api(`${base}?kind=${kind}`).then((result) => {
    if (!root.isConnected || signal?.aborted) return;

    grid.replaceChildren();
    if (!result.ok || !result.data.items.length) {
      grid.append(
        node("p", "assets-empty", i18n.message(result.ok ? "assets.empty" : "assets.error"))
      );

      return;
    }

    const items = result.data.items.slice(0, 6);

    for (const item of items) {
      const row = node("div", "group-item");
      const button = files.grid(item, "button");

      entries.set(button, item);

      if (item.spoiler && ["image", "video"].includes(item.kind))
        media.spoiler(button, item.url, true);

      button.type = "button";
      if (item.kind === "image") {
        const img = node("img");

        img.decoding = "async";
        img.alt = item.name || "";
        img.loading = "lazy";
        img.draggable = false;
        img.className = "file-cover";
        button.append(img);
        dom.set(button, "data-cover", "");
        picture(img, { target: button, source: quality.thumb(item), lazy: true });
      } else if (["audio", "video"].includes(item.kind)) {
        previews.push(thumbnail(item, button));
      }

      dom.on(button, "click", () => {
        void open(
          item,
          button,
          items.filter((entry) => entry.kind === "image")
        );
      });

      actions.bind(button, () => ({
        ...item,
        open: () =>
          open(
            item,
            button,
            items.filter((entry) => entry.kind === "image")
          )
      }));

      row.append(button);
      grid.append(row);
    }

    mount(root);
  });

  return root;
}
