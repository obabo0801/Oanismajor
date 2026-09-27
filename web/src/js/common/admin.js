import * as dom from "#common/dom";
import * as caption from "#common/caption";
import * as i18n from "#common/i18n";
import * as navigation from "#common/route";
import * as names from "#common/profile/name";
import { admin as path } from "#shared/route";
import api from "#common/api";
import upload from "#common/upload";
import drawer from "#common/drawer";
import dialog from "#common/dialog";
import toast from "#common/toast";
import progress from "#common/progress";
import mount from "#common/mount";
import once from "#common/once";
import context from "#common/context";
import avatar from "#common/avatar";
import profile from "#common/profile/view";
import reports from "#common/report/inbox";
import * as rooms from "#common/chatting/room";
import { chatting } from "#shared/route";
import label from "#common/profile/label";
import toolbar from "#common/toolbar";
import format from "#common/format";
import file from "./file.js";
import voice from "./chatting/voice.js";
import { stop } from "./voice.js";
import "../../css/common/admin.css";

const opening = once();
const keys = [
  "panel",
  "heading",
  "title",
  "body",
  "image",
  "url",
  "send",
  "users",
  "database",
  "search",
  "filter",
  "all",
  "previous",
  "next",
  "details",
  "empty",
  "error",
  "sent",
  "confirm",
  "operations",
  "data",
  "files",
  "upload",
  "tts",
  "stt",
  "service",
  "log",
  "evidence",
  "filename",
  "uploader",
  "requester",
  "related",
  "profileImage",
  "audio",
  "original",
  "cache",
  "size",
  "time",
  "text",
  "preview",
  "folder",
  "table",
  "fields",
  "condition",
  "refresh"
];

const states = [
  "valid",
  "expired",
  "expiring",
  "authenticated",
  "configured",
  "connected",
  "missing",
  "invalid",
  "unavailable",
  "unchecked",
  "disabled",
  "fallback",
  "rebuild"
];

i18n.preload(
  "sound.model",
  "sound.automatic",
  ...["manage", "create", "name", "info", "state", "save", "delete", "confirm", "open"].map(
    (key) => `rooms.${key}`
  ),
  ...["connection", "certificate", "host", "issuer", "issued", "expires", "checked"].map(
    (key) => `admin.${key}`
  ),
  ...states.map((key) => `admin.states.${key}`),
  ...["HTTPS", "TTS", "STT", "GOOGLE", "SOOP", "VAPID", "GIPHY"].map(
    (key) => `admin.connections.${key}`
  ),
  "menu.devices",
  "assets.unknown",
  "chatting.voice",
  ...keys.map((key) => `admin.${key}`),
  "report.inbox",
  "dialog.cancel",
  "dialog.confirm"
);

const node = (tag, className = "", key = "") => {
  const element = dom.create(tag);

  element.className = className;

  if (key) {
    element.textContent = i18n.message(key);
    dom.set(element, "data-i18n", key);
  }

  if (tag === "button") {
    dom.set(element, "data-response", "");
  }

  return element;
};

const fail = () => toast({ text: "admin.error", type: "error" });
const group = (...rows) => {
  const root = node("div", "group");

  for (const row of rows.filter(Boolean)) {
    if (row.classList.contains("group-item")) root.append(row);
    else {
      const item = node("div", "group-item");

      item.append(row);
      root.append(item);
    }
  }

  return root;
};

const grid = (...rows) => {
  const root = group(...rows);

  root.classList.add("admin-grid");
  dom.set(root, "data-view", "grid");
  return root;
};

const source = (kind, item) =>
  `/api${path}/files/${kind}/content?${new URLSearchParams({ file: item.file })}`;

const thumbnail = (row, url) => {
  const button = dom.query("button", row);
  const image = node("img", "admin-thumbnail");

  image.alt = "";
  image.draggable = false;
  image.loading = "lazy";
  dom.remove(button, "data-icon");
  dom.on(image, "error", () => {
    image.remove();
    dom.set(button, "data-icon", "image");
    mount(button);
  });

  image.src = url;
  button.prepend(image);
};

