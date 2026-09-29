import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as items from "#common/chatting/item";
import * as file from "#common/chatting/file";
import * as rules from "#shared/chatting";
import * as route from "#shared/route";
import * as profile from "#common/profile";
import * as actions from "#common/profile/actions";
import * as storage from "#common/storage";
import once from "#common/once";
import * as context from "#common/chatting/current";
import mount from "#common/mount";
import preview from "#common/chatting/preview";
import api from "#common/api";
import dialog from "#common/dialog";
import toast from "#common/toast";
import * as attachment from "./attach.js";
import upload from "#common/upload";
import sheet from "#common/sheet";
import * as registry from "./registry.js";

const opening = once();
const records = new WeakMap();
const pending = new Set();

export function remove(payload) {
  if (!payload.id) return;
  const lists = new Set();

  for (const element of registry.storedAll(payload.id)) {
    if (payload.message || payload.retained) {
      dom.set(element, "data-deleted", "");
      dom.set(element, "data-retained", "");
      element.dispatchEvent(
        new CustomEvent("chatting-change", {
          detail: payload.message || { deleted: true, retained: true, restorable: true }
        })
      );

      continue;
    }

    const list = element.closest(".chatting-list");

    if (list) lists.add(list);

    element.remove();
  }

  lists.forEach((list) => list.dispatchEvent(new Event("chatting-regroup")));
}

export function receive(value) {
  for (const message of dom.all(".chatting-message")) {
    const options = records.get(message) || {};

    if ((options.token || options.url) !== value.id) continue;
    const stored = options.attachments?.find((item) => item.file === value.item.file);

    if (stored) Object.assign(stored, value.item);
  }
  for (const audio of dom.all("audio, video")) {
    if (!audio.src || new URL(audio.src, location.href).pathname !== value.item.file) continue;

    if (audio.dataset.message !== value.id) continue;

    audio.dispatchEvent(new CustomEvent("media-change", { detail: value.item }));
  }
  document.dispatchEvent(new CustomEvent("chatting-asset", { detail: value }));
}

async function edit(message, options, selected) {
  const audio = message?.querySelectorAll("audio, video");
  const original = [...(audio || [])].find(
    (item) =>
      new URL(item.src, location.href).pathname === new URL(selected.url, location.href).pathname
  );

  const item = {
    name: selected.name || "",
    title: original?.dataset.name || selected.title || selected.name || "",
    artist: original?.dataset.artist ?? selected.artist ?? "",
    cover:
      original?.dataset.cover === "none"
        ? null
        : original?.poster ||
          original?.closest(".player")?.querySelector(".player-cover")?.src ||
          selected.cover ||
          undefined
  };
  const preview = attachment.preview(item, selected.url);
  const editor = attachment.composer(item, preview.refresh);
  const group = dom.create("div");
  const content = dom.create("div");

  group.className = "group";
  content.className = "chatting-attachment-options";
  preview.root.classList.add("chatting-attachment-preview");
  content.append(preview.root, group);
  group.append(editor.root);
  if (selected.kind === "video") {
    const stored = options.attachments?.find(
      (entry) => entry.file === new URL(selected.url, location.href).pathname
    );
    const row = dom.create("div");
    const label = dom.create("label");
    const name = dom.create("span");
    const check = dom.create("input");

    item.spoiler = Boolean(stored?.spoiler ?? selected.spoiler);
    row.className = "group-item checkbox";
    check.type = "checkbox";
    check.checked = item.spoiler;
    name.textContent = i18n.message("chatting.attach.spoiler");
    dom.set(name, "data-i18n", "chatting.attach.spoiler");
    dom.on(check, "change", () => {
      item.spoiler = check.checked;
    });

    label.append(name, check);
    row.append(label);
    group.append(row);
  }
  try {
    const result = await sheet({
      route: ["actions", "attachment"],
      title: selected.kind === "video" ? "assets.video" : "assets.audio",
      content,
      ready: preview.ready,
      closing: preview.pause,
      back: true,
      actions: [{ text: "image.confirm", icon: "check", head: true, value: true }]
    });

    if (result !== true) return;
    const data = {
      file: new URL(selected.url, location.href).pathname,
      title: item.title,
      ...(selected.kind === "audio" && { artist: item.artist }),
      ...(selected.kind === "video" && { spoiler: item.spoiler }),
      ...(options.private && { room: options.room }),
      ...(item.cover === null && { cover: false })
    };

    if (item.cover instanceof Blob) {
      const response = await upload(`${route.chatting}/attachment`, item.cover);

      if (!response.ok) throw new Error("Cover upload failed");

      data.cover = response.data.token;
    }
    const base = options.private ? `${route.chatting}/direct/message` : route.chatting;
    const response = await api(`${base}/${options.token || options.url}/attachment`, {
      method: "PATCH",
      headers: options.private ? {} : { "X-Chatting-Room": options.room },
      data
    });

    if (!response.ok) throw new Error("Attachment update failed");

    receive(response.data);
  } catch {
    toast({ text: "file.error", type: "error" });
  } finally {
    editor.destroy();
    preview.destroy();
  }
}

