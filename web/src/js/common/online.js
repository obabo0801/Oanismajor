import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as storage from "#common/storage";
import api from "#common/api";
import events from "#common/events";
import popover from "#common/popover";
import dialog from "#common/dialog";
import toolbar, { badge } from "#common/toolbar";
import avatar from "#common/avatar";
import * as names from "#common/profile/name";
import profile from "#common/profile/view";
import mount from "#common/mount";
import toast from "#common/toast";
import once from "#common/once";
import * as route from "#common/route";
import { events as path } from "#shared/route";

const opening = once();

route.register("online", (id) => (id === "" ? online() : false));

const size = 50;

i18n.preload(
  "online.open",
  "online.title",
  "online.admin",
  "online.user",
  "online.search",
  "online.refresh",
  "online.empty",
  "online.error",
  "profile.cancel",
  "profile.confirm",
  "image.reset",
  "search.placeholder"
);

export const arrange = (items, search = "", lang = "ko") => {
  const collator = new Intl.Collator(lang);
  const query = search.trim().toLocaleLowerCase(lang);
  const counts = new Map();
  const numbers = new Map();
  const rows = items
    .filter((item) => names.label(item).toLocaleLowerCase(lang).includes(query))
    .sort(
      (a, b) =>
        Number(a.group !== "admin") - Number(b.group !== "admin") ||
        Number(a.state !== "online") - Number(b.state !== "online") ||
        collator.compare(a.name, b.name) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.session.localeCompare(b.session)
    );

  for (const item of rows) counts.set(item.id, (counts.get(item.id) || 0) + 1);

  return rows.map((item) => {
    const number = (numbers.get(item.id) || 0) + 1;

    numbers.set(item.id, number);

    return { ...item, number: counts.get(item.id) > 1 ? number : null };
  });
};

const valid = (items) =>
  Array.isArray(items) &&
  new Set(items.map((item) => item?.session)).size === items.length &&
  items.every(
    (item) =>
      typeof item?.session === "string" &&
      Boolean(item.session) &&
      typeof item.id === "string" &&
      Boolean(item.id) &&
      typeof item.name === "string" &&
      (item.order === undefined || (Number.isSafeInteger(item.order) && item.order > 0)) &&
      (item.avatar === null || typeof item.avatar === "string") &&
      ["admin", "user"].includes(item.group) &&
      ["online", "away"].includes(item.state)
  );

