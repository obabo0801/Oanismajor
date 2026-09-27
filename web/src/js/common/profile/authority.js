import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as profile from "#common/profile";
import * as toggle from "#common/toggle";
import label from "#common/profile/label";
import mount from "#common/mount";
import toolbar from "#common/toolbar";
import dialog from "#common/dialog";

const group = (...items) => {
  const root = dom.create("div");

  root.className = "group";
  root.append(...items.filter(Boolean));

  return root;
};

export default function authority(user) {
  const row = dom.create("div");
  const root = dom.create("div");
  const head = dom.create("div");
  const button = dom.create("button");
  const title = dom.create("span");
  const field = dom.create("div");
  const name = dom.create("label");
  const input = dom.create("input");
  const content = dom.create("fieldset");
  const status = dom.create("span");
  const info = group();
  const tools = toolbar([{ icon: "edit", text: "profile.memo", run: () => edit() }]);

  row.className = "group-item";
  root.className = "toggle";
  dom.set(root, "data-route", user.id);
  head.className = "toggle-head";
  button.className = "toggle-button";
  button.type = "button";
  dom.set(button, "data-icon", "setting");
  dom.set(button, "data-color", "");
  dom.set(button, "data-response", "");
  title.textContent = i18n.message("profile.authority");
  dom.set(title, "data-i18n", "profile.authority");
  field.className = "switch toggle-switch";
  input.type = "checkbox";
  input.checked = !user.blocked && user.authority.enabled;
  input.name = "authority";
  name.append(input);
  button.append(title);
  field.append(name);
  head.append(button, field);
  content.className = "toggle-content";
  status.className = "profile-error";
  status.hidden = true;
  status.textContent = i18n.message("profile.saveError");
  dom.set(status, "data-i18n", "profile.saveError");
  content.append(info, status, tools);
  root.append(head, content);
  row.append(root);

  let busy = false;

  const sync = () => {
    input.disabled = busy || !user.manage || Boolean(user.blocked) || !user.authority;

    button.disabled = input.disabled;
    tools.hidden = !user.manage || Boolean(user.blocked) || !user.authority?.enabled;

    dom.query("button", tools).disabled = busy || tools.hidden;
    toggle.sync(root);
  };

  const save = async (data) => {
    if (busy || !user.manage || user.blocked || !user.authority) return false;

    busy = true;
    sync();
    status.hidden = true;
    try {
      const result = await profile.authority(user.id, data);

      if (!result.ok) {
        status.hidden = false;

        return false;
      }

      const fresh = await profile.read(user.id, { fresh: true });

      if (!fresh.ok || !fresh.data.authority) {
        status.hidden = false;

        return false;
      }

      Object.assign(user, fresh.data);
      render();

      return true;
    } finally {
      busy = false;
      sync();
    }
  };

  async function edit() {
    if (busy || user.blocked || !user.authority?.enabled) return;

    const content = dom.create("div");
    const field = dom.create("div");
    const input = dom.create("input");
    const error = dom.create("p");

    field.className = "input";
    input.value = user.authority.memo || "";
    input.name = "memo";
    input.maxLength = 500;
    input.autocomplete = "off";
    input.enterKeyHint = "done";
    dom.set(input, "data-control", "");
    dom.set(input, "data-i18n-placeholder", "profile.memo");
    error.className = "profile-error";
    error.hidden = true;
    error.textContent = i18n.message("profile.saveError");
    dom.set(error, "data-i18n", "profile.saveError");
    field.append(input);
    content.append(field, error);

    await dialog({
      title: "profile.editMemo",
      content,
      direction: "→",
      ready: () => input.focus({ preventScroll: true }),
      actions: [
        { text: "profile.cancel", icon: "close", value: false, data: ["data-neutral"] },
        {
          text: "profile.confirm",
          icon: "check",
          submit: true,
          data: ["data-confirm"],
          disabled: () => busy,
          run: async () => {
            error.hidden = true;

            const saved = await save({ memo: input.value.trim() });

            error.hidden = saved;

            return saved;
          }
        }
      ]
    });
  }

  function render() {
    const authority = user.authority;

    if (!user.manage || !authority) {
      input.checked = false;
      input.disabled = true;
      button.disabled = true;
      info.replaceChildren();
      tools.hidden = true;
      dom.query("button", tools).disabled = true;
      toggle.sync(root);

      return;
    }

    const memo = label("profile.memo", authority.memo || i18n.message("profile.none") || "-");

    input.checked = !user.blocked && authority.enabled;

    const activity = authority.activity;
    const summary = activity
      ? (i18n.message("profile.counts") || "")
          .replace("{mute}", activity.mute)
          .replace("{kick}", activity.kick)
      : i18n.message("profile.none") || "-";

    info.replaceChildren(
      ...[
        memo,
        label("profile.granted", authority.time, { date: true }),
        label("profile.handler", authority.handler),
        label("profile.activity", summary)
      ].filter(Boolean)
    );

    mount(root);
    sync();
    i18n.translate();
  }

  render();

  let signature = JSON.stringify([user.manage, user.blocked, user.authority]);

  profile.bind(content, user.id, (value) => {
    user = { ...value };

    const next = JSON.stringify([user.manage, user.blocked, user.authority]);

    if (signature === next) return;

    signature = next;
    render();
  });

  dom.on(input, "input", async () => {
    const enabled = input.checked;

    if (!(await save({ enabled })))
      input.checked = !user.blocked && Boolean(user.authority?.enabled);

    sync();
  });

  return row;
}