const entry = (key, icon, run) => {
  const row = node("div", "group-item");
  const button = node("button");

  button.type = "button";
  dom.set(button, "data-icon", icon);
  dom.set(button, "data-color", "");
  button.append(node("span", "name", key));
  dom.on(button, "click", run);
  row.append(button);

  return row;
};

const open = (title, content, options = {}) =>
  drawer({
    title,
    content,
    route: [
      "admin-section",
      { heading: "notification" }[title.split(".")[1]] || title.split(".")[1]
    ],
    back: true,
    side: "right",
    direction: "→",
    ...options
  });

const field = (key, type = "text", compact = false) => {
  const control = node("div", "input");
  const input = node(type === "textarea" ? "textarea" : "input");

  if (type !== "textarea") input.type = type;

  input.name = key.split(".").at(-1);

  dom.set(input, "data-control", "");
  control.append(input);

  const root = compact ? control : node("label", "label");

  if (compact) {
    input.placeholder = i18n.message(key);
    dom.set(input, "data-i18n-placeholder", key);
  } else {
    root.append(node("span", "label-key", key), control);
  }

  return { root, input };
};

function notify() {
  return open("admin.heading", async () => {
    const response = await api(`${path}/recipients`);

    if (!response.ok) return fail();
    const selected = new Set(response.data.map((item) => item.id));
    const root = node("div", "profile admin admin-notify");
    const fields = Object.fromEntries(
      ["title", "body", "url"].map((key) => [
        key,
        field(`admin.${key}`, key === "body" ? "textarea" : "text", true)
      ])
    );

    fields.title.input.required = true;
    fields.title.input.maxLength = 100;
    fields.body.input.required = true;
    fields.body.input.maxLength = 500;
    fields.url.input.value = "/";
    fields.image = file({ accept: "image/png,image/jpeg,image/webp", compact: true });

    const composer = node("div", "admin-composer");
    const actions = node("div", "input-actions");
    const microphone = node("button");

    microphone.type = "button";
    dom.set(microphone, "data-icon", "voice");
    dom.set(microphone, "data-circle", "");
    dom.set(microphone, "data-tooltip", "chatting.voice");
    dom.on(microphone, "click", () => voice(fields.body.input, microphone));
    actions.append(fields.image.button, microphone);
    fields.body.input.rows = 4;
    fields.body.root.classList.add("input-compose");
    fields.body.root.append(actions);
    composer.append(fields.image.root, fields.body.root);

    const rows = response.data.map((user) => {
      const row = node("div", "toggle admin-recipient");
      const head = node("div", "toggle-head");
      const button = node("button", "toggle-button");
      const gear = node("button", "toggle-switch toggle-action");
      const picture = node("span", "avatar-wrap");
      const name = node("span", "name");

      picture.append(avatar(user.avatar, "span").root);
      name.textContent = names.label(user);
      names.mark(name, user.verified);
      button.type = gear.type = "button";
      button.append(picture, name);
      dom.set(row, "data-active", "");
      dom.set(gear, "data-icon", "info");
      dom.on(button, "click", () => {
        if (selected.has(user.id)) selected.delete(user.id);
        else selected.add(user.id);

        row.toggleAttribute("data-active", selected.has(user.id));
        sync();
      });

      dom.on(gear, "click", () => profile(gear, root, { id: user.id, context: "chatting" }));

      head.append(button, gear);
      row.append(head);
      return row;
    });

    const writing = group(fields.title.root, composer, fields.url.root);

    writing.classList.add("admin-writing");
    root.append(writing, section("menu.devices", ...rows));

    if (!rows.length) root.append(node("p", "online-empty", "admin.empty"));

    let sending = false;

    const controls = toolbar([
      {
        text: "admin.send",
        icon: "send",
        color: true,
        run: async (button) => {
          if (!valid() || sending) return;
          for (const key of ["title", "body", "url"]) {
            if (!fields[key].input.reportValidity()) return;
          }
          const data = {
            title: fields.title.input.value,
            body: fields.body.input.value,
            url: fields.url.input.value,
            recipients: [...selected],
            image: ""
          };
          const file = fields.image.input.files[0];

          if (
            !(await dialog({
              title: "admin.heading",
              content: i18n.message("admin.confirm").replace("{count}", data.recipients.length),
              direction: "→",
              actions: [
                { text: "dialog.cancel", icon: "close", value: false },
                { text: "chatting.send", icon: "send", value: true }
              ]
            }))
          )
            return;

          sending = true;
          button.disabled = true;

          const loading = file ? progress({ value: 0, show: false }) : null;

          if (loading) root.append(loading.element);
          try {
            if (file) {
              const result = await upload(`${path}/image`, file, {
                progress: (loaded, total) => loading.set((loaded / total) * 100)
              });

              if (!result.ok) return fail();

              data.image = result.data.image;
              loading.destroy();
            }

            const result = await api(path, { method: "POST", data });

            if (!result.ok) return fail();

            toast({
              type: result.data.failed ? "info" : "success",
              text: i18n
                .message("admin.sent")
                .replace("{sent}", result.data.sent)
                .replace("{failed}", result.data.failed)
            });

            if (fields.image.input.files[0] === file) fields.image.reset();
          } finally {
            loading?.destroy();
            sending = false;
            sync();
          }
        }
      }
    ]);

    function valid() {
      return (
        selected.size > 0 &&
        fields.title.input.value.trim() !== "" &&
        fields.body.input.value.trim() !== ""
      );
    }

    function sync() {
      dom.query("button", controls).disabled = sending || !valid();
    }

    dom.on(root, "input", sync);
    sync();
    return {
      content: root,
      toolbar: controls,
      closing: () => {
        fields.body.input.disabled = true;
        if (microphone.hasAttribute("data-recording")) stop();
      },
      dispose: () => fields.image.destroy()
    };
  });
}

