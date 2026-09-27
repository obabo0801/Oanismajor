import * as dom from "#common/dom";
import * as chat from "#common/chatting";
import * as profile from "#common/profile";
import * as names from "#common/profile/name";
import * as i18n from "#common/i18n";
import * as route from "#common/route";
import * as back from "#common/back";
import { chatting as path } from "#shared/route";
import api from "#common/api";
import drawer from "#common/drawer";
import events from "#common/events";
import toast from "#common/toast";
import once from "#common/once";
import mount from "#common/mount";
import avatar from "#common/avatar";
import upload from "#common/upload";
import tools from "#common/chatting/toolbar";
import viewport from "#common/chatting/viewport";
import * as attachments from "#common/chatting/attach";
import * as recent from "#common/chatting/recent";
import sound from "#common/sound";
import summary from "#common/chatting/summary";
import sheet from "#common/sheet";
import context from "#common/context";
import * as emoji from "#common/emoji";
import * as clock from "#common/chatting/time";
import * as toolbar from "#common/toolbar";
import * as rooms from "#common/room";
import * as menus from "#common/menu";
import "../../../css/common/direct.css";

const opening = once();
const whispers = new Map();
const positions = new Map();

let stream;
let active;
let unbind;
let selection = 0;

const listeners = new Set();

let bound = false;

i18n.preload(
  "direct.whisper",
  "direct.message",
  "direct.inbox",
  "direct.image",
  "direct.audio",
  "direct.new",
  "direct.deleted",
  "direct.pin",
  "direct.unpin",
  "direct.mute",
  "direct.unmute",
  "direct.readAll",
  "direct.leave",
  "direct.refused",
  "direct.messageRefused",
  "direct.offline",
  "direct.error",
  "direct.muted",
  "direct.more",
  "menu.contact",
  "menu.contactInfo",
  "contact.title",
  "contact.end",
  "direct.clearTarget",
  "direct.textOnly",
  "chatting.message",
  "chatting.send"
);

const problem = (result) =>
  toast({
    type: "error",
    text:
      result.status === 423
        ? "direct.muted"
        : result.status === 409
          ? result.data?.code === "offline"
            ? "direct.offline"
            : "direct.refused"
          : "direct.error"
  });

const messages = async (id) => {
  if (active) await active.close();

  if (dom.query(".messenger-inbox")) {
    return open("room", id);
  }

  return inbox(id);
};

export function listen(target) {
  if (bound) return;

  bound = true;
  stream = dom.query(".app .chatting");
  for (const kind of ["whisper", "message"])
    dom.on(target, `chatting-${kind}`, async (event) => {
      if (kind === "whisper" && event.target.closest?.('.chatting[data-chatting="messenger"]')) {
        return;
      }

      if (kind === "message" && active?.id === event.detail.id && active.reusable()) {
        return;
      }

      if (kind === "message" && active) {
        await active.close();
        await Promise.resolve();
      }

      open(kind, event.detail.id).catch(() => {});
    });
  dom.on(events(), "direct", (event) => {
    let item;

    try {
      item = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!["whisper", "message"].includes(item.kind) || !item.token) return;
    const peer = item.kind === "message" ? item.room : item.own ? item.peer : item.id;

    if (item.kind === "whisper") {
      receive(item);
      if (!item.own && !item.muted)
        toast({
          type: "notify",
          id: `whisper:${item.token}`,
          group: `whisper:${peer}`,
          title: names.label(item),
          text: item.text,
          run: () => select(peer)
        });

      return;
    }

    let shown = false;

    listeners.forEach((listener) => {
      shown = listener(item, peer) || shown;
    });

    if (!item.system && !item.own && !shown && !item.muted)
      toast({
        type: "notify",
        id: `message:${item.token}`,
        group: `message:${peer}`,
        title: names.label(item),
        text: item.text,
        attachments: item.attachments,
        audio: item.audio,
        run: () => messages(peer)
      });
  });
}

