import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as names from "#common/profile/name";
import { chatting as path } from "#shared/route";
import api from "#common/api";
import dialog from "#common/dialog";
import popover from "#common/popover";
import drawer from "#common/drawer";
import avatar from "#common/avatar";
import profile from "#common/profile/view";
import * as profiles from "#common/profile";
import events from "#common/events";
import mount from "#common/mount";
import toast from "#common/toast";
import once from "#common/once";

const opening = once();

i18n.preload(
  "room.participants",
  "menu.contact",
  "contact.end",
  "contact.endConfirm",
  "room.title",
  ...[
    "enter",
    "invite",
    "remove",
    "owner",
    "deputy",
    "revoke",
    "leave",
    "end",
    "name",
    "contact"
  ].map((type) => `room.events.${type}`),
  ...[
    "start",
    "invite",
    "owner",
    "deputy",
    "delegate",
    "revoke",
    "deputyConfirm",
    "revokeConfirm",
    "remove",
    "transfer",
    "end",
    "name",
    "search",
    "empty",
    "group",
    "ownerRequired",
    "removeConfirm",
    "ownerConfirm",
    "endConfirm"
  ].map((key) => `room.${key}`),
  "room.block",
  "room.unblock",
  "room.blockConfirm",
  "room.leaveConfirm",
  "room.unavailable",
  "room.blocked",
  "dialog.cancel",
  "dialog.confirm",
  "direct.error",
  "direct.leave"
);

export const read = (id) => api(`${path}/rooms/${id}`);

const confirm = (title, content) =>
  dialog({
    title,
    content,
    direction: "→",
    actions: [
      { text: "dialog.cancel", icon: "close", value: false },
      { text: "dialog.confirm", icon: "check", value: true, data: ["data-danger"] }
    ]
  });

const failed = () => toast({ text: "direct.error", type: "error" });

export const leave = async (id) => {
  const current = await read(id);

  if (!current.ok) return failed();

  if (current.data.owner && current.data.participants.some((item) => !item.self)) {
    toast({ text: "room.ownerRequired", type: "info" });
    if (!(await select(id, "owner"))) return false;
  }

  if (
    !(await confirm(
      current.data.contact ? "contact.end" : "direct.leave",
      current.data.contact ? "contact.endConfirm" : "room.leaveConfirm"
    ))
  )
    return false;
  const result = await api(`${path}/rooms/${id}/leave`, { method: "POST" });

  if (!result.ok) failed();

  return result.ok;
};

export function participants(id, anchor) {
  return opening(id, async () => {
    const content = dom.create("div");

    content.className = "online";

    let closed = false;
    let revision = 0;
    let count = 0;
    let heading;

    const title = () => {
      if (heading) heading.textContent = i18n.message("room.title").replace("{count}", count);
    };

    const render = async () => {
      const version = ++revision;
      const result = await read(id);

      if (closed || version !== revision) return;

      if (!result.ok) {
        failed();

        return;
      }

      const state = result.data;
      const group = dom.create("div");

      count = state.participants.length;
      title();
      group.className = "group";
      content.replaceChildren();
      content.append(group);
      for (const user of state.participants) {
        const row = dom.create("div");
        const button = dom.create("button");
        const name = dom.create("span");
        const picture = dom.create("span");
        const status = dom.create("span");

        row.className = "group-item";
        button.type = "button";
        dom.set(button, "data-response", "");

        picture.className = "avatar-wrap";
        status.className = "profile-status";
        name.className = "online-name";
        dom.set(status, "data-state", user.state);
        picture.append(avatar(user.avatar, "span").root, status);
        name.textContent = names.label(user);
        names.mark(name, user.verified);
        button.append(picture, name);
        if (user.owner || user.deputy) {
          const badge = dom.create("span");
          const key = user.owner ? "room.owner" : "room.deputy";

          badge.className = "room-owner";
          badge.textContent = i18n.message(key);
          dom.set(badge, "data-i18n", key);
          button.append(badge);
        }

        dom.on(button, "click", () =>
          profile(button, content, {
            id: user.id,
            own: user.self,
            room: id,
            private: true,
            context: "chatting"
          })
        );

        row.append(button);
        group.append(row);
      }

      mount(content);
    };

    const off = ["direct-state", "presence", "ready"].map((type) => dom.on(events(), type, render));

    try {
      return await popover({
        title: "room.participants",
        content,
        anchor,
        back: true,
        direction: "→",
        ready: (element) => {
          heading = dom.query(".layer-title", element);
          dom.remove(heading, "data-i18n");
          title();
          void render();
        }
      });
    } finally {
      closed = true;
      off.forEach((stop) => stop());
    }
  });
}

export async function block(user) {
  const result = await profiles.read(user.id, { fresh: true });

  if (!result.ok) return failed();
  const blocked = result.data.directBlocked;

  if (!blocked && !(await confirm("room.block", "room.blockConfirm"))) {
    return false;
  }

  const response = await api(`${path}/direct/${user.id}/block`, {
    method: "PATCH",
    data: { blocked: !blocked }
  });

  if (!response.ok) failed();
  else await profiles.refresh(user.id);

  return response.ok;
}