i18n.preload(
  "chatting.attach.edit",
  "chatting.attach.video",
  "chatting.attach.spoiler",
  "assets.audio",
  "assets.video",
  "chatting.message",
  "image.delete",
  "image.restore",
  "restore.action",
  "restore.title",
  "restore.error",
  "chatting.removeTitle",
  "chatting.removeFailed",
  "assets.open",
  "assets.openImage",
  "assets.openAudio",
  "assets.openVideo",
  "assets.openFile",
  "assets.saveAudio",
  "assets.saveVideo",
  "assets.saveFile",
  "assets.copyAudio",
  "assets.copyVideo",
  "chatting.action.copyText",
  "chatting.action.copyLink",
  "chatting.action.saveImage",
  "chatting.action.copyImage",
  "chatting.action.remove",
  "data.delete.confirm",
  "chatting.action.restore",
  "chatting.copyFailed",
  "dialog.cancel"
);

export const bind = (message, options) => {
  if (!records.has(message)) {
    dom.on(message, "chatting-change", (event) => {
      const value = records.get(message);

      Object.assign(value, event.detail, {
        deleted: Boolean(event.detail.deleted),
        retained: Boolean(event.detail.retained),
        restorable: Boolean(event.detail.restorable)
      });

      message.toggleAttribute("data-deleted", value.deleted);
      message.toggleAttribute("data-retained", value.retained || value.restorable);
    });
  }

  records.set(message, options);
};

export const read = (message, fallback = {}) => records.get(message) || fallback;
const deleted = (message, options) =>
  message?.hasAttribute("data-deleted") ?? Boolean(options.deleted);

const retained = (message, options) =>
  options.restorable === true ||
  options.retained === true ||
  message?.hasAttribute("data-retained") === true;

export const allowed = (message, options) =>
  deleted(message, options)
    ? retained(message, options)
    : Boolean(
        options.removable &&
        (!options.private || message?.querySelector("[data-unread]") || options.unread === true)
      );

export const link = (id, room = context.room) => {
  if (!rules.validId(id)) return "";
  const url = new URL(room ? `/rooms/${room}` : "/", location.origin);

  url.searchParams.set("message", id);

  return url.href;
};

export const copy = async (id, room) => {
  const url = link(id, room);

  if (url) return file.copy(url);

  toast({ text: "chatting.copyFailed", type: "error" });

  return false;
};

export const controls = (message, options, selected) => {
  const values = [];
  const add = (name, extra) => values.push(items.spec(name, extra));

  if (
    options.own &&
    !deleted(message, options) &&
    ["audio", "video"].includes(selected?.kind) &&
    new URL(selected.url, location.href).pathname.endsWith(".bin")
  )
    add("edit", {
      text: selected.kind === "video" ? "chatting.attach.video" : "chatting.attach.edit",
      icon: "edit"
    });

  if (
    selected &&
    selected.open !== false &&
    (selected.kind !== "image" || typeof selected.open === "function")
  ) {
    add("open", {
      text: ["image", "audio", "video", "file"].includes(selected.kind)
        ? `assets.open${selected.kind[0].toUpperCase()}${selected.kind.slice(1)}`
        : "assets.open",
      icon:
        selected.kind === "image"
          ? "image"
          : selected.kind === "audio"
            ? "volume-high"
            : selected.kind === "video"
              ? "play"
              : "link"
    });
  }

  if (options.text) add("text", { run: () => file.copy(options.text) });

  if (!options.private && (message || rules.validId(options.url))) {
    add("link", {
      disabled: !rules.validId(options.url),
      run: () => copy(options.url, options.room)
    });
  }

  const sources = selected
    ? selected.kind === "image"
      ? [selected.resolve || selected.url]
      : []
    : [
        ...new Set(
          [
            ...(options.attachments || [])
              .filter((entry) => ["image", "gif"].includes(entry.type))
              .map((entry) => entry.image),
            options.image
          ].filter(Boolean)
        )
      ];

  if (["audio", "video", "file"].includes(selected?.kind)) {
    const kind = selected.kind;
    const suffix = kind[0].toUpperCase() + kind.slice(1);

    add("save", {
      text: `assets.save${suffix}`,
      run: () => file.save([selected.url], selected.name)
    });

    if (kind !== "file")
      add("image", {
        text: `assets.copy${suffix}`,
        run: () => file.copy(new URL(selected.url, location.href).href)
      });
  }

  if (sources.length) {
    add("save", { run: () => file.save(sources) });
    add("image", { run: () => file.image(sources[0]) });
  }

  if (allowed(message, options)) {
    add(deleted(message, options) ? "restore" : "remove", {
      text: deleted(message, options) ? "chatting.action.restore" : "chatting.action.remove"
    });
  }

  return items.group(values);
};