function tools(load, filtered = false) {
  const values = { q: "", field: "", value: "", page: 0 };

  let columns = [];
  let closed = false;

  const edit = async (button, condition = false) => {
    const content = node("div", "profile");
    const search = field(condition ? "admin.filter" : "admin.search", "search");
    const select = node("select");

    select.name = "field";

    search.input.maxLength = 200;
    search.input.value = condition ? values.value : values.q;
    if (condition) {
      const choice = node("div", "select");
      const label = node("label", "label");
      const all = node("option", "", "admin.all");

      all.value = "";
      select.append(all);
      for (const column of columns) {
        const option = node("option");

        option.value = option.textContent = column;
        select.append(option);
      }
      select.value = values.field;
      choice.append(select);
      label.append(node("span", "label-key", "admin.fields"), choice);
      content.append(label);
    }

    content.append(search.root);

    const result = await dialog({
      title: condition ? "admin.condition" : "admin.search",
      content,
      actions: [
        { text: "dialog.cancel", icon: "close", value: false },
        { text: "image.reset", icon: "reload", value: "reset" },
        { text: "dialog.confirm", icon: "check", value: true, submit: true }
      ]
    });

    if (closed || (result !== true && result !== "reset")) return;

    if (condition) {
      values.field = result === "reset" ? "" : select.value;
      values.value = values.field ? search.input.value.trim() : "";
    } else values.q = result === "reset" ? "" : search.input.value.trim();

    button.toggleAttribute("data-selected", Boolean(condition ? values.field : values.q));

    values.page = 0;
    await load();
  };

  const root = toolbar([
    { icon: "search", text: "admin.search", color: true, run: (button) => edit(button) },
    ...(filtered
      ? [
          {
            icon: "setting",
            text: "admin.condition",
            color: true,
            run: (button) => edit(button, true)
          }
        ]
      : []),
    { icon: "reload", text: "admin.refresh", color: true, run: () => load() },
    {
      icon: "arrow",
      text: "admin.previous",
      disabled: true,
      run: () => {
        values.page--;
        return load();
      }
    },
    {
      icon: "arrow",
      text: "admin.next",
      disabled: true,
      run: () => {
        values.page++;
        return load();
      }
    }
  ]);
  const buttons = [...root.children];
  const previous = buttons.at(-2);
  const next = buttons.at(-1);
  const page = node("output");

  root.classList.add("admin-tools");
  dom.set(previous, "data-angle", "left");
  dom.set(page, "data-page", "");
  root.insertBefore(page, next);
  page.textContent = "1 / 1";
  return {
    root,
    values,
    busy: () => {
      previous.disabled = next.disabled = true;
    },
    update: (data) => {
      columns = data.columns || [];
      previous.disabled = values.page === 0;
      next.disabled = (values.page + 1) * 30 >= data.total;
      page.textContent = `${values.page + 1} / ${Math.max(1, Math.ceil(data.total / 30))}`;
    },
    close: () => {
      closed = true;
    }
  };
}