export function receive(item) {
  if (!stream || whispers.has(item.token)) return;

  whispers.set(item.token, item);
  if (whispers.size > 500) whispers.delete(whispers.keys().next().value);
  const list = dom.query(".chatting-list", stream);
  const follow = item.own || chat.bottom(list);
  const peer = item.own ? item.peer : item.id;
  const evidence = () =>
    [...whispers.values()].filter(
      (entry) => entry.proof && (entry.own ? entry.peer : entry.id) === peer
    );
  const node = chat.append(list, { ...item, private: true, evidence }, false);

  if (node) {
    chat.place(list, node, dom.query(".chatting-page ~ .chatting-page", list));
    dom.set(node, "data-private", "whisper");
    node.tabIndex = 0;

    const reply = (event) => {
      if (event.defaultPrevented || event.target.closest("button, a")) return;

      if (event.type === "keydown" && event.key !== "Enter") return;

      if (event.type === "click" && !window.getSelection()?.isCollapsed) return;

      event.preventDefault();
      event.stopPropagation();
      select(item.own ? item.peer : item.id).catch(() => {});
    };

    dom.on(node, "click", reply);
    dom.on(node, "keydown", reply);

    const profile = dom.query(".chatting-profile", node);
    const name = dom.query(".chatting-name", profile);
    const head = dom.create("span");
    const title = dom.create("span");

    head.className = "whisper-head";
    title.className = "whisper-label";
    title.textContent = i18n.message("direct.whisper");
    dom.set(title, "data-i18n", "direct.whisper");

    name.replaceWith(head);
    head.append(name, title);
  }

  chat.regroup(list);
  if (follow) list.scrollTop = list.scrollHeight;
}

async function select(id) {
  const version = ++selection;
  const result = await profile.read(id, { fresh: true });

  if (version !== selection || !stream) return false;

  if (!result.ok || result.data.self) {
    problem(result);

    return false;
  }

  if (result.data.receiving?.whisper === false) {
    problem({ status: 409 });

    return false;
  }

  if (!["online", "away"].includes(result.data.state)) {
    problem({ status: 409, data: { code: "offline" } });

    return false;
  }

  while (dom.query("dialog[open]")) {
    const layer = dom.all("dialog[open]").at(-1);

    if (!(await back.back()) || layer.isConnected) return false;

    if (version !== selection) return false;
  }

  const form = dom.query(".chatting-form", stream);

  let target = dom.query(".whisper-target", form);

  const clear = () => {
    selection++;
    target.hidden = true;
    dom.remove(form, "data-whisper");
    unbind?.();
    unbind = undefined;
    form.dispatchEvent(new Event("chatting-state"));
    stream.dispatchEvent(new Event("chatting-viewport"));

    return true;
  };

  if (!target) {
    target = dom.create("button");
    target.type = "button";
    target.className = "whisper-target";
    dom.set(target, "data-icon", "whisper");
    dom.set(target, "data-background", "");
    dom.set(target, "data-tooltip", "direct.clearTarget");
    dom.set(target, "data-response", "");
    target.append(dom.create("span"));
    dom.on(target, "pointerdown", (event) => event.preventDefault());
    dom.on(target, "click", clear);
    dom.query(".input", form).prepend(target);
    mount(target);
  }

  unbind?.();

  const render = (user) => {
    if (user.receiving?.whisper === false) {
      clear();

      return;
    }

    dom.query("span:not(.icon)", target).textContent = names.label(user);
  };

  render(result.data);
  unbind = profile.bind(target, id, render);
  target.hidden = false;
  dom.set(form, "data-whisper", id);
  form.dispatchEvent(new Event("chatting-state"));
  stream.dispatchEvent(new Event("chatting-viewport"));
  dom.query(".chatting-editor", form)?.focus({ preventScroll: true });

  return true;
}

export function contact() {
  return open("contact", "contact");
}

