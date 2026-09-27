import * as dom from "#common/dom";
import dialog from "#common/dialog";
import drawer from "#common/drawer";
import * as i18n from "#common/i18n";
import * as profile from "#common/profile";
import line from "#common/line";
import label from "#common/profile/label";
import authority from "#common/profile/authority";
import history from "#common/profile/history";
import report from "#common/report";
import inbox from "#common/report/inbox";
import * as room from "#common/room";
import events from "#common/events";
import mount from "#common/mount";

i18n.preload("profile.reportHistory");

const online = (user) => ["online", "away"].includes(user.state);

const emit = (target, type, detail) => {
  target?.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
};

const item = (handlers, data) => {
  const { text, icon, run } = data;
  const { danger, next, close = true, disabled = false } = data;
  const row = dom.create("div");
  const button = dom.create("button");
  const label = dom.create("span");

  row.className = "group-item";
  if (danger) dom.set(row, "data-danger", "");

  button.type = "button";
  button.disabled = disabled;
  dom.set(button, "data-icon", icon);
  button.toggleAttribute("data-color", !danger && icon !== "arrow");
  dom.set(button, "data-response", "");
  if (close) dom.set(button, "data-layer-action", text);

  label.textContent = i18n.message(text);
  dom.set(label, "data-i18n", text);
  button.append(label);

  if (close) {
    handlers.set(text, run);
  } else {
    dom.on(button, "click", run);
  }

  if (next) {
    const arrow = dom.create("span");

    arrow.className = "group-next";
    dom.set(arrow, "data-icon", "arrow");
    button.append(arrow);
  }

  row.append(button);

  return row;
};

const group = (...items) => {
  const element = dom.create("div");

  element.className = "group";
  element.append(...items.filter(Boolean));
  element.hidden = !element.childElementCount;

  return element;
};

const personal = (user, handlers) =>
  item(handlers, {
    text: user.directBlocked ? "room.unblock" : "room.block",
    icon: "minus",
    danger: true,
    close: false,
    run: () => room.block(user)
  });

const hidden = (target, options) => {
  const value = dom.create("span");
  const row = dom.create("div");
  const field = dom.create("div");
  const label = dom.create("label");
  const text = dom.create("span");
  const input = dom.create("input");

  row.className = "group-item";
  dom.set(value, "data-icon", "eye-off");
  field.className = "switch";

  text.textContent = i18n.message("profile.hide");
  dom.set(text, "data-i18n", "profile.hide");

  input.type = "checkbox";
  input.name = "chatting-hide";
  input.checked = Boolean(options.hidden);

  dom.on(input, "change", () => {
    emit(target, "chatting-hide", { ...options, hidden: input.checked });
  });

  value.append(text);
  label.append(value, input);
  field.append(label);
  row.append(field);

  return row;
};

const block = async (user) => {
  const blocked = user.blocked;
  const content = dom.create("div");
  const field = dom.create("div");
  const input = dom.create("input");

  content.className = "profile";
  field.className = "input";
  input.name = "block-reason";
  input.autocomplete = "off";
  input.enterKeyHint = "done";
  input.maxLength = 500;

  dom.set(input, "data-control", "");
  dom.set(
    input,
    "data-i18n-placeholder",
    blocked ? "profile.unblockReason" : "profile.blockReason"
  );

  field.append(input);
  content.append(field);

  const confirmed = await dialog({
    title: blocked ? "profile.unblock" : "profile.block",
    content,
    direction: "→",
    actions: [
      { text: "profile.cancel", icon: "close", value: false, data: ["data-neutral"] },
      {
        text: "profile.confirm",
        icon: "check",
        submit: true,
        value: true,
        data: ["data-danger"],
        disabled: () => !input.value.trim()
      }
    ]
  });

  if (!confirmed) {
    return;
  }

  const result = blocked
    ? await profile.unblock(user.id, input.value.trim())
    : await profile.block(user.id, input.value.trim());

  if (!result.ok) {
    await dialog({
      title: "setup.title",
      content: "profile.saveError",
      direction: "→",
      actions: [{ text: "dialog.confirm", icon: "check", value: true }]
    });

    return;
  }

  await profile.read(user.id, { fresh: true });
};

