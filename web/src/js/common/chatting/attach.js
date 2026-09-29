import * as dom from "#common/dom";
import upload from "#common/upload";
import { chatting as path } from "#shared/route";
import { validId } from "#shared/chatting";
import * as i18n from "#common/i18n";
import * as input from "#common/input";
import * as rules from "#shared/attach";
import maximum from "#shared/upload";
import avatar from "#common/avatar";
import edit from "#common/image";
import sheet from "#common/sheet";
import dialog from "#common/dialog";
import toast from "#common/toast";
import * as giphy from "#common/giphy";
import * as chat from "#common/chatting";
import * as profile from "#common/profile";
import progress from "#common/progress";
import * as recent from "./recent.js";
import * as files from "#common/file";
import * as video from "#common/video";
import * as player from "#common/player";
import context from "#common/context";

i18n.preload(
  "chatting.sending",
  "chatting.failed",
  "chatting.attach.limit",
  "chatting.attach.description",
  "chatting.attach.title",
  "chatting.attach.artist",
  "chatting.attach.cover",
  "chatting.attach.thumbnail",
  "chatting.attach.spoiler",
  "chatting.attach.remove",
  "assets.audio",
  "assets.video",
  "image.title",
  "image.sizeError",
  "image.loadError",
  "image.cancel",
  "image.confirm",
  "chatting.attach.clipboard",
  "file.error",
  "file.size"
);

async function inspect(item) {
  if (!item.metadata) return;
  const value = await item.metadata;

  if (item.title === undefined && value.title) item.title = value.title;

  if (item.artist === undefined && value.artist) item.artist = value.artist;

  if (item.cover === undefined && value.cover) item.cover = value.cover;
}

function picture(item) {
  const root = item.preview?.root;

  if (!root?.matches(".file-card, .video-thumbnail")) return;

  root.querySelector(".file-cover")?.remove();
  if (item.picture) URL.revokeObjectURL(item.picture);

  item.picture = null;
  if (root.querySelector("video")) {
    const video = root.querySelector("video");

    if (item.cover) item.picture = URL.createObjectURL(item.cover);

    video.poster = item.picture || "";
    video.load();
    return;
  }

  root.toggleAttribute("data-cover", Boolean(item.cover));
  if (!item.cover) return;
  const image = dom.create("img");

  item.picture = URL.createObjectURL(item.cover);
  image.src = item.picture;
  image.alt = "";
  image.draggable = false;
  image.className = "file-cover";
  root.prepend(image);
}

export function composer(item, change = () => {}) {
  const composer = dom.create("div");
  const row = dom.create("div");
  const title = dom.create("input");
  const actions = dom.create("div");
  const sound = rules.mime(item.name).startsWith("audio/");

  composer.className = "group-item chatting-attachment-options";
  row.className = "input input-compose";
  actions.className = "input-actions";
  title.name = "title";
  title.maxLength = 255;
  title.value = item.title || item.name.replace(/\.[^.]+$/, "");
  title.placeholder = i18n.message("chatting.attach.title");
  dom.set(title, "data-i18n-placeholder", "chatting.attach.title");
  dom.set(title, "data-control", "");
  dom.on(title, "input", () => {
    item.title = title.value.trim();
    change();
  });

  const cover = files.default({
    accept: rules.types.join(","),
    compact: true,
    source: typeof item.cover === "string" ? item.cover : ""
  });

  const key = rules.mime(item.name).startsWith("video/")
    ? "chatting.attach.thumbnail"
    : "chatting.attach.cover";

  cover.button.title = i18n.message(key);
  dom.set(cover.button, "data-tooltip", key);
  actions.append(cover.button);
  if (sound) {
    const heading = dom.create("div");
    const artist = dom.create("input");

    heading.className = "input";
    heading.append(title);
    artist.name = "artist";
    artist.maxLength = 255;
    artist.value = item.artist || "";
    artist.placeholder = i18n.message("chatting.attach.artist");
    dom.set(artist, "data-i18n-placeholder", "chatting.attach.artist");
    dom.set(artist, "data-control", "");
    dom.on(artist, "input", () => {
      item.artist = artist.value.trim();
      change();
    });

    row.append(artist, actions);
    composer.append(heading, cover.root, row);
  } else {
    row.append(title, actions);
    composer.append(cover.root, row);
  }

  if (item.cover instanceof Blob) {
    const transfer = new DataTransfer();

    transfer.items.add(item.cover);
    cover.input.files = transfer.files;
    cover.input.dispatchEvent(new Event("change"));
  }

  dom.on(cover.input, "change", () => {
    const file = cover.input.files[0];

    if (file && (!rules.types.includes(file.type) || file.size > maximum)) {
      toast({ text: "image.sizeError", type: "error" });
      cover.reset();
      return;
    }

    item.cover = file || null;
    item.artwork = null;
    change();
  });

  return { root: composer, title, cover, destroy: cover.destroy };
}

