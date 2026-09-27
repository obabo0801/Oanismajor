import retry from "#common/retry";
import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import api from "#common/api";
import drawer from "#common/drawer";
import mount from "#common/mount";
import events from "#common/events";
import * as tools from "#common/profile/history/tools";

i18n.preload("profile.historyEmpty", "profile.historyError");

const caption = (element, key) => {
  element.textContent = i18n.message(key);
  dom.set(element, "data-i18n", key);
};

export default async function history({
  url,
  title,
  route: state,
  types = {},
  kind = "action",
  cursorKey = "cursor",
  render,
  accept = () => true
}) {
  const root = dom.create("div");
  const list = dom.create("div");
  const status = dom.create("div");
  const edge = dom.create("div");

  root.className = "profile profile-records";
  list.className = "profile-section";
  edge.className = "history-edge";
  root.append(list, status, edge);

  let cursor;
  let busy = false;
  let active = true;
  let request;
  let observer;

  const source = events();
  const filters = tools.create(() => refresh(), types, kind);

  const retries = retry(load, () => active);

  async function load() {
    if (!active || busy || cursor === null) return;

    busy = true;
    observer?.unobserve(edge);
    status.hidden = false;
    status.className = "history-status";
    dom.remove(status, "data-i18n");
    status.replaceChildren();

    const controller = new AbortController();

    request = controller;

    const query = new URLSearchParams({
      limit: dom.has("wearable") ? "8" : dom.has("small") ? "12" : "24"
    });

    if (cursor) query.set(cursorKey, cursor);
    for (const [key, value] of Object.entries(filters.values)) if (value) query.set(key, value);
    const result = await api(`${url}?${query}`, { cache: "no-store", signal: controller.signal });

    if (!active || request !== controller) return;

    status.replaceChildren();
    busy = false;

    const page = result.data;

    if (
      !result.ok ||
      !Array.isArray(page?.items) ||
      !(page.next === null || typeof page.next === "string") ||
      (page.next !== null && page.next === cursor)
    ) {
      if ([403, 404].includes(result.status)) {
        list.replaceChildren();
        cursor = undefined;
        filters.count();
      }

      status.className = "history-status profile-error";
      caption(status, "profile.historyError");
      if (![400, 401, 403, 404].includes(result.status)) {
        status.replaceChildren();
        dom.remove(status, "data-i18n");
        retries.schedule();
      }

      return;
    }

    retries.reset();
    tools.append(list, page.items, render);
    if (cursor === undefined) filters.count(page.total);

    cursor = page.next;
    status.hidden = Boolean(list.childElementCount);
    caption(status, "profile.historyEmpty");
    mount(root);
    if (cursor !== null) observer?.observe(edge);
  }

  function refresh() {
    retries.reset();
    if (!active) return;

    request?.abort();
    request = null;
    busy = false;
    cursor = undefined;
    filters.count();
    list.replaceChildren();
    load();
  }

  const update = (event) => {
    try {
      if (accept(JSON.parse(event.data))) refresh();
    } catch {}
  };

  source?.addEventListener("role", refresh);
  source?.addEventListener("ready", refresh);
  source?.addEventListener("profile-update", update);

  source?.addEventListener("chatting-remove", refresh);
  source?.addEventListener("chatting-restore", refresh);

  try {
    await drawer({
      route: state,
      title,
      content: root,
      back: true,
      side: "right",
      direction: "→",
      ready: (element) => {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load();
          },
          { root: element, rootMargin: "0px 0px 128px 0px" }
        );

        load();
      },
      toolbar: filters.root
    });
  } finally {
    active = false;
    retries.reset();
    observer?.disconnect();
    request?.abort();

    source?.removeEventListener("role", refresh);
    source?.removeEventListener("ready", refresh);
    source?.removeEventListener("profile-update", update);

    source?.removeEventListener("chatting-remove", refresh);
    source?.removeEventListener("chatting-restore", refresh);

    list.replaceChildren();
  }
}