const sanction = async (user, action) => {
  const content = dom.create("div");
  const field = dom.create("div");
  const input = dom.create("input");

  content.className = "profile";
  field.className = "input";
  input.name = "sanction-reason";
  input.maxLength = 500;
  input.enterKeyHint = "done";
  dom.set(input, "data-control", "");
  dom.set(input, "data-i18n-placeholder", "profile.historyReason");
  field.append(input);
  content.append(field);

  let busy = false;

  await dialog({
    title:
      action === "mute"
        ? "profile.chatMute"
        : action === "kick"
          ? "profile.kick"
          : "profile.unkick",
    content,
    direction: "→",
    actions: [
      { text: "profile.cancel", icon: "close", value: false, data: ["data-neutral"] },
      {
        text: "profile.confirm",
        icon: "check",
        submit: true,
        data: ["data-danger"],
        disabled: () => busy || !input.value.trim(),
        run: async () => {
          if (busy || !input.value.trim()) return false;

          busy = true;
          try {
            const result = await profile.sanction(user.id, action, input.value.trim());

            if (!result.ok) {
              await dialog({
                title: "setup.title",
                content: "profile.saveError",
                direction: "→",
                actions: [{ text: "dialog.confirm", icon: "check", value: true }]
              });

              return false;
            }

            await profile.read(user.id, { fresh: true });

            return true;
          } finally {
            busy = false;
          }
        }
      }
    ]
  });
};

export const moderation = (user, handlers, opening) => {
  if (!user.manage || user.self || !user.details) return null;
  const element = group(
    user.authority ? authority(user) : null,
    ...(user.blocked
      ? [
          label("profile.blockReason", user.block?.reason),
          label("profile.blockTime", user.block?.time, { date: true }),
          label("profile.handler", user.block?.handler)
        ]
      : [
          online(user)
            ? item(handlers, {
                text: "profile.chatMute",
                icon: "tts-mute",
                danger: true,
                close: false,
                run: () => opening(`sanction:${user.id}`, () => sanction(user, "mute"))
              })
            : null,
          online(user) || user.sanction?.kicked
            ? item(handlers, {
                text: user.sanction?.kicked ? "profile.unkick" : "profile.kick",
                icon: "arrow",
                danger: true,
                close: false,
                run: () =>
                  opening(`sanction:${user.id}`, () =>
                    sanction(user, user.sanction?.kicked ? "unkick" : "kick")
                  )
              })
            : null
        ]),
    item(handlers, {
      text: "profile.blockHistory",
      icon: "info",
      next: true,
      close: false,
      run: () => opening(`history:${user.id}`, () => history(user.id, "sanction"))
    }),
    item(handlers, {
      text: user.blocked ? "profile.unblock" : "profile.block",
      icon: "error",
      danger: true,
      close: false,
      run: () => opening(`block:${user.id}`, () => block(user))
    })
  );

  if (user.blocked) element.classList.add("profile-block");

  return element;
};

export const manage = (user, target, options, handlers, opening) => {
  if ((!user.manage && !user.self) || !user.details) {
    return null;
  }

  const details = user.details;
  const element = dom.create("section");
  const info = dom.create("div");
  const fields = group(
    label("profile.id", user.id, { short: true }),
    label("profile.email", details.email),
    ...(details.date || details.userIp || details.time || details.accessIp
      ? [line({ type: "dotted", text: "profile.access", icon: "info" })]
      : []),
    label("profile.date", details.date, { date: true }),
    label("profile.userIp", details.userIp),
    label("profile.time", details.time, { date: true }),
    label("profile.accessIp", details.accessIp),
    ...(details.os || details.browser || details.lang
      ? [line({ type: "dotted", text: "profile.environment", icon: "theme" })]
      : []),
    label("profile.lang", details.lang),
    label("profile.os", details.os),
    label("profile.browser", details.browser)
  );

  element.className = "profile-section";
  info.className = "profile-details";
  dom.set(fields, "data-background", "");
  info.append(fields);
  element.append(info);
  if (user.self || !user.manage) return element;

  element.append(moderation(user, handlers, opening));

  return element;
};

const gift = (handlers) => {
  const row = item(handlers, {
    text: "profile.gift",
    icon: "gift",
    next: true,
    close: false,
    run: () =>
      drawer({
        back: true,
        title: "profile.gift",
        content: dom.create("div"),
        side: "right",
        direction: "→"
      })
  });

  row.hidden = true;

  return row;
};