async function browse(table = "", scope = {}) {
  const root = node("div", "profile online admin");
  const rows = node("div");
  const controls = tools(load, Boolean(table));

  let revision = 0;
  let closed = false;
  let request;

  if (table) root.append(label("admin.table", table));

  root.append(rows);

  async function load() {
    const version = ++revision;

    request?.abort();
    request = new AbortController();
    controls.busy();

    const params = new URLSearchParams({ ...scope, ...controls.values });
    const response = await api(`${path}/${table ? `database/${table}` : "users"}?${params}`, {
      signal: request.signal
    });

    if (closed || version !== revision) return;

    if (!response.ok) return fail();

    rows.replaceChildren();

    const data = response.data;

    controls.update(data);
    if (!data.items.length) rows.append(node("p", "online-empty", "admin.empty"));
    else
      rows.append(
        (table ? grid : group)(
          ...data.items.map((item, index) => {
            if (table) {
              const row = entry("", "storage", () => details(item, data.columns, table, scope));

              const key = ["name", "title", "text", "id", "file", ...data.columns].find(
                (key) => item[key] != null && item[key] !== ""
              );

              dom.query(".name", row).textContent = String(item[key] ?? index + 1);

              const image = [item.preview, item.image, item.avatar, item.url].find(
                (value) =>
                  typeof value === "string" &&
                  /^\/(?:[a-f0-9]{8}|upload\/(?:images|users)\/(?:original|cache|resizing))\/[a-f0-9]{32}\.(?:png|jpg|jpeg|gif|webp)$/.test(
                    value
                  )
              );

              if (image) thumbnail(row, image);
              return row;
            }
            const row = entry("", "", () =>
              profile(dom.query("button", row), root, { id: item.id, context: "chatting" })
            );
            const button = dom.query("button", row);
            const picture = node("span", "avatar-wrap");
            const name = node("span", "name");

            dom.remove(button, "data-icon");
            picture.append(avatar(item.avatar, "span").root);
            name.textContent = names.label(item);
            names.mark(name, item.verified);
            button.replaceChildren(picture, name);
            return row;
          })
        )
      );

    mount(root);
  }
  try {
    return await open(table ? "admin.database" : "admin.users", root, {
      route: [
        "admin-section",
        table ? `database?${new URLSearchParams({ ...scope, table })}` : "users"
      ],
      ready: load,
      toolbar: controls.root
    });
  } finally {
    closed = true;
    controls.close();
    request?.abort();
  }
}

function details(item, columns, table, scope) {
  const dates = new Set([
    "time",
    "date",
    "registered",
    "updated",
    "read",
    "deleted",
    "left",
    "closed",
    "assigned",
    "departed",
    "renamed",
    "muted",
    "kicked",
    "until",
    "expires",
    "deletion",
    "recovery_until"
  ]);

  const content = group(
    ...columns.map((key) => {
      const value = item[key];
      const date =
        dates.has(key) &&
        ((typeof value === "number" && value > 0) ||
          (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(value)));

      const row = label("admin.details", value === "" || value == null ? "—" : value, {
        date: date ? "seconds" : false
      });
      const caption = dom.query(".label-key", row);

      dom.remove(caption, "data-i18n");
      caption.textContent = key;
      return row;
    })
  );

  content.classList.add("admin");
  return open("admin.details", content, {
    route: [
      "target",
      `/admin/database?${new URLSearchParams({ ...scope, table, record: item.id || item.uid || "" })}`
    ]
  });
}

