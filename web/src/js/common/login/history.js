import * as dom from "#common/dom";
import * as storage from "#common/storage";
import * as routes from "#shared/route";
import api from "#common/api";
import "../../../css/common/login/history.css";

const key = "navigation";

let current;
let installed = false;
let leaving = false;
let request;
let checked = 0;

const identity = (user) => `${user.id}:${Boolean(user.verified)}`;
const read = () => {
  try {
    const value = JSON.parse(storage.get(key, "null", "session"));

    return typeof value?.epoch === "string" && typeof value.identity === "string" ? value : null;
  } catch {
    return null;
  }
};
const save = (value) => storage.set(key, JSON.stringify(value), "session");
const hide = () => dom.set(dom.root, "data-checking", "");
const show = () => dom.remove(dom.root, "data-checking");

export const blocked = () => leaving;
export const check = () => {
  if (leaving) return false;

  if (!current) return true;
  const latest = read();
  const saved = history.state?.account;

  return (
    (!latest || latest.epoch === current.epoch) &&
    saved?.epoch === current.epoch &&
    saved.identity === current.identity
  );
};

export const reset = (destination = "/") => {
  if (leaving) return;

  leaving = true;
  hide();

  const next = { identity: "", epoch: crypto.randomUUID() };

  save(next);
  history.replaceState({ account: next }, "", "/");
  window.dispatchEvent(new Event("chatting-stop"));
  location.replace(destination);
};

const verify = async (restore = false) => {
  if (!current || leaving) return;

  if (restore) hide();

  if (!check()) return reset();

  if (!restore && Date.now() - checked < 2000) return;

  checked = Date.now();
  request ||= api(`${routes.profile}/me`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000)
  }).finally(() => {
    request = undefined;
  });

  const result = await request;

  if (leaving) return;

  if (!check() || (result.ok && (!result.data?.id || identity(result.data) !== current.identity)))
    return reset();

  if (!result.ok && restore) return reset();

  if (restore) show();
};

export const start = (user) => {
  if (!user?.id) return false;
  const name = identity(user);
  const stored = read();
  const saved = history.state?.account;
  const url = new URL(location.href);
  const popup = url.searchParams.get("popup") === "1";
  const returned = performance.getEntriesByType("navigation")[0]?.type === "back_forward";
  const changed = stored?.identity && stored.identity !== name;
  const stale =
    saved &&
    ((saved.identity && saved.identity !== name) || (stored && saved.epoch !== stored.epoch));

  if (
    !popup &&
    (changed || stale || (returned && !saved) || (url.pathname === "/login" && user.verified))
  ) {
    reset();
    return false;
  }

  current = { identity: name, epoch: stored?.epoch || crypto.randomUUID() };
  save(current);
  history.replaceState({ ...history.state, account: current }, "");
  show();

  if (!installed) {
    installed = true;
    dom.on(window, "pagehide", hide);
    dom.on(
      window,
      "pageshow",
      (event) => {
        if (event.persisted) void verify(true).catch(() => reset());
      },
      true
    );

    dom.on(window, "focus", () => {
      void verify().catch(() => {});
    });

    dom.on(document, "visibilitychange", () => {
      if (!document.hidden) void verify().catch(() => {});
    });
  }

  return true;
};