export function preview(item, url) {
  const movie = rules.mime(item.name).startsWith("video/");
  const source = item.file ? URL.createObjectURL(item.file) : url;
  const thumbnail = movie ? video.thumbnail(source, item.title || item.name, false) : null;
  const root = thumbnail?.root || dom.create("div");
  const element = movie ? root.querySelector("video") : dom.create("audio");

  let artwork;

  if (!movie) {
    element.src = source;
    element.controls = true;
    element.dataset.channel = "media";
    root.append(element);
  }
  const refresh = () => {
    if (artwork) URL.revokeObjectURL(artwork);

    artwork = item.cover instanceof Blob ? URL.createObjectURL(item.cover) : null;

    const cover = artwork || (typeof item.cover === "string" ? item.cover : "");

    element.dataset.name = item.title || item.name;
    element.dataset.artist = item.artist || "";
    element.dataset.cover = cover || "none";
    element.dispatchEvent(
      new CustomEvent("media-change", {
        detail: {
          name: item.name,
          title: item.title,
          artist: item.artist || "",
          cover: cover || false
        }
      })
    );
  };

  refresh();
  return {
    root,
    refresh,
    ready: () => {
      if (!movie) player.default(root);
    },
    pause: () => element.pause(),
    destroy: () => {
      element.pause();
      if (movie) thumbnail.destroy();
      else {
        player.release(element);
        element.removeAttribute("src");
        element.load();
      }

      if (item.file) URL.revokeObjectURL(source);

      if (artwork) URL.revokeObjectURL(artwork);
    }
  };
}