function section(key, ...rows) {
  const root = node("section", "group-section");

  root.append(node("h3", "group-title", key), group(...rows));
  return root;
}

function database(scope = {}) {
  return open(
    "admin.database",
    async () => {
      const response = await api(`${path}/database?${new URLSearchParams(scope)}`);

      if (!response.ok) return fail();
      const root = node("div", "profile admin");

      if (!response.data.length) root.append(node("p", "online-empty", "admin.empty"));

      root.append(
        grid(
          ...response.data.map((item) => {
            const row = entry(item.key || "", "storage", () =>
              item.table ? browse(item.table, scope) : database(item.scope)
            );

            if (!item.key) dom.query(".name", row).textContent = item.name || item.table;
            return row;
          })
        )
      );

      return root;
    },
    {
      route: [
        "admin-section",
        `database${Object.keys(scope).length ? `?${new URLSearchParams(scope)}` : ""}`
      ]
    }
  );
}

function people(root, key, users = []) {
  const rows = users
    .filter((user) => user.id)
    .map((user) => {
      const row = node("div", "group-item");
      const button = node("button");
      const picture = node("span", "avatar-wrap");
      const name = node("span", "online-name");

      button.type = "button";
      picture.append(avatar(user.avatar, "span").root);
      name.textContent = names.label(user);
      names.mark(name, user.verified);
      button.append(picture, name);
      dom.on(button, "click", () => profile(button, root, { id: user.id, context: "chatting" }));

      row.append(button);
      return row;
    });
  const content = section(key, ...rows);

  content.hidden = !rows.length;
  content.classList.add("online");
  return content;
}

const title = (kind, item) => {
  if (item.type === "folder") {
    const folders = {
      users: "profileImage",
      images: "image",
      audio: "audio",
      files: "files",
      original: "original",
      cache: "cache"
    };
    const key = Object.hasOwn(folders, item.name) ? folders[item.name] : "";

    return key ? i18n.message(`admin.${key}`) : item.name;
  }

  if (item.text) return item.text;
  const key =
    item.type === "file"
      ? "files"
      : item.type === "audio"
        ? "audio"
        : kind === "upload" && item.file.startsWith("users/")
          ? "profileImage"
          : "image";

  return `${i18n.message(`admin.${key}`)}\n${item.name.slice(0, 8)}`;
};

function preview(kind, item) {
  return open(
    "admin.preview",
    async (signal) => {
      const response = await api(
        `${path}/files/${kind}/details?${new URLSearchParams({ file: item.file })}`
      );

      if (!response.ok) return fail();

      item = { ...item, ...response.data };

      const root = node("div", "profile admin");
      const media = node(
        item.type === "file" ? "a" : item.type === "image" ? "img" : "audio",
        "admin-preview"
      );

      if (item.type === "image") {
        media.alt = item.name;
        media.draggable = false;
      } else if (item.type === "audio") {
        media.controls = true;
        media.dataset.channel = kind === "tts" ? "tts" : "media";
        media.toggleAttribute("data-stt", ["tts", "stt"].includes(kind));
        media.dataset.name = item.name;
        media.dataset.size = String(item.size);
        media.preload = "none";
      }

      if (item.type === "file") {
        media.href = source(kind, item);
        media.download = item.name;
        media.textContent = item.name;
        dom.set(media, "data-icon", "download");
      } else media.src = source(kind, item);

      const error = node("p", "", "admin.error");

      error.hidden = true;
      dom.on(media, "error", () => {
        error.hidden = false;
      });

      const info = group(
        label("admin.filename", item.file),
        label("admin.size", format(item.size)),
        label("admin.time", item.time, { date: true }),
        label(
          "sound.model",
          item.voice === "default" ? i18n.message("sound.automatic") : item.voice
        ),
        label("admin.text", item.text)
      );

      root.append(media, error, info);

      const unbind =
        ["tts", "stt"].includes(kind) && item.type === "audio"
          ? caption.bind(media, item.text)
          : null;

      root.append(
        people(root, kind === "upload" ? "admin.uploader" : "admin.requester", item.users)
      );

      if (kind === "upload") root.append(people(root, "admin.related", item.related));

      const clear = () => {
        unbind?.();
        if (item.type === "audio") media.pause();

        media.removeAttribute("src");
        if (item.type === "audio") media.load();
      };

      if (signal.aborted) clear();
      else signal.addEventListener("abort", clear, { once: true });
      return root;
    },
    { route: ["target", `/admin/${kind}?${new URLSearchParams({ file: item.file })}`] }
  );
}