export function open(kind, id) {
  if (kind === "whisper") return select(id);

  const entry = kind === "contact" ? "settings-section" : kind;

  const render = async () => {
    let response =
      kind === "contact"
        ? await api(`${path}/contact`, { method: "POST", data: {} })
        : kind === "room"
          ? await rooms.read(id)
          : await api(`${path}/direct/message/${id}/room`);

    if (response.ok && response.data.contact && !response.data.draft) {
      response = await api(`${path}/contact/${response.data.id}`, { method: "POST", data: {} });
    }

    if (!response.ok) {
      problem(response);

      return false;
    }

    let room = response.data;

    id = room.id;
    kind = "message";

    const root = dom.create("section");
    const list = dom.create("div");
    const form = dom.create("form");
    const input = dom.create("textarea");
    const field = dom.create("div");
    const actions = dom.create("div");
    const send = dom.create("button");
    const voice = dom.create("button");
    const more = dom.create("button");

    let dismiss;

    root.className = "chatting direct";

    const top = toolbar.default([
      {
        icon: "menu",
        text: "menu.chatMenu",
        disabled: room.draft,
        run: async () => {
          if ((await menus.chatSettings(false, room.id)) === "leave") {
            await dismiss?.();
          }
        }
      }
    ]);

    top.classList.add("chatting-toolbar");
    dom.set(top, "data-position", "top");
    dom.set(top.firstElementChild, "data-circle", "");
    dom.set(top.firstElementChild, "data-scale", "");
    dom.set(top.firstElementChild, "data-tooltip", "menu.chatMenu");
    dom.set(root, "data-chatting", "messenger");
    list.className = "chatting-list";
    form.className = "chatting-form";
    field.className = "input";
    actions.className = "input-actions";
    input.className = "chatting-input";
    input.name = kind;
    input.rows = 1;
    input.maxLength = 2000;
    input.autocomplete = "off";
    dom.set(input, "data-i18n-placeholder", "chatting.message");
    send.type = "submit";
    send.className = "chatting-send";
    dom.set(send, "data-icon", "send");
    dom.set(send, "data-circle", "");
    dom.set(send, "data-confirm", "");
    dom.set(send, "data-tooltip", "chatting.send");
    more.type = "button";
    more.textContent = i18n.message("direct.more");
    dom.set(more, "data-i18n", "direct.more");
    more.hidden = true;
    if (room.contact) {
      const welcome = dom.create("p");

      welcome.className = "chatting-system";
      dom.set(welcome, "data-i18n", "menu.contactInfo");
      welcome.textContent = i18n.message("menu.contactInfo");
      list.append(welcome);
    }

    list.append(more);
    voice.type = "button";
    voice.className = "chatting-voice";
    dom.set(voice, "data-icon", "voice");
    dom.set(voice, "data-circle", "");
    dom.set(voice, "data-scale", "");
    dom.set(voice, "data-tooltip", "chatting.voice");
    actions.append(voice, send);
    field.append(input, actions);
    form.append(field);
    root.append(top, list, form);

    const seen = new Map();
    const read = new Set();
    const deleted = new Map();
    const position = positions.get(id);

    let restoring = Boolean(position);
    let ready = false;

    let cursor;
    let busy = false;
    let closed = false;
    let last;
    let loading = false;
    let heading;
    let attached;
    let closeTools;
    let closeViewport;
    let transfer;
    let unread;

    const count = (node, value = 0) => {
      if (!node) return;

      let badge = dom.query(".chatting-unread", node);

      const amount = Number(value) || 0;

      if (!amount) {
        badge?.remove();

        return;
      }

      if (!badge) {
        badge = dom.create("span");
        badge.className = "chatting-unread";

        dom.query(".chatting-time", node)?.before(badge);
      }

      badge.textContent = String(amount);
      dom.set(badge, "data-unread", String(amount));
    };

    const restore = () => {
      if (!restoring || !ready || closed) return;
      const node = seen.get(position.token);

      if (position.bottom) list.scrollTop = list.scrollHeight;
      else if (node)
        list.scrollTop +=
          node.getBoundingClientRect().top - list.getBoundingClientRect().top - position.offset;
    };

    const remember = () => {
      if (!ready || restoring) return;
      const top = list.getBoundingClientRect().top;

      let visible;

      for (const [token, node] of seen) {
        if (!node) continue;
        const rect = node.getBoundingClientRect();

        if (rect.bottom > top && (!visible || rect.top < visible.top))
          visible = { token, top: rect.top };
      }

      if (!visible) return;

      positions.delete(id);
      positions.set(id, {
        token: visible.token,
        offset: visible.top - top,
        bottom: chat.bottom(list)
      });

      if (positions.size > 100) positions.delete(positions.keys().next().value);
    };

    const interact = () => {
      restoring = false;
    };

    const wheel = dom.on(root, "wheel", interact, { passive: true });
    const touch = dom.on(root, "pointerdown", interact);
    const key = dom.on(root, "keydown", interact);
    const images = dom.on(list, "load", () => requestAnimationFrame(restore), true);
    const resize = new ResizeObserver(restore);

    resize.observe(list);

    const markRead = async () => {
      if (closed || document.hidden || !last) return;

      await api(`${path}/direct/message/${id}/read`, { method: "POST", data: { token: last } });
    };

    const notice = (item) =>
      chat.system(list, { text: "direct.deleted", time: item.time, system: true, scroll: false });

    const removed = (item) => {
      if (deleted.has(item.token)) return;

      deleted.set(item.token, Boolean(item.retained));

      const node = seen.get(item.token);

      if (!node || closed) return;

      dom.set(node, "data-deleted", "");
      count(node);
      if (item.retained) {
        dom.set(node, "data-retained", "");
        node.dispatchEvent(
          new CustomEvent("chatting-change", {
            detail: { deleted: true, retained: true, restorable: true }
          })
        );

        return;
      }

      const replacement = notice(item);

      node.replaceWith(replacement);
      seen.set(item.token, replacement);
      chat.regroup(list);
    };

    const remove = async (item) => {
      const result = await api(`${path}/direct/message/${item.token}`, { method: "DELETE" });

      if (result.ok) removed({ ...item, ...result.data });

      if (!result.ok) toast({ text: "chatting.removeFailed", type: "error" });
    };

    let confirmation;

    const deferred = new Map();
    const append = (items, older = false, initial = false) => {
      const anchor = more.nextSibling;
      const height = list.scrollHeight;
      const top = list.scrollTop;

      for (const item of items) {
        if (seen.has(item.token)) continue;

        if (busy && !older && !initial && item.own && confirmation?.id !== item.token) {
          deferred.set(item.token, item);
          continue;
        }

        if (room.contact && item.system?.type === "leave") continue;

        if (item.system) {
          const node = chat.system(list, {
            text: rooms.notice(item.system),
            time: item.time,
            system: true,
            scroll: !older && chat.bottom(list)
          });

          seen.set(item.token, node);
          if (node)
            list.insertBefore(node, older ? anchor : dom.query(":scope > [data-pending]", list));
          continue;
        }

        const removed = item.deleted || deleted.has(item.token);
        const retained = item.retained || deleted.get(item.token);
        const options = {
          ...item,
          deleted: Boolean(removed),
          retained: Boolean(retained),
          restorable: Boolean(removed && retained),
          private: true,
          removable: item.own,
          remove: () => remove(item)
        };

        const node =
          removed && !retained
            ? notice(item)
            : confirmation?.id === item.token
              ? confirmation.pending.accept(options)
              : chat.append(list, options, !older);

        seen.set(item.token, node);

        if (!removed && node && item.remaining && !read.has(item.token)) {
          count(node, item.remaining);
        }

        if (node)
          list.insertBefore(node, older ? anchor : dom.query(":scope > [data-pending]", list));

        if (!removed && initial && item.unseen && node && !unread) {
          unread = dom.create("div");
          unread.className = "chatting-new";
          unread.textContent = i18n.message("direct.new");
          dom.set(unread, "data-i18n", "direct.new");
          list.insertBefore(unread, node);
        }
      }

      chat.regroup(list);
      if (older) list.scrollTop = top + list.scrollHeight - height;
    };

    const load = async () => {
      if (loading) return;

      if (room.contact && room.draft) {
        ready = true;
        return;
      }

      loading = true;
      more.disabled = true;

      const result = await api(
        `${path}/direct/message?id=${id}` + (cursor ? `&before=${cursor}` : "")
      );

      loading = false;
      if (closed) return;

      more.disabled = false;
      if (!result.ok) {
        problem(result);
        more.hidden = false;

        return;
      }

      const initial = !cursor;

      append(result.data.items.slice().reverse(), !initial, initial);
      if (initial && result.data.items.length) {
        last = result.data.items[0].token;
        markRead();
      }

      cursor = result.data.next;
      more.hidden = !cursor;
      if (restoring && !position.bottom && !seen.has(position.token) && cursor) {
        await load();

        return;
      }

      ready = true;
      if (restoring) {
        if (!position.bottom && !seen.has(position.token)) restoring = false;
        else {
          requestAnimationFrame(restore);

          return;
        }
      }

      if (initial && unread) {
        requestAnimationFrame(() => {
          if (closed || !unread.isConnected) return;

          list.scrollTop += unread.getBoundingClientRect().top - list.getBoundingClientRect().top;
        });
      }
    };

    dom.on(more, "click", load);

    const activate = (roomId) => {
      if (!room.draft) return;

      id = roomId;
      room = { ...room, id, draft: false };
      top.firstElementChild.disabled = false;
      route.replace(room.contact ? "settings-section" : "message", ["drawer", "room", id]);
    };

    const dispatch = async (file, draft = null) => {
      const text = draft?.text ?? input.value;
      const token = draft?.token || crypto.randomUUID();
      const batch = draft?.batch || (file ? [] : attached.snapshot());
      const used = draft?.used || (file ? [] : recent.snapshot(input, text, batch));

      if (busy || closed || input.disabled || (!file && !text.trim() && !batch.length))
        return false;

      busy = true;
      transfer = draft?.controller || new AbortController();
      await Promise.resolve();

      const signal = batch.some((item) => item.type === "file")
        ? transfer.signal
        : AbortSignal.any([transfer.signal, AbortSignal.timeout(60_000)]);

      let success = false;

      const state = (value, cancel = false) => {
        if (draft?.queued && !file) return;

        dom.set(form, "data-send", value);
        form.toggleAttribute("data-cancel", cancel);
        form.dispatchEvent(new Event("chatting-state"));
      };

      if (!file && !draft) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }

      if (!draft?.queued || file) attached.busy(true);

      const pending = draft
        ? draft.pending
        : attachments.pending(root, batch, text, () => transfer?.abort());

      state(pending ? "uploading" : "sending", !pending);
      try {
        const prepared = await attachments.prepare(batch, attached, signal, pending?.change);

        if (!prepared.ok || signal.aborted || closed) {
          if (!signal.aborted && !closed) problem(prepared);

          return false;
        }

        pending?.commit();
        state(pending ? "uploading" : "sending");

        const result = file
          ? await upload(`${path}/direct/message/${id}/audio`, file, { signal })
          : await api(`${path}/direct/message/${id}`, {
              method: "POST",
              signal: transfer.signal,
              data: { token, text, attachments: prepared.items }
            });

        if (!result.ok) {
          if (result.status === 400)
            batch.forEach((item) => {
              item.receipt = null;
              attached.receipt(item, null);
            });

          if (!closed && !signal.aborted) problem(result);

          return false;
        }

        activate(result.data.room);

        success = true;
        recent.commit(used);
        if (closed) return true;

        attached.clear(batch);
        if (pending) confirmation = { id: result.data.token, pending };

        append([result.data]);
        confirmation = undefined;
        pending?.complete(seen.get(result.data.token));
        listeners.forEach((listener) => listener(result.data, id));
        state("success");
        void sound.play("send");

        return true;
      } finally {
        confirmation = undefined;
        if (success || transfer.signal.aborted) pending?.remove();

        busy = false;
        if (!closed) append([...deferred.values()]);

        deferred.clear();
        transfer = undefined;
        if (!closed) {
          attached.busy(false);
          state("idle");
        }
      }
    };

    const transmit = attachments.queue(
      root,
      input,
      () => attached,
      dispatch,
      () => !closed
    );

    dom.on(form, "submit", (event) => {
      event.preventDefault();
      transmit();
    });

    dom.on(form, "chatting-cancel", () => {
      if (form.hasAttribute("data-cancel")) transfer?.abort();
    });

    const receive = (item) => {
      const draft = room.draft && !item.own && item.id === room.peer;

      if ((!draft && item.room !== id) || item.kind !== kind || closed) return false;

      if (draft) activate(item.room);

      append([item]);
      last = item.token;
      markRead();

      return true;
    };

    listeners.add(receive);

    const removal = dom.on(events(), "direct-remove", (event) => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!closed && data.room === id) removed(data);
    });

    const revival = dom.on(events(), "direct-restore", (event) => {
      let item;

      try {
        item = JSON.parse(event.data);
      } catch {
        return;
      }

      if (closed || item.room !== id || item.kind !== "message") return;
      const old = seen.get(item.token);
      const top = list.scrollTop;
      const position = old?.getBoundingClientRect().top;

      deleted.delete(item.token);
      seen.delete(item.token);
      old?.remove();
      append([item], true);

      const next = seen.get(item.token);

      if (next) chat.place(list, next);

      chat.regroup(list);
      list.scrollTop = top;
      if (next && position !== undefined) {
        list.scrollTop += next.getBoundingClientRect().top - position;
      }
    });

    const receipt = dom.on(events(), "direct-read", (event) => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (closed || data.room !== id || !Array.isArray(data.tokens)) return;
      for (const token of data.tokens) {
        if (!data.counts?.[token]) read.add(token);
        const node = seen.get(token);

        if (node && !deleted.has(token)) {
          count(node, data.counts?.[token]);
        }
      }
    });
    const visible = dom.on(document, "visibilitychange", markRead);

    function update() {
      const allowed = room.available;
      const placeholder = room.blocked
        ? "room.blocked"
        : !room.available
          ? "room.unavailable"
          : allowed
            ? "chatting.message"
            : "direct.messageRefused";

      input.disabled = !allowed;
      dom.set(input, "data-i18n-placeholder", placeholder);
      input.placeholder = i18n.message(placeholder);
      if (heading) heading.textContent = rooms.title(room);
    }

    let revision = 0;

    const refresh = async () => {
      const version = ++revision;
      const result = room.draft
        ? room.contact
          ? await api(`${path}/contact`, { method: "POST", data: {} })
          : await api(`${path}/direct/message/${room.peer}/room`)
        : await rooms.read(room.id);

      if (closed || version !== revision) return;

      if (result.ok) {
        if (room.draft && !result.data.draft) activate(result.data.id);

        room = result.data;
      } else {
        room = { ...room, available: false };
      }

      update();
    };

    const sync = async () => {
      if (room.draft || closed) return;

      const result = await api(`${path}/direct/message?id=${id}`);

      if (!result.ok || closed) return;

      append(result.data.items.slice().reverse());
    };

    const state = dom.on(events(), "direct-state", (event) => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.room && data.room !== id) return;

      refresh();

      if (data.room === id) sync();
    });

    const connected = dom.on(events(), "ready", refresh);
    const changed = dom.on(events(), "profile-update", refresh);

    update();
    return {
      content: root,
      closing: remember,
      ready: (element, close) => {
        dismiss = close;
        route.replace(entry, [
          "drawer",
          room.draft ? (room.contact ? "settings-section" : "message") : "room",
          room.id
        ]);

        active = { id: room.peer, close, reusable: () => room.draft || room.available };

        heading = dom.query(".layer-title", element);

        if (heading) {
          dom.remove(heading, "data-i18n");
          heading.textContent = rooms.title(room);
        }

        mount(root);
        attached = attachments.default(input);
        closeTools = tools(root, { image: attached.add, attach: attached.add, audio: transmit });

        closeViewport = viewport(root);
        mount(root);
        load();
      },
      dispose: () => {
        closed = true;

        if (active?.close === dismiss) {
          active = undefined;
        }

        state();
        connected();
        changed();
        wheel();
        touch();
        key();
        images();
        resize.disconnect();
        transmit.cancel();
        transfer?.abort();
        closeTools?.();
        closeViewport?.();
        attached?.destroy();
        listeners.delete(receive);
        receipt();
        removal();
        revival();
        visible();
      }
    };
  };

  return opening(`${kind}:${id}`, () =>
    drawer({
      route: [entry, id],
      title: kind === "contact" ? "menu.contact" : "direct.message",
      back: true,
      side: "right",
      direction: "→",
      content: render
    })
  );
}