export const title = (room) => {
  if (room.contact) return i18n.message("menu.contact");

  if (room.multiple)
    return `${room.name || i18n.message("room.group")} ${room.participants.length}`;

  return (
    room.name ||
    names.label(room.participants.find((item) => !item.self) || { id: room.peer || "" }) ||
    i18n.message("room.group")
  );
};

export const notice = (event) =>
  i18n.message(`room.events.${event.type}`).replace(/\{(\w+)\}/g, (_, key) => {
    if (key === "actor") return names.label(event.actor);

    if (key === "targets") return event.targets.map((user) => names.label(user)).join(", ");

    if (key === "members")
      return [event.actor, ...event.targets].map((user) => names.label(user)).join(", ");

    return event.value || "";
  });

export async function manage(id, action, value) {
  if (action === "name") {
    const input = dom.create("input");
    const field = dom.create("div");
    const current = await read(id);

    if (!current.ok) return failed();

    field.className = "input";
    input.value = current.data.name;
    input.maxLength = 60;
    dom.set(input, "data-control", "");
    field.append(input);

    const accepted = await dialog({
      title: "room.name",
      content: field,
      direction: "→",
      actions: [
        { text: "dialog.cancel", icon: "close", value: false },
        { text: "dialog.confirm", icon: "check", value: true, submit: true }
      ]
    });

    if (!accepted || !input.value.trim()) return false;

    value = input.value.trim();
  } else if (!(await confirm(`room.${action}`, `room.${action}Confirm`))) {
    return false;
  }
  const result = await api(`${path}/rooms/${id}`, { method: "PATCH", data: { action, value } });

  if (!result.ok) failed();

  return result.ok;
}

export function select(id = "", mode = id ? "invite" : "start") {
  return opening("room-select", async () => {
    const root = dom.create("div");
    const field = dom.create("div");
    const input = dom.create("input");
    const group = dom.create("div");

    root.className = "online";
    field.className = "input";
    group.className = "group";
    input.type = "search";
    input.maxLength = 80;
    dom.set(input, "data-control", "");
    dom.set(input, "data-i18n-placeholder", "room.search");
    field.append(input);
    root.append(field, group);

    const selected = new Set();

    let check;
    let timer;
    let closed = false;
    let request;
    let revision = 0;

    async function load() {
      const version = ++revision;

      request?.abort();
      request = new AbortController();

      const result =
        mode === "owner"
          ? await read(id)
          : await api(`${path}/rooms/search?${new URLSearchParams({ q: input.value, room: id })}`, {
              signal: request.signal
            });

      if (closed || version !== revision) return;

      group.replaceChildren();
      if (!result.ok) {
        failed();

        return;
      }

      const items =
        mode === "owner"
          ? result.data.participants.filter(
              (item) => !item.self && names.label(item).includes(input.value)
            )
          : mode === "start"
            ? result.data.items.filter((item) => item.available !== false)
            : result.data.items;

      for (const user of items) {
        const row = dom.create("div");
        const field = dom.create("div");
        const label = dom.create("label");
        const control = dom.create("input");
        const name = dom.create("span");
        const picture = dom.create("span");

        row.className = "group-item";
        field.className = "checkbox";
        control.type = "checkbox";
        control.value = user.id;
        control.checked = selected.has(user.id);
        control.disabled = user.available === false;
        name.className = "online-name";
        name.textContent = names.label(user);
        names.mark(name, user.verified);
        picture.className = "avatar-wrap";
        picture.append(avatar(user.avatar, "span").root);
        label.append(picture, name, control);
        dom.on(control, "change", () => {
          if (mode === "owner") {
            selected.clear();
            dom.all("input", group).forEach((item) => {
              if (item !== control) item.checked = false;
            });
          }

          if (control.checked) selected.add(user.id);
          else selected.delete(user.id);

          check.disabled = !selected.size;
        });

        field.append(label);
        row.append(field);
        group.append(row);
      }

      if (!items.length) {
        const empty = dom.create("p");

        empty.className = "online-empty";
        empty.textContent = i18n.message("room.empty");
        dom.set(empty, "data-i18n", "room.empty");
        group.append(empty);
      }

      mount(root);
    }

    dom.on(input, "input", () => {
      clearTimeout(timer);
      revision++;
      request?.abort();
      timer = setTimeout(load, 200);
    });

    let accepted;

    try {
      accepted = await drawer({
        title: mode === "owner" ? "room.transfer" : `room.${mode}`,
        content: root,
        back: true,
        direction: "→",
        side: "right",
        actions: [
          {
            head: true,
            icon: "check",
            text: "dialog.confirm",
            value: true,
            disabled: () => !selected.size
          }
        ],
        ready: (element) => {
          check = dom.query(".layer-action", element);

          return load();
        }
      });
    } finally {
      closed = true;
      clearTimeout(timer);
      request?.abort();
    }

    if (accepted !== true || !selected.size) return false;

    if (mode === "owner") return manage(id, "owner", [...selected][0]);
    const result = await api(id ? `${path}/rooms/${id}/invite` : `${path}/rooms`, {
      method: "POST",
      data: { ids: [...selected] }
    });

    if (!result.ok) {
      failed();

      return false;
    }

    return result.data.id;
  });
}