async function files(kind, folder = "") {
  const root = node("div", "profile admin");
  const rows = node("div");
  const controls = tools(load);

  let revision = 0;
  let request;
  let closed = false;

  if (folder) root.append(label("admin.folder", folder));

  root.append(rows);

  async function load() {
    const version = ++revision;

    request?.abort();
    request = new AbortController();
    controls.busy();

    const params = new URLSearchParams({ folder, ...controls.values });
    const response = await api(`${path}/files/${kind}?${params}`, { signal: request.signal });

    if (closed || version !== revision) return;

    if (!response.ok) return fail();

    rows.replaceChildren();

    const data = response.data;

    controls.update(data);
    if (!data.items.length) rows.append(node("p", "online-empty", "admin.empty"));
    else
      rows.append(
        grid(
          ...data.items.map((item) => {
            const row = entry(
              "",
              item.type === "image" ? "image" : item.type === "audio" ? "voice" : "storage",
              () => (item.type === "folder" ? files(kind, item.file) : preview(kind, item))
            );

            dom.query(".name", row).textContent = title(kind, item);
            if (item.type === "image") thumbnail(row, source(kind, item));
            return row;
          })
        )
      );

    mount(root);
  }
  try {
    return await open(`admin.${kind}`, root, {
      route: ["admin-section", `${kind}${folder ? `?${new URLSearchParams({ folder })}` : ""}`],
      ready: load,
      toolbar: controls.root
    });
  } finally {
    closed = true;
    controls.close();
    request?.abort();
  }
}

export async function editor(room = {}, refresh = () => {}) {
  const content = node("div", "profile admin admin-notify");
  const name = field("rooms.name", "text", true);
  const info = field("rooms.info", "textarea", true);

  let state = room.state || "active";

  const choices = [];

  name.input.maxLength = 80;
  name.input.required = true;
  info.input.maxLength = 1000;
  name.input.value = room.name || "";
  info.input.value = room.info || "";
  for (const value of ["active", "closed", "archived"]) {
    const root = node("div", "checkbox");
    const label = node("label");
    const input = node("input");

    input.type = "checkbox";
    input.name = "state";
    input.value = value;
    input.checked = state === value;
    label.append(node("span", "group-name", `rooms.${value}`), input);
    root.append(label);
    choices.push({ root, input });
    dom.on(input, "change", () => {
      state = value;
      choices.forEach((choice) => {
        choice.input.checked = choice.input.value === state;
      });
    });
  }
  const writing = group(name.root, info.root);

  writing.classList.add("admin-writing");
  content.append(writing, group(...choices.map((choice) => choice.root)));
  await dialog({
    title: room.id ? "rooms.title" : "rooms.create",
    content,
    actions: [
      { text: "dialog.cancel", icon: "close" },
      ...(room.id
        ? [
            {
              text: "rooms.delete",
              icon: "trash",
              run: async () => {
                const confirmed = await dialog({
                  title: "rooms.title",
                  content: "rooms.confirm",
                  actions: [
                    { text: "dialog.cancel", icon: "close" },
                    { text: "rooms.delete", icon: "trash", value: true, data: ["data-danger"] }
                  ]
                });

                if (!confirmed) return false;
                const result = await api(`${chatting}/public/${room.id}`, { method: "DELETE" });

                if (!result.ok) {
                  fail();
                  return false;
                }

                await refresh();
              }
            }
          ]
        : []),
      {
        text: "rooms.save",
        icon: "check",
        data: ["data-confirm"],
        run: async () => {
          if (!name.input.reportValidity()) return false;
          const result = await api(`${chatting}/public${room.id ? `/${room.id}` : ""}`, {
            method: room.id ? "PATCH" : "POST",
            data: { name: name.input.value, info: info.input.value, state }
          });

          if (!result.ok) {
            fail();
            return false;
          }

          await refresh();
        }
      }
    ]
  });
}