const menu = (item, refresh) =>
  opening("message-menu", async () => {
    const group = dom.create("div");
    const entries = [
      ["pin", item.pinned ? "unpin" : "pin", "pin", !item.pinned],
      ["mute", item.muted ? "unmute" : "mute", item.muted ? "notify" : "notify-mute", !item.muted],
      ["read", "readAll", "check"],
      ["leave", "leave", "logout"]
    ];

    group.className = "group";
    for (const [action, text, icon] of entries) {
      const row = dom.create("div");
      const button = dom.create("button");
      const label = dom.create("span");

      row.className = "group-item";
      button.type = "button";
      button.disabled = action === "read" && !item.unread;
      dom.set(button, "data-icon", icon);
      dom.set(button, "data-color", "");
      dom.set(button, "data-response", "");
      dom.set(button, "data-layer-action", action);

      const key = action === "leave" && item.roomInfo.contact ? "contact.end" : `direct.${text}`;

      label.textContent = i18n.message(key);
      dom.set(label, "data-i18n", key);
      button.append(label);
      row.append(button);
      group.append(row);
    }

    const action = await sheet({
      route: ["target", `/messages?conversation=${encodeURIComponent(item.id)}`],
      content: group,
      direction: "→"
    });
    const entry = entries.find((item) => item[0] === action);

    if (!entry) return;

    if (action === "leave") {
      if (await rooms.leave(item.room)) refresh();

      return;
    }

    const result =
      action === "read"
        ? await api(`${path}/direct/message/${item.room}/read`, {
            method: "POST",
            data: { token: item.token }
          })
        : await api(`${path}/direct/message/${item.room}`, {
            method: "PATCH",
            data: { action, value: entry[3] }
          });

    if (!result.ok) problem(result);
    else refresh();
  });