export async function change(message, options, selected, quick = false) {
  if (!allowed(message, options)) return false;
  const restoring = deleted(message, options);
  const token = options.private ? options.token : options.url;
  const key = `${options.private ? "message" : "chatting"}:${token}`;

  if (!rules.validId(token) || pending.has(key)) return false;

  pending.add(key);
  try {
    const content = dom.create("div");
    const question = dom.create("p");

    dom.set(question, "data-i18n", restoring ? "restore.title" : "chatting.removeTitle");
    content.append(question, preview(message, selected?.content, selected));

    const result = await dialog({
      title:
        selected?.kind === "image"
          ? restoring
            ? "image.restore"
            : "image.delete"
          : "chatting.message",
      content,
      direction: "→",
      ready: quick
        ? (element) => {
            element.tabIndex = -1;
            element.focus({ preventScroll: true });
          }
        : undefined,
      actions: [
        items.spec("cancel", { value: false }),
        items.spec(restoring ? "restore" : "remove", {
          text: restoring ? "restore.action" : "data.delete.confirm",
          value: true
        })
      ]
    });

    if (result !== true || !allowed(message, options) || restoring !== deleted(message, options))
      return false;

    if (!restoring && typeof options.remove === "function") {
      await options.remove();
      return true;
    }

    const base = options.private
      ? `${route.chatting}/direct/message/${token}`
      : `${route.chatting}/${token}`;

    const response = await api(restoring ? `${base}/restore` : base, {
      method: restoring ? "POST" : "DELETE",
      ...(!options.private && options.room && { headers: { "X-Chatting-Room": options.room } }),
      data: {}
    });

    if (response.ok && !restoring && !options.private && response.data?.id) remove(response.data);

    if (response.ok && restoring) {
      Object.assign(options, response.data, { deleted: false, restorable: false, retained: false });

      message?.dispatchEvent(new CustomEvent("chatting-change", { detail: options }));
    }

    if (!response.ok)
      toast({ text: restoring ? "restore.error" : "chatting.removeFailed", type: "error" });

    return response.ok;
  } finally {
    pending.delete(key);
  }
}

export async function menu(message, options = {}, selected, target) {
  const result =
    options.id || options.own
      ? await profile.read(options.own ? "me" : options.id, { fresh: true })
      : null;

  const user = result?.ok
    ? result.data
    : options.id
      ? { id: options.id, self: Boolean(options.own), manage: false }
      : null;
  const element = dom.create("div");
  const handlers = new Map();
  const context =
    message?.closest(".chatting") ||
    (options.private ? target : dom.query(".app .chatting") || target);

  element.className = selected ? "chatting-actions asset-actions" : "chatting-actions";

  element.append(
    preview(message, selected?.content, selected),
    controls(message, options, selected)
  );

  let groups = [];

  const render = (value) => {
    groups.forEach((group) => group.remove());
    handlers.clear();
    groups = actions.message(
      value,
      context,
      { ...options, hidden: storage.get(`chatting-hide:${options.id}`) === "true" },
      handlers,
      opening
    );

    element.append(...groups);
    if (element.isConnected) {
      groups.forEach((group) => mount(group));
      i18n.translate();
    }
  };

  if (user) render(user);
  const off = user?.id ? profile.bind(element, user.id, render) : () => {};
  const member = user && options.private ? actions.member(user, options.room, handlers) : null;

  if (member) element.append(member.root);

  return {
    root: element,
    run: async (value) => {
      if (value === "edit" && options.own && ["audio", "video"].includes(selected?.kind))
        return edit(message, options, selected);

      if (value === "remove" || value === "restore") {
        return change(message, options, selected);
      }

      return handlers.get(value)?.();
    },
    off: () => {
      off();
      member?.off();
    }
  };
}