async function roomlist() {
  const root = node("div", "profile admin");

  let closed = false;

  async function load() {
    const result = await api(`${chatting}/public?manage=1`);

    if (closed) return;

    if (!result.ok) return fail();

    root.replaceChildren(
      group(
        ...result.data.items.map((room) => {
          const button = rooms.item(room, () => location.assign(`/rooms/${room.id}`));

          context(button, () => editor(room, load));
          return button;
        })
      )
    );

    mount(root);
  }

  try {
    return await open("rooms.manage", root, {
      route: ["admin-section", "rooms"],
      ready: load,
      toolbar: toolbar([
        { icon: "plus", text: "rooms.create", color: true, run: () => editor({}, load) },
        { icon: "reload", text: "admin.refresh", color: true, run: load }
      ])
    });
  } finally {
    closed = true;
  }
}

async function connection() {
  const root = node("div", "profile admin");
  const request = new AbortController();

  let busy = false;

  async function load(refresh = false) {
    if (busy) return;

    busy = true;
    try {
      const response = await api(`${path}/connection${refresh ? "?refresh=1" : ""}`, {
        signal: request.signal
      });

      if (request.signal.aborted) return;

      if (!response.ok) return fail();
      const data = response.data;
      const certificate = data.items.find((item) => item.name === "HTTPS");

      root.replaceChildren(
        group(
          ...data.items.map((item) => {
            const key = `admin.states.${item.state}`;
            const row = label(`admin.connections.${item.name}`, i18n.message(key));

            dom.set(dom.query(".label-value", row), "data-i18n", key);
            return row;
          })
        ),
        section(
          "admin.certificate",
          label("admin.host", certificate.host),
          label("admin.issuer", certificate.issuer),
          label("admin.issued", certificate.start, { date: true }),
          label("admin.expires", certificate.end, { date: true })
        ),
        group(label("admin.checked", data.time, { date: true }))
      );

      mount(root);
    } finally {
      busy = false;
    }
  }
  try {
    return await open("admin.connection", root, {
      ready: () => load(),
      toolbar: toolbar([
        { icon: "reload", text: "admin.refresh", color: true, run: () => load(true) }
      ])
    });
  } finally {
    request.abort();
  }
}

export default function admin(anchor) {
  return opening("admin", async () => {
    return drawer({
      title: "admin.panel",
      content: async () => {
        const response = await api(path);

        if (!response.ok) return fail();
        const content = node("div", "profile admin");

        content.classList.add("admin");
        content.append(
          section(
            "admin.operations",
            entry("admin.heading", "notify-ring", notify),
            entry("admin.users", "search", () => browse()),
            entry("rooms.manage", "chat", roomlist),
            response.data.database && entry("admin.connection", "link", connection)
          ),
          section(
            "report.inbox",
            entry("report.inbox", "flag", () => reports())
          )
        );

        if (response.data.database)
          content.append(
            section(
              "admin.data",
              entry("admin.database", "storage", () => database())
            ),
            section(
              "admin.files",
              entry("admin.upload", "image", () => files("upload")),
              entry("admin.tts", "voice", () => files("tts")),
              entry("admin.stt", "voice", () => files("stt"))
            )
          );

        return content;
      },
      anchor,
      side: "right",
      back: true,
      direction: "→",
      route: ["admin", ""]
    });
  });
}

navigation.register("admin", () => admin(), "drawer");

navigation.register(
  "admin-section",
  (value) => {
    const [section, query = ""] = value.split("?");
    const params = new URLSearchParams(query);

    if (section === "notification") return notify();

    if (section === "users") return browse();

    if (section === "connection") return connection();

    if (section === "rooms") return roomlist();

    if (section === "database") {
      const table = params.get("table");

      params.delete("table");
      return table
        ? browse(table, Object.fromEntries(params))
        : database(Object.fromEntries(params));
    }

    if (["upload", "tts", "stt"].includes(section))
      return files(section, params.get("folder") || "");
  },
  "drawer"
);