export function inbox(id = "") {
  return opening("inbox", async () => {
    const root = dom.create("div");
    const list = dom.create("div");
    const more = dom.create("button");

    root.className = "profile messenger-inbox";
    list.className = "group chatting inbox-list";

    dom.set(list, "data-chatting", "stream");
    more.type = "button";
    more.hidden = true;
    more.textContent = i18n.message("direct.more");
    dom.set(more, "data-i18n", "direct.more");

    const footer = dom.create("footer");
    const add = dom.create("button");

    footer.className = "messenger-footer";
    add.type = "button";
    dom.set(add, "data-blur", "");
    dom.set(add, "data-shadow", "");
    dom.set(add, "data-icon", "plus");
    dom.set(add, "data-circle", "");
    dom.set(add, "data-scale", "");
    dom.set(add, "data-tooltip", "room.start");
    dom.set(add, "data-response", "");
    dom.on(add, "click", async () => {
      const selected = await rooms.select();

      if (selected) open("room", selected);
    });

    footer.append(add);
    root.append(list, more);

    let cursor;
    let closed = false;

    let loading = false;
    let refresh = false;

    const load = async (reset = false) => {
      if (loading) {
        refresh ||= reset;

        return;
      }

      loading = true;
      if (reset) cursor = undefined;

      more.disabled = true;

      const result = await api(`${path}/direct/message` + (cursor ? `?before=${cursor}` : ""));

      loading = false;
      if (closed) return;

      more.disabled = false;
      if (!result.ok) {
        problem(result);

        return;
      }

      if (reset) list.replaceChildren();
      for (const item of result.data.items) {
        const row = dom.create("div");
        const button = dom.create("button");
        const picture = avatar(item.peerAvatar, "span");
        const heading = dom.create("span");
        const name = dom.create("span");
        const time = dom.create("time");
        const preview = dom.create("span");

        row.className = "group-item";
        button.type = "button";
        button.className = "chatting-message message-preview";
        picture.root.classList.add("chatting-avatar");
        heading.className = "chatting-profile";
        name.className = "chatting-name";
        name.textContent =
          item.roomInfo.contact && !item.roomInfo.requester.self
            ? i18n.message("contact.title").replace("{name}", names.label(item.roomInfo.requester))
            : rooms.title(item.roomInfo);

        time.className = "chatting-time";
        time.textContent = item.time ? clock.format(item.time) : "";
        if (item.time) time.dateTime = new Date(item.time).toISOString();
        for (const [active, icon, label] of [
          [item.roomInfo.contact, "mail", "menu.contact"],
          [item.pinned, "pin", "direct.pin"],
          [item.muted, "notify-mute", "direct.mute"]
        ]) {
          if (!active) continue;
          const status = dom.create("span");

          dom.set(status, "data-icon", icon);
          dom.set(status, "data-color", "");
          dom.set(status, "data-tooltip", label);
          time.append(status);
        }

        preview.className = "chatting-text";
        emoji.render(preview, item.system ? rooms.notice(item.system) : summary(item));

        heading.append(picture.root, name);
        button.append(heading, time, preview);
        if (item.unread) toolbar.badge(button, item.unread);

        button.toggleAttribute("data-read", !item.unread);
        dom.set(button, "data-response", "");
        context(button, (event) => {
          const action =
            event.type === "contextmenu" && event.shiftKey
              ? opening("message-menu", async () => {
                  if (await rooms.leave(item.room)) await load(true);
                })
              : menu(item, () => load(true));

          action.catch(() => {});
        });

        dom.on(button, "click", (event) => {
          if (!event.defaultPrevented) open("room", item.room);
        });

        row.append(button);
        list.append(row);
      }

      root.hidden = !list.childElementCount;

      mount(list);
      cursor = result.data.next;
      more.hidden = !cursor;
      if (refresh) {
        refresh = false;
        load(true);
      }
    };

    dom.on(more, "click", () => load());

    const changes = dom.on(events(), "direct-read", () => load(true));
    const preferences = dom.on(events(), "direct-change", () => load(true));
    const removals = dom.on(events(), "direct-remove", () => load(true));
    const incoming = (item) => {
      if (item.kind === "message") load(true);
    };

    listeners.add(incoming);
    try {
      return await drawer({
        title: "direct.inbox",
        content: root,
        toolbar: footer,

        side: "right",

        back: true,

        direction: "→",

        route: ["inbox", ""],
        ready: () => {
          load();

          if (id) open("room", id).catch(() => {});
        }
      });
    } finally {
      closed = true;
      changes();
      preferences();
      removals();
      listeners.delete(incoming);
    }
  });
}

route.register("message", (id) => open("message", id), "drawer");
route.register("room", (id) => open("room", id), "drawer");
route.register("inbox", inbox, "drawer");