export const message = (user, target, options, handlers, opening) => {
  const context = [];

  if (!user.self) {
    for (const [text, icon, event] of [
      ["message", "mail", "chatting-message"],
      ["whisper", "whisper", "chatting-whisper"]
    ]) {
      if (text === "message" && user.receiving?.message === false) continue;

      if (
        text === "whisper" &&
        ((options.private && options.room) ||
          target?.closest?.('.chatting[data-chatting="messenger"]') ||
          !online(user) ||
          user.receiving?.whisper === false)
      )
        continue;

      context.push(
        item(handlers, { text: `profile.${text}`, icon, run: () => emit(target, event, options) })
      );
    }

    context.push(
      gift(handlers),
      options.private && options.kind === "message" ? null : hidden(target, options),
      personal(user, handlers)
    );
  }

  const records = [];

  if (user.manage && user.details) {
    for (const [text, icon, run] of [
      ["chatHistory", "info", () => history(user.id, "chatting")],
      ["reportHistory", "flag", () => inbox(user.id)]
    ])
      records.push(
        item(handlers, {
          text: `profile.${text}`,
          icon,
          close: false,
          run: () => opening(`history:${user.id}`, run)
        })
      );
  }

  records.push(
    item(handlers, {
      text: "chatting.action.report",
      disabled: user.self || (!options.url && !options.proof),
      icon: "flag",
      danger: true,
      run: () => report("message", options.url || options.token, user.self, options.evidence?.())
    })
  );

  return [group(...context), group(...records), moderation(user, handlers, opening)].filter(
    Boolean
  );
};

export const context = (user, target, options, handlers, opening) => {
  const element = dom.create("section");

  element.className = "profile-section";

  if (!user.self) {
    const direct =
      (options.private && options.room) ||
      target?.closest?.('.chatting[data-chatting="messenger"]');

    const whisper = direct
      ? null
      : item(handlers, {
          text: "profile.whisper",
          icon: "whisper",
          run: () => emit(target, "chatting-whisper", options)
        });

    if (whisper) {
      dom.set(whisper, "data-whisper", "");
      whisper.hidden = !online(user) || user.receiving?.whisper === false;
    }

    const items = [
      user.receiving?.message === false
        ? null
        : item(handlers, {
            text: "profile.message",
            icon: "mail",
            run: () => emit(target, "chatting-message", options)
          }),
      whisper
    ].filter(Boolean);

    items.push(gift(handlers), hidden(target, options), personal(user, handlers));

    if (user.manage && user.details) {
      const entry = item(handlers, {
        text: "profile.chatHistory",
        icon: "info",
        next: true,
        close: false,
        run: () => opening(`history:${user.id}`, () => history(user.id, "chatting"))
      });

      entry.classList.add("profile-history");
      items.push(entry);

      const reports = item(handlers, {
        text: "profile.reportHistory",
        icon: "flag",
        next: true,
        close: false,
        run: () => opening(`reports:${user.id}`, () => inbox(user.id))
      });

      reports.classList.add("profile-history");
      items.push(reports);
    }

    items.push(
      item(handlers, {
        text: "profile.report",
        icon: "flag",
        danger: true,
        close: false,
        run: () => report("user", user.id, user.self)
      })
    );

    element.append(group(...items));
  }

  return element;
};

export function member(user, id, handlers) {
  const root = group();

  let closed = false;
  let revision = 0;

  const update = async () => {
    if (!id || user.self) return;
    const version = ++revision;
    const result = await room.read(id);

    if (closed || version !== revision) return;

    root.replaceChildren();

    const current = result.data;

    root.hidden =
      !result.ok ||
      (!current.owner && !current.deputy) ||
      current.closed ||
      current.departed ||
      !current.participants.some((item) => item.id === user.id);

    if (root.hidden) return;
    const peer = current.participants.find((item) => item.id === user.id);

    if (!current.owner && (peer.owner || peer.deputy)) {
      root.hidden = true;

      return;
    }

    const items = [["remove", "room.remove", "logout"]];

    if (current.owner)
      items.push(
        ["owner", "room.transfer", "user"],
        peer.deputy ? ["revoke", "room.revoke", "minus"] : ["deputy", "room.delegate", "user"]
      );
    for (const [action, text, icon] of items)
      root.append(
        item(handlers, {
          text,
          icon,
          close: false,
          danger: action === "remove",
          run: () => room.manage(id, action, user.id)
        })
      );
    mount(root);
  };

  const off = id && !user.self ? dom.on(events(), "direct-state", update) : () => {};

  update();

  return {
    root,
    off: () => {
      closed = true;
      off();
    }
  };
}