export default function attachments(field) {
  const form = field.form;
  const root = dom.create("div");
  const items = [];
  const editor = field.nextElementSibling?.matches(".chatting-editor")
    ? field.nextElementSibling
    : field;

  let busy = false;
  let destroyed = false;

  root.className = "chatting-attachments";
  dom.set(root, "data-drag", "none");
  root.hidden = true;
  field.closest(".input").before(root);

  const allowed = () => !busy && !destroyed && !field.disabled && !field.readOnly;

  const update = () => {
    const hidden = !items.length || busy;
    const changed =
      root.hidden !== hidden || dom.get(form, "data-attachments") !== String(items.length);

    root.hidden = hidden;
    dom.set(form, "data-attachments", String(items.length));
    root.inert = !allowed();
    form.dispatchEvent(new Event("chatting-attachments"));
    if (!changed || destroyed) return;

    form.closest(".chatting")?.dispatchEvent(new Event("chatting-viewport"));
  };

  const remove = (item) => {
    const at = items.indexOf(item);

    if (at < 0) return;

    items.splice(at, 1);
    item.node.remove();
    item.destroy?.();
    if (item.url) URL.revokeObjectURL(item.url);

    if (item.picture) URL.revokeObjectURL(item.picture);

    update();
  };

  const open = async (original, anchor) => {
    if (!allowed() || original.opened || !items.includes(original)) return;

    original.opened = true;
    await inspect(original);
    if (!allowed() || !items.includes(original)) {
      original.opened = false;
      return;
    }

    const item = { ...original };

    const sound = item.type === "file" && rules.mime(item.name).startsWith("audio/");
    const movie = item.type === "file" && rules.mime(item.name).startsWith("video/");
    const state = () =>
      JSON.stringify([
        item.description,
        item.spoiler,
        item.edit,
        item.title,
        item.artist,
        item.cover?.name,
        item.cover?.size,
        item.cover?.lastModified
      ]);
    const initial = state();
    const root = dom.create("div");
    const media = sound || movie ? preview(item, item.url) : null;
    const frame =
      media || (item.type === "file" ? { root: files.card(item.name) } : avatar(item.url));
    const group = dom.create("div");
    const check = dom.create("div");
    const label = dom.create("label");
    const name = dom.create("span");
    const checkbox = dom.create("input");
    const discard = dom.create("button");

    root.className = "chatting-attachment-options";
    frame.root.classList.add("chatting-attachment-preview");
    if (item.edit) dom.set(frame.root, "data-edit", "");

    frame.set?.(item.url, item.edit);
    group.className = "group";
    check.className = "group-item checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = item.spoiler;
    name.textContent = i18n.message("chatting.attach.spoiler");
    dom.set(name, "data-i18n", "chatting.attach.spoiler");
    label.append(name, checkbox);
    check.append(label);

    const action = (key, run) => {
      const row = dom.create("div");
      const button = dom.create("button");
      const text = dom.create("span");
      const arrow = dom.create("span");

      row.className = "group-item";

      button.type = "button";

      arrow.className = "group-next";
      dom.set(arrow, "data-icon", "arrow");

      text.textContent = i18n.message(key);
      dom.set(text, "data-i18n", key);

      dom.set(button, "data-response", "");
      button.append(text, arrow);

      dom.on(button, "click", async () => {
        if (!allowed() || button.disabled) return;

        button.disabled = true;
        try {
          await run(button);
        } finally {
          button.disabled = false;
          root.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });

      row.append(button);

      return row;
    };

    if (item.type !== "file")
      group.append(
        action("chatting.attach.description", async () => {
          const content = dom.create("div");
          const input = dom.create("textarea");

          content.className = "input";
          input.value = item.description;
          input.rows = 3;
          input.maxLength = rules.description;
          dom.set(input, "data-control", "");
          content.append(input);

          const confirmed = await dialog({
            title: "chatting.attach.description",
            content,
            direction: "→",
            actions: [
              { text: "image.cancel", icon: "close", value: false },
              { text: "image.confirm", icon: "check", value: true, data: ["data-confirm"] }
            ]
          });

          if (confirmed && allowed() && items.includes(original)) item.description = input.value;
        })
      );

    let cover;

    if (sound || movie) {
      const editor = composer(item, () => {
        media?.refresh();
        root.dispatchEvent(new Event("input", { bubbles: true }));
      });

      cover = editor.cover;
      group.append(editor.root);
    }

    if (item.type !== "file" || movie) group.append(check);

    if (item.type !== "file")
      group.append(
        action("image.title", async (button) => {
          const result = await edit(item.file, {
            anchor: button,
            shape: "original",
            edit: item.edit
          });

          if (!result || !allowed() || !items.includes(original)) return;

          item.edit = result.edit;
          item.receipt = null;
          dom.set(frame.root, "data-edit", "");
          frame.set(item.url, item.edit);
        })
      );

    dom.on(checkbox, "change", () => {
      if (allowed() && items.includes(original)) item.spoiler = checkbox.checked;

      root.dispatchEvent(new Event("input", { bubbles: true }));
    });

    discard.type = "button";
    dom.set(discard, "data-danger", "");
    dom.set(discard, "data-icon", "trash");

    discard.textContent = i18n.message("chatting.attach.remove");
    dom.set(discard, "data-i18n", "chatting.attach.remove");
    dom.set(discard, "data-response", "");
    dom.set(discard, "data-layer-action", "remove");
    root.append(frame.root, group, discard);
    try {
      const result = await sheet({
        route: ["actions", "attachment"],
        anchor,
        back: true,
        title: sound
          ? "assets.audio"
          : movie
            ? "assets.video"
            : item.type === "file"
              ? "assets.file"
              : "chatting.tools.image",
        content: root,
        ready: () => media?.ready(),
        closing: () => media?.pause(),
        stage: "full",
        direction: "→",
        actions: [
          {
            text: "image.confirm",
            icon: "check",
            head: true,
            value: true,
            disabled: () => state() === initial && item.cover === original.cover
          }
        ]
      });

      if (result === "remove" && allowed()) remove(original);
      else if (result === true && allowed() && items.includes(original)) {
        for (const key of [
          "description",
          "spoiler",
          "edit",
          "receipt",
          "title",
          "artist",
          "cover",
          "artwork"
        ])
          original[key] = item[key];

        original.preview?.set?.(original.url, original.edit);
        if (original.edit) dom.set(original.preview.root, "data-edit", "");

        const extension = original.name?.match(/\.[^.]+$/)?.[0] || "";

        if (original.name)
          files.rename(
            original.preview.root,
            original.title
              ? original.title + (original.title.endsWith(extension) ? "" : extension)
              : original.name
          );

        picture(original);
      }
    } finally {
      original.opened = false;
      cover?.destroy();
      update();
      frame.destroy?.();
    }
  };

  const add = (value) => {
    if (!allowed()) return false;

    if (items.length >= rules.maximum) {
      toast({ text: "chatting.attach.limit", type: "warning" });

      return false;
    }

    const sticker = value?.type === "ogq" ? rules.ogq(value) : rules.giphy(value);
    const source = value instanceof Blob ? value : null;
    const inferred = rules.mime(source?.name);
    const file =
      source && rules.types.includes(inferred) && !rules.types.includes(source.type)
        ? new File([source], source.name, { type: inferred })
        : source;

    const document = file && !rules.types.includes(file.type);

    if (!sticker && !file?.size) {
      toast({ text: "file.error", type: "error" });

      return false;
    }

    if (file && file.size > maximum) {
      toast({ text: document ? "file.size" : "image.sizeError", type: "error" });

      return false;
    }

    const node = dom.create("div");
    const close = dom.create("button");
    const movie = document && rules.mime(file.name).startsWith("video/");
    const sound = document && rules.mime(file.name).startsWith("audio/");
    const url = file && (!document || movie) ? URL.createObjectURL(file) : null;
    const preview = document
      ? { root: files.grid({ name: file.name, size: file.size }, "button") }
      : url
        ? avatar(url, "button")
        : null;
    const image = sticker ? dom.create("img") : preview.root;
    const item = {
      ...(sticker || { type: document ? "file" : file.type === "image/gif" ? "gif" : "image" }),
      ...(document && { name: file.name || "download", size: file.size }),
      file,
      url,
      node,
      preview,
      description: "",
      spoiler: false,
      edit: null,
      destroy: preview?.destroy
    };

    node.className = "chatting-attachment";
    image.classList.add("chatting-attachment-preview");
    if (document) {
      node.classList.add("chatting-document");
      dom.set(image, "data-opacity", "");
      dom.set(image, "data-response", "");
    }

    if (movie) {
      const thumbnail = video.thumbnail(url, file.name, false);
      const element = thumbnail.root.querySelector("video");
      const refresh = () =>
        preview.root.toggleAttribute(
          "data-cover",
          Boolean(element.poster) || (element.readyState >= 2 && !element.error)
        );

      const off = ["loadeddata", "canplay", "seeked", "error"].map((event) =>
        dom.on(element, event, refresh)
      );

      preview.root.append(thumbnail.root);
      item.destroy = () => {
        off.forEach((remove) => remove());
        thumbnail.destroy();
      };
    }

    if (file && (!document || movie || sound))
      context(image, () => open(item, image), "button.preview-control");
    else if (document)
      dom.on(image, "contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

    if (sticker) {
      if (sticker.provider === "giphy") {
        const media = dom.create("button");

        media.type = "button";
        media.className = "chatting-attachment-preview";
        item.destroy = giphy.image(media, value, { preview: true });
        node.append(media);
      } else {
        image.src = rules.source(sticker);
        image.alt = "OGQ";
        image.draggable = false;
        image.referrerPolicy = "no-referrer";
      }
    } else dom.on(image, "click", () => open(item, image));

    close.type = "button";
    close.className = "chatting-attachment-close preview-control";
    dom.set(close, "data-background", "");
    dom.set(close, "data-shadow", "");
    dom.set(close, "data-icon", "minus");
    dom.set(close, "data-circle", "");
    dom.set(close, "data-scale", "");
    dom.set(close, "data-tooltip", "chatting.attach.remove");
    dom.set(close, "data-response", "");
    dom.on(close, "click", () => {
      if (allowed()) remove(item);
    });

    if (sticker?.provider !== "giphy") node.append(image);

    node.append(close);
    root.append(node);
    items.push(item);
    if (sound) {
      item.metadata = import("music-metadata")
        .then(async (metadata) => {
          const { common } = await metadata.parseBlob(file, { duration: false });
          const picture = metadata.selectCover(common.picture);
          const type = picture?.format === "image/jpg" ? "image/jpeg" : picture?.format;

          return {
            title: common.title?.trim().slice(0, 255),
            artist: common.artist?.trim().slice(0, 255),
            cover:
              picture && rules.types.includes(type) && picture.data.byteLength <= maximum
                ? new File([picture.data], "cover", { type })
                : undefined
          };
        })
        .catch(() => ({}));

      void inspect(item).then(() => {
        if (destroyed || !items.includes(item)) return;
        const extension = item.name.match(/\.[^.]+$/)?.[0] || "";

        if (item.title)
          files.rename(
            item.preview.root,
            item.title + (item.title.endsWith(extension) ? "" : extension)
          );

        picture(item);
        update();
      });
    }

    update();

    return true;
  };

  const read = async (source) => {
    try {
      const url = new URL(source);

      if (
        url.username ||
        url.password ||
        !(
          url.protocol === "https:" ||
          (url.protocol === "blob:" && url.origin === location.origin) ||
          /^data:[\w.+-]+\/[\w.+-]+;base64,/i.test(source)
        )
      )
        throw new Error("Unsupported clipboard source");
      const response = await fetch(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
      const type = response.headers.get("content-type")?.split(";")[0];

      if (!response.ok || !response.body) throw new Error("Clipboard fetch failed");
      const reader = response.body.getReader();
      const chunks = [];

      let size = 0;

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        size += value.byteLength;
        if (size > maximum || destroyed) {
          await reader.cancel();
          if (!destroyed) toast({ text: "image.sizeError", type: "error" });

          return;
        }

        chunks.push(value);
      }

      const extension = Object.keys(rules.formats).find((key) => rules.formats[key] === type);
      const name =
        url.searchParams.get("name") ||
        (url.protocol === "https:" ? decodeURIComponent(url.pathname.split("/").at(-1)) : "") ||
        `download${extension ? `.${extension}` : ""}`;

      add(new File(chunks, name, { type: type || "application/octet-stream" }));
    } catch {
      if (!destroyed) toast({ text: "chatting.attach.clipboard", type: "warning" });
    }
  };

  const paste = (event) => {
    if (
      event.type === "beforeinput" &&
      !["insertFromPaste", "insertFromDrop"].includes(event.inputType)
    )
      return;
    const data = event.clipboardData || event.dataTransfer;

    if (!data) return;
    const candidates = data.files?.length
      ? [...data.files]
      : [...(data.items || [])]
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter(Boolean);

    const files = candidates.map((file) =>
      file.type ? file : new File([file], file.name, { type: rules.mime(file.name) })
    );
    const html = data.getData("text/html");
    const template = dom.create("template");

    if (!files.length && html.length > maximum * 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast({ text: "image.sizeError", type: "error" });

      return;
    }

    if (!files.length) template.innerHTML = html;
    const sources = [
      ...new Set(
        [...template.content.querySelectorAll("img[src], audio[src], video[src], source[src]")].map(
          (element) => element.getAttribute("src")
        )
      )
    ];

    if (!files.length && !sources.length && !candidates.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (!allowed()) return;

    if (files.length) files.forEach(add);
    else if (sources.length) {
      void (async () => {
        for (const source of sources.slice(0, rules.maximum)) {
          if (!allowed()) break;

          if (items.length >= rules.maximum) {
            toast({ text: "chatting.attach.limit", type: "warning" });
            break;
          }

          await read(source);
        }

        if (sources.length > rules.maximum)
          toast({ text: "chatting.attach.limit", type: "warning" });
      })();
    } else toast({ text: "chatting.attach.clipboard", type: "warning" });
    const text = data.getData("text/plain");

    if (files.length && text && !input.insert(field, text))
      toast({ text: "chatting.tooLong", type: "warning" });
  };

  const off = ["paste", "beforeinput", "drop"].map((type) => dom.on(editor, type, paste, true));

  off.push(
    dom.on(editor, "dragover", (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    })
  );

  const observer = new MutationObserver(update);

  observer.observe(field, { attributes: true, attributeFilter: ["disabled", "readonly"] });

  update();

  return {
    add,
    snapshot: () => items.map((item) => ({ ...item })),
    receipt: (entry, value) => {
      const item = items.find((item) => item.node === entry.node);

      if (item) item.receipt = value;
    },
    busy: (value) => {
      busy = value;
      update();
    },
    clear: (batch) => {
      for (const entry of batch) {
        const item = items.find((item) => item.node === entry.node);

        if (item) remove(item);
      }
    },
    destroy: () => {
      destroyed = true;
      [...items].forEach(remove);
      observer.disconnect();
      off.forEach((remove) => remove());
      root.remove();
    }
  };
}

export async function prepare(batch, attached, signal, change) {
  const items = [];

  for (const item of batch) {
    await inspect(item);
    if (signal.aborted) return { ok: false, status: 0 };

    if (item.provider === "giphy") {
      items.push(rules.giphy(item));
      continue;
    }

    if (item.type === "ogq") {
      items.push(rules.ogq(item));
      continue;
    }

    const result =
      item.receipt?.expires > Date.now()
        ? { ok: true, data: item.receipt }
        : await upload(`${path}/${item.type === "file" ? "file" : "attachment"}`, item, {
            cache: "no-store",
            ...(item.type === "file" && {
              headers: {
                "Content-Type": "application/octet-stream",
                "X-File-Name": encodeURIComponent(item.name)
              }
            }),
            signal,
            ...(change && { progress: (loaded, total) => change(item, (loaded / total) * 100) })
          });

    if (!result.ok || !validId(result.data?.token)) return { ok: false, status: result.status };

    change?.(item, 100);
    item.receipt = result.data;
    attached.receipt(item, result.data);
    if (item.cover && !(item.artwork?.expires > Date.now())) {
      const cover = await upload(`${path}/attachment`, item.cover, { signal });

      if (!cover.ok || !validId(cover.data?.token)) return { ok: false, status: cover.status };

      item.artwork = cover.data;
    }

    items.push({
      type: item.type,
      token: result.data.token,
      description: item.description,
      spoiler: item.spoiler,
      ...(item.title !== undefined && { title: item.title }),
      ...(item.artist !== undefined && { artist: item.artist }),
      ...(item.cover && { cover: item.artwork.token }),
      ...(item.cover === null && { cover: false })
    });
  }

  return { ok: true, items };
}

export function queue(root, field, attached, dispatch, allowed) {
  let tail = Promise.resolve();

  const waiting = new Set();
  const submit = (file = null, previous = null) => {
    if (field.disabled || field.readOnly) return Promise.resolve(false);
    const batch = previous?.batch || (file ? [] : attached().snapshot());
    const text = previous?.text ?? field.value;
    const recipient = previous ? previous.recipient : dom.get(field.form, "data-whisper");

    if (!allowed({ file, batch, text, recipient })) return Promise.resolve(false);

    if (!file && !text.trim() && !batch.length) return Promise.resolve(false);
    const controller = new AbortController();
    const draft = {
      token: previous?.token || crypto.randomUUID(),
      batch,
      text,
      recipient,
      used: previous?.used || (file ? [] : recent.snapshot(field, text, batch)),
      controller,
      queued: true
    };

    if (previous) waiting.delete(previous);

    previous?.pending?.remove();
    field.form.dispatchEvent(new Event("chatting-emotes-close"));
    if (dom.has("wearable")) dom.query(".chatting-editor", field.form)?.blur();

    draft.pending = file ? null : pending(root, batch, text, () => controller.abort(), recipient);
    if (!file && !previous) {
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      attached().clear(batch);
    }

    field.form.dispatchEvent(new Event("chatting-state"));
    waiting.add(draft);

    let succeeded = false;

    const result = tail
      .then(async () => {
        if (controller.signal.aborted) return false;
        const sent = await dispatch(file, draft).catch(() => false);

        succeeded = sent;
        if (!sent && !controller.signal.aborted && draft.pending) {
          draft.pending.fail(() => submit(file, draft));
        }
        return sent;
      })
      .finally(() => {
        if (succeeded || controller.signal.aborted || !draft.pending) waiting.delete(draft);

        if (controller.signal.aborted) draft.pending?.remove();
      });

    tail = result.catch(() => false);
    return tail;
  };

  submit.cancel = () => {
    for (const draft of waiting) {
      draft.controller.abort();
      draft.pending?.remove();
    }
    waiting.clear();
  };

  return submit;
}

export function pending(root, batch, text, cancel, recipient = "") {
  const user = profile.value("me");
  const message = chat.append(root, {
    id: user?.id,
    name: user?.name,
    avatar: user?.avatar,
    verified: user?.verified,
    own: true,
    private:
      Boolean(recipient) ||
      dom.get(root.closest(".chatting") || root, "data-chatting") === "messenger",
    peer: recipient || undefined,
    pending: true,
    text: text || " ",
    time: new Date().toISOString(),
    attachments: batch
      .filter((item) => !item.file)
      .map((item) => (item.provider === "giphy" ? rules.giphy(item) : rules.ogq(item)))
  });

  if (!message) return null;

  dom.set(message, "data-pending", "");

  const time = dom.query(".chatting-time", message);

  if (batch.some((item) => item.file)) {
    time.textContent = i18n.message("chatting.sending");
    time.removeAttribute("datetime");
    time.removeAttribute("title");
  }

  const content = dom.query(".chatting-text", message);
  const group = dom.query(".chatting-image-group", content) || dom.create("div");

  group.className = "chatting-image-group";
  for (const media of dom.all(":scope > .chatting-image", content)) group.append(media);
  if (batch.length) content.append(group);

  dom.on(message, "contextmenu", (event) => {
    if (message.hasAttribute("data-pending")) event.preventDefault();
  });

  const media = [...group.children];
  const controls = new Map();
  const urls = [];

  let stopped = false;
  let saved = false;
  let retry;

  const list = message.closest(".chatting-list");
  const remove = () => {
    stopped = true;
    if (!saved) message.remove();

    chat.regroup(list);
    if (saved) {
      Promise.all(
        [...message.querySelectorAll("img")].map((image) => image.decode().catch(() => {}))
      ).then(() => urls.forEach((url) => URL.revokeObjectURL(url)));
    } else urls.forEach((url) => URL.revokeObjectURL(url));
    for (const { ring, destroy } of controls.values()) {
      ring?.destroy();
      destroy?.();
    }
  };

  for (const item of batch) {
    if (!item.file) {
      group.append(media.shift());
      continue;
    }
    const document = item.type === "file";
    const movie = document && rules.mime(item.name).startsWith("video/");
    const url = !document || movie ? URL.createObjectURL(item.file) : null;
    const frame = dom.create("span");
    const cover = movie && item.cover instanceof Blob ? URL.createObjectURL(item.cover) : null;
    const image = document
      ? movie
        ? video.thumbnail(url, item.title || item.name, false, cover)
        : { root: files.card(item.name) }
      : avatar(url);
    const button = dom.create("button");
    const ring = progress({ type: "circular", value: item.receipt ? 100 : 0, show: false });

    if (url) urls.push(url);

    if (cover) urls.push(cover);

    frame.className = "chatting-image";
    image.root.classList.add("chatting-attachment-preview");
    dom.remove(image.root, "data-icon");
    if (document && !movie) frame.classList.add("chatting-document");

    button.type = "button";
    button.className = "chatting-attachment-close chatting-upload preview-control";
    for (const name of ["data-circle", "data-background", "data-shadow", "data-response"])
      dom.set(button, name, "");
    button.append(ring.element);
    dom.on(button, "click", () => {
      if (retry) {
        void retry();
        return;
      }

      if (stopped) return;

      cancel();
      remove();
    });

    controls.set(item, { button, ring, url, destroy: image.destroy });
    frame.append(image.root, button);
    group.append(frame);
  }
  const end = dom.query(".chatting-page ~ .chatting-page", list);

  if (end) list.insertBefore(message, end);

  chat.regroup(list);
  list.scrollTop = list.scrollHeight;

  return {
    accept: (options) => {
      saved = true;

      const previews = batch.map((item) =>
        item.file && item.type !== "file" ? controls.get(item)?.url || "" : ""
      );

      chat.append(list, { ...options, previews }, false, message);
      dom.remove(message, "data-pending");
      dom.remove(message, "data-failed");
      return message;
    },
    change: (item, value) => controls.get(item)?.ring.set(value),
    fail: (resume) => {
      retry = resume;
      dom.set(message, "data-failed", "");
      time.textContent = i18n.message("chatting.failed");
      if (!controls.size) {
        const button = dom.create("button");

        button.type = "button";
        dom.set(button, "data-circle", "");
        dom.set(button, "data-response", "");
        dom.on(button, "click", () => retry?.());
        content.append(button);
        controls.set(null, { button });
      }
      for (const { button, ring } of controls.values()) {
        ring?.destroy();
        button.disabled = false;
        dom.set(button, "data-failed", "");
        dom.set(button, "data-icon", "reload");
      }
    },
    commit: () => {
      stopped = true;
      for (const { button } of controls.values()) button.disabled = true;
    },
    complete: (node) => {
      const images = node ? dom.all(".chatting-image, .file-card.chatting-document", node) : [];

      for (const [item, { ring }] of controls) {
        ring?.destroy();
        if (!item) continue;

        const mark = dom.create("span");

        mark.className = "chatting-upload preview-control";
        for (const name of ["data-circle", "data-background", "data-shadow"])
          dom.set(mark, name, "");
        dom.set(mark, "data-icon", "check");
        images[batch.indexOf(item)]?.append(mark);
        setTimeout(() => mark.remove(), 700);
      }
      remove();
    },
    remove
  };
}