export default function online(anchor) {
  return opening("online", async () => {
    const root = dom.create("div");
    const empty = dom.create("p");
    const edge = dom.create("div");

    const groups = new Map();
    const nodes = new Map();
    const source = events();
    const off = [];

    root.className = "online";
    empty.className = "online-empty";
    empty.hidden = true;
    empty.textContent = i18n.message("online.empty");
    dom.set(empty, "data-i18n", "online.empty");
    edge.className = "online-edge";

    for (const type of ["admin", "user"]) {
      const section = dom.create("section");
      const title = dom.create("h3");
      const group = dom.create("div");

      section.className = "group-section";
      title.className = "group-title";
      group.className = "group";
      section.hidden = true;
      section.append(title, group);
      root.append(section);
      groups.set(type, { section, title, group });
    }

    root.append(empty, edge);

    let layer;
    let heading;
    let observer;
    let request;
    let pending;
    let active = true;
    let revision = 0;
    let again = false;
    let busy = false;
    let expanding = false;

    let items = [];
    let visible = [];
    let limit = size;
    let search = "";

    const tools = toolbar([
      { icon: "search", text: "online.search", run: () => filter() },
      { icon: "rotate", text: "online.refresh", run: () => sync() }
    ]);
    const refresh = tools.children[1];

    function remember() {
      const top = layer.getBoundingClientRect().top;

      return dom
        .all(".group-item", root)
        .filter((row) => row.getBoundingClientRect().bottom > top)
        .map((node) => ({ node, top: node.getBoundingClientRect().top }));
    }

    function render() {
      const positions = remember();
      const wanted = visible.slice(0, limit);
      const sessions = new Set(wanted.map((item) => item.session));

      for (const [key, row] of nodes) {
        if (sessions.has(key)) continue;

        row.element.remove();
        nodes.delete(key);
      }

      for (const [type, section] of groups) {
        const count = visible.filter((item) => item.group === type).length;
        const rows = wanted.filter((item) => item.group === type);

        section.section.hidden = !rows.length;
        section.title.textContent = `${i18n.message(`online.${type}`)} ─ ${count}`;
        rows.forEach((item, index) => {
          let row = nodes.get(item.session);

          if (!row) {
            const element = dom.create("div");
            const button = dom.create("button");
            const picture = dom.create("span");
            const media = avatar();
            const status = dom.create("span");
            const name = dom.create("span");

            element.className = "group-item";
            button.type = "button";
            dom.set(button, "data-response", "");
            picture.className = "avatar-wrap";
            status.className = "profile-status";
            name.className = "online-name";
            picture.append(media.root, status);
            button.append(picture, name);
            element.append(button);
            row = { element, media, status, name, item };
            dom.on(button, "click", () => {
              const id = row.item.id;
              const session = row.item.session;
              const target = anchor?.closest(".chatting") || root;

              profile(button, target, {
                id,
                session,
                online: root,
                get number() {
                  return visible.find((item) => item.session === session)?.number;
                },
                get state() {
                  const item = items.find((item) => item.session === session);

                  return item?.state || "offline";
                },
                context: "chatting",
                hidden: storage.get(`chatting-hide:${id}`) === "true"
              }).catch(() => {});
            });

            nodes.set(item.session, row);
          }

          if (row.item.avatar !== item.avatar || !row.element.isConnected)
            row.media.set(item.avatar);

          row.item = item;
          row.name.textContent = item.number
            ? `${names.label(item)} (${item.number})`
            : names.label(item);

          names.mark(row.name, item.verified);
          dom.set(row.status, "data-state", item.state);
          if (section.group.children[index] !== row.element)
            section.group.insertBefore(row.element, section.group.children[index] || null);
        });
      }

      heading.textContent = i18n.message("online.title").replace("{count}", items.length);

      badge(tools.children[0], search ? visible.length : undefined);
      empty.hidden = busy || Boolean(visible.length);
      edge.hidden = !busy && !expanding && limit >= visible.length;
      mount(root);

      const position = positions.find(({ node }) => node.isConnected);

      if (position?.node.isConnected)
        layer.scrollTop += position.node.getBoundingClientRect().top - position.top;

      root.dispatchEvent(new Event("online-update"));
    }

    async function more() {
      if (!active || busy || expanding || limit >= visible.length) return;

      expanding = true;
      observer.unobserve(edge);

      const current = visible;

      try {
        if (!active || busy || current !== visible) return;

        limit += size;
        render();
      } finally {
        expanding = false;
        if (active && !busy) {
          edge.hidden = limit >= visible.length;
          if (!edge.hidden) observer.observe(edge);
        }
      }
    }

    function sync() {
      again = true;
      revision++;
      if (pending) return pending;

      pending = (async () => {
        busy = true;
        refresh.disabled = true;
        observer.unobserve(edge);
        edge.hidden = false;

        try {
          while (again && active) {
            again = false;

            const version = revision;

            request = new AbortController();

            const result = await api(`${path}/list`, { cache: "no-store", signal: request.signal });

            if (!active) return;

            if (version !== revision) continue;

            if (!result.ok || !valid(result.data?.items)) {
              toast({ text: "online.error", type: "error" });
              continue;
            }

            items = result.data.items;
            visible = arrange(items, search, dom.root.lang || "ko");
            render();
          }
        } finally {
          busy = false;
          pending = null;
          if (active) {
            refresh.disabled = false;
            empty.hidden = Boolean(visible.length);
            edge.hidden = !expanding && limit >= visible.length;
            if (!edge.hidden) observer.observe(edge);

            if (again) sync();
          }
        }
      })();

      return pending;
    }

    async function filter() {
      if (search) search = "";
      else {
        const field = dom.create("div");
        const input = dom.create("input");

        field.className = "input";
        input.type = "search";
        input.value = search;
        input.maxLength = 100;
        input.enterKeyHint = "search";
        dom.set(input, "data-control", "");
        dom.set(input, "data-i18n-placeholder", "search.placeholder");
        field.append(input);

        const result = await dialog({
          title: "online.search",
          content: field,
          direction: "→",
          actions: [
            { text: "profile.cancel", icon: "close", value: false },
            { text: "image.reset", icon: "reload", value: "reset" },
            {
              text: "profile.confirm",
              icon: "check",
              value: true,
              submit: true,
              data: ["data-confirm"]
            }
          ]
        });

        if (!active || (result !== true && result !== "reset")) return;

        search = result === "reset" ? "" : input.value.trim();
      }

      if (search) dom.set(tools.children[0], "data-selected", "");
      else dom.remove(tools.children[0], "data-selected");

      limit = size;
      visible = arrange(items, search, dom.root.lang || "ko");
      render();
      layer.scrollTop = 0;
      observer.unobserve(edge);
      if (!edge.hidden) observer.observe(edge);
    }

    try {
      await popover({
        route: ["online", ""],
        anchor,
        title: "online.open",
        content: root,
        direction: "→",
        toolbar: tools,
        back: true,
        ready: (element) => {
          layer = element;
          heading = dom.query(".layer-title", layer);
          dom.remove(heading, "data-i18n");
          observer = new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) more();
            },
            { root: layer, rootMargin: "0px 0px 128px 0px" }
          );

          render();
          for (const type of ["online", "ready"]) off.push(dom.on(source, type, sync));
          sync();
        }
      });
    } finally {
      active = false;
      request?.abort();
      observer?.disconnect();

      off.forEach((remove) => remove());
    }
  });
}
