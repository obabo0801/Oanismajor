import * as dom from "#common/dom";
import * as css from "#common/css";
import * as profile from "#common/profile";
import view from "#common/profile/view";
import avatar from "#common/avatar";
import * as login from "#common/login";
import * as navigation from "#common/login/history";
import * as menu from "#common/menu";
import toast from "#common/toast";
import * as i18n from "#common/i18n";

import * as toolbar from "#common/toolbar";

export default function header(app) {
  const root = dom.create("header");
  const home = dom.create("a");
  const icon = dom.create("img");
  const account = avatar("", "button");
  const items = [
    { name: "setting", icon: "setting", text: "menu.title", run: (button) => menu.default(button) },
    { name: "account", element: account.root }
  ];
  const actions = toolbar.default(items, { compact: true });

  actions.className = "header-actions";
  dom.remove(actions, "data-blur");
  dom.remove(actions, "data-shadow");

  root.className = "header";
  home.href = "/";
  home.draggable = false;
  icon.src = "/favicon.ico";
  icon.alt = "";
  icon.draggable = false;

  const title = dom.create("span");

  title.textContent = i18n.message("app.title");
  dom.set(title, "data-i18n", "app.title");
  home.append(icon, title);
  dom.set(account.root, "data-circle", "");
  dom.set(account.root, "data-scale", "");
  dom.set(account.root, "data-response", "");
  profile.bind(root, "me", (user) => {
    account.set(user.verified ? user.avatar : "");
    dom.set(account.root, "data-icon", user.verified ? "user" : "login");
    dom.set(account.root, "data-tooltip", user.verified ? "profile.own" : "login.title");
  });

  dom.on(account.root, "click", () =>
    profile.value()?.verified
      ? view(account.root, dom.query(".chatting"), { own: true, context: "chatting" })
      : login.default(account.root)
  );

  root.append(home, actions);
  app.prepend(root);

  requestAnimationFrame(() => {
    if (!root.isConnected) return;

    const top = Math.max(0, actions.getBoundingClientRect().top + window.scrollY - 8);

    css.set(app, { "--header-offset": `${top}px` });
    if (
      window.scrollY === 0 &&
      !location.hash &&
      performance.getEntriesByType("navigation")[0]?.type !== "back_forward"
    ) {
      window.scrollTo({ top, behavior: "instant" });
    }
  });

  const url = new URL(location.href);
  const result = url.searchParams.get("login");
  const popup =
    url.searchParams.get("popup") === "1" &&
    ["success", "pending", "cancel", "error", "unavailable", "unsupported"].includes(result);

  const refresh = () => navigation.reset();

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("oanismajor-account");

    channel.onmessage = (event) => {
      if (event.data?.type === "login") {
        if (event.data.result === "success") refresh();
        else if (event.data.result === "pending") void login.pending();
        else if (["error", "unavailable", "unsupported"].includes(event.data.result))
          toast({ title: `login.${event.data.result}`, type: "error" });

        return;
      }

      if (typeof event.data === "string" && event.data !== profile.value()?.id) refresh();
    };

    channel.postMessage(popup ? { type: "login", result } : profile.value()?.id);

    dom.on(window, "pagehide", () => channel.close(), { once: true });
  }

  if (popup || ["pending", "error", "unavailable", "unsupported"].includes(result)) {
    url.searchParams.delete("login");
    if (popup) url.searchParams.delete("popup");

    history.replaceState(history.state, "", url);
    if (popup) window.close();

    if (["error", "unavailable", "unsupported"].includes(result))
      toast({ title: `login.${result}`, type: "error" });
  }
}
