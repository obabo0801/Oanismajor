import retry from "#common/retry";
import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as storage from "#common/storage";
import api from "#common/api";
import upload from "#common/upload";
import events, * as access from "#common/events";
import * as chat from "#common/chatting";
import toast from "#common/toast";
import sound from "#common/sound";
import { chatting as path } from "#shared/route";
import * as rules from "#shared/chatting";
import * as media from "#shared/attach";
import * as attachments from "#common/chatting/attach";
import * as recent from "#common/chatting/recent";
import viewport from "#common/chatting/viewport";
import * as clock from "#common/chatting/time";
import * as direct from "#common/chatting/direct";
import * as profile from "#common/profile";
import * as names from "#common/profile/name";
import * as context from "#common/chatting/current";

i18n.preload(
  "chatting.unavailable",
  "chatting.sendFailed",
  "chatting.tooLong",
  "chatting.rate",
  "chatting.muted",
  "chatting.entered",
  "chatting.hidden",
  "chatting.shown",
  "chatting.muteNotice",
  "chatting.kickNotice",
  "chatting.unkickNotice",
  "chatting.unblockNotice",
  "chatting.countdown",
  "chatting.remaining",
  "chatting.muteDetail",
  "chatting.reason",
  "chatting.handler",
  "image.sizeError",
  "image.uploadError",
  "chatting.audio.error",
  "chatting.audio.size"
);

const valid = (item) =>
  rules.validId(item?.url) &&
  Number.isSafeInteger(item.seq) &&
  item.seq > 0 &&
  typeof item.id === "string" &&
  typeof item.text === "string" &&
  typeof item.time === "string" &&
  typeof item.own === "boolean" &&
  (item.attachments === undefined || media.valid(item.attachments)) &&
  [item.image, item.preview, item.audio].every(
    (value) => value === undefined || (typeof value === "string" && /^\/(?!\/)/.test(value))
  ) &&
  (item.system === undefined || Object.hasOwn(rules.notices, item.system));

const request = async (query = {}, id, recent = false) => {
  const url = id
    ? `${path}/${encodeURIComponent(id)}`
    : `${path}${recent ? "/recent" : ""}?${new URLSearchParams(query)}`;

  const response = await api(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const page = response.data;

  if (
    !response.ok ||
    !Array.isArray(page?.messages) ||
    !Number.isSafeInteger(page.cursor) ||
    page.messages.some((item) => !valid(item))
  ) {
    throw Object.assign(new Error("Chatting query failed"), { status: response.status });
  }

  return page;
};

export default function history(root, messageId = "", room = {}) {
  const list = dom.query(".chatting-list", root);
  const form = dom.query(".chatting-form", root);
  const input = dom.query(".chatting-input", root);
  const send = dom.query(".chatting-send", root);
  const voice = dom.query(".chatting-voice", root);
  const limit = dom.create("div");
  const remaining = dom.create("strong");
  const countdown = dom.create("span");
  const detail = dom.create("p");
  const reason = dom.create("p");
  const source = events();
  const attached = attachments.default(input);
  const rows = new Map();
  const tail = new Map();
  const previous = dom.create("div");
  const next = dom.create("div");

  const off = [];
  const notices = [];
  const deferred = new Map();

  let confirmation;

  let generation = 0;
  let ready = false;
  let cursor = 0;
  let catching = false;
  let again = false;
  let loading = false;
  let sending = false;
  let transfer;
  let after = false;
  let before = false;
  let destroyed = false;
  let halted = false;
  let joined = false;
  let highlight;
  let staff = access.isAdmin();
  let muteTimer;
  let muted = 0;
  let restriction = {};
  let forward = false;
  let failed;
  let scrollFrame;

  previous.className = next.className = "chatting-page";

  limit.className = "chatting-limit";
  limit.hidden = true;
  limit.append(remaining, detail, reason);
  form.prepend(limit);

  const format = (key, values) =>
    i18n.message(key).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));

  const tick = () => {
    if (destroyed || halted) return;
    const seconds = Math.max(0, Math.ceil((muted - Date.now()) / 1000));

    input.disabled = seconds > 0 || room.state !== "active";

    if (voice) voice.disabled = input.disabled;

    if (!sending) send.disabled = input.disabled;

    limit.hidden = !seconds;
    countdown.textContent = format("chatting.countdown", {
      seconds: String(seconds).padStart(2, "0")
    });

    const [prefix = "", suffix = ""] = i18n.message("chatting.remaining").split("{time}");

    remaining.replaceChildren(prefix, countdown, suffix);
    detail.hidden = !restriction.seconds;
    detail.textContent = format("chatting.muteDetail", {
      handler: restriction.handler || i18n.message("chatting.handler"),
      seconds: restriction.seconds
    });

    reason.hidden = !restriction.reason;
    reason.textContent = format("chatting.reason", restriction);
    if (seconds) muteTimer = setTimeout(tick, 1000);
  };

  const mute = (value) => {
    if (value === undefined || halted || destroyed) return;
    const next = typeof value === "object" && value ? value : { until: value };
    const stamp = next.until ? Date.parse(`${next.until.replace(" ", "T")}+09:00`) : 0;

    if (Number.isFinite(stamp) && stamp >= muted) {
      muted = stamp;
      restriction = { ...restriction, ...next };
    }

    clearTimeout(muteTimer);
    tick();
  };

  list.append(previous, next);
  input.maxLength = rules.length;

  const retries = retry(
    () => page(failed === next),
    () => !destroyed && !halted && Boolean(failed)
  );

  const recovery = retry(
    () => recover(),
    () => ready && !destroyed && !halted
  );
  const notice = (key) => toast({ text: key, type: "error" });
  const controls = () => {
    const position = anchor();

    previous.hidden = ready && !before && !(loading && !forward);
    next.hidden = !after && !(loading && forward);

    if (failed) {
      failed.hidden = false;

      if (!halted) retries.schedule();
    }

    if (position?.node.isConnected)
      list.scrollTop += position.node.getBoundingClientRect().top - position.top;

    dom.set(root, "data-history", String(Boolean(after || (messageId && !ready))));

    list.dispatchEvent(new Event("scroll"));
  };

  function anchor() {
    const top = list.getBoundingClientRect().top;
    const item = [...rows.values()].find(
      (row) => !row.node.hidden && row.node.getBoundingClientRect().bottom > top
    );

    return item ? { node: item.node, top: item.node.getBoundingClientRect().top } : null;
  }

  const insert = (messages, follow = false, reveal = false) => {
    const added = messages
      .filter((item) => {
        if (rows.has(item.url)) return false;

        if (sending && item.own && confirmation?.id !== item.url) {
          deferred.set(item.url, item);
          return false;
        }
        return true;
      })
      .sort((a, b) => a.seq - b.seq);

    if (!added.length) {
      if (follow) list.scrollTop = list.scrollHeight;

      return controls();
    }

    const position = anchor();
    const existing = [...rows.values()];

    for (const item of added) {
      if (rows.has(item.url)) continue;

      item.hidden = false;
      if (!item.system && storage.get(`chatting-hide:${item.id}`) === "true") {
        const key = `chatting-hide-since:${item.id}`;
        const since = Number(storage.get(key)) || Date.now();

        storage.set(key, since);
        item.hidden = clock.stamp(item.time) >= since;
      }

      const node =
        confirmation?.id === item.url
          ? confirmation.pending.accept(item)
          : chat.append(list, item, false);

      if (!node) continue;

      if (reveal && confirmation?.id !== item.url) dom.set(node, "data-reveal", "");

      node.hidden = item.hidden;

      const later = existing.find((row) => row.item.seq > item.seq);

      list.insertBefore(node, later?.node || dom.query(":scope > [data-pending]", list) || next);
      rows.set(item.url, { node, item });
    }

    if (existing.length && added[0].seq < existing.at(-1).item.seq) {
      const sorted = [...rows.entries()].sort((a, b) => a[1].item.seq - b[1].item.seq);

      rows.clear();
      sorted.forEach(([key, value]) => rows.set(key, value));
    }

    chat.regroup(list);
    controls();
    if (follow) list.scrollTop = list.scrollHeight;
    else if (position?.node.isConnected)
      list.scrollTop += position.node.getBoundingClientRect().top - position.top;

    list.dispatchEvent(new Event("scroll"));
  };

  const focus = async (id, version) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (destroyed || version !== generation) return;
    const node = rows.get(id)?.node;

    if (!node || node.hidden) {
      notice("chatting.unavailable");

      return;
    }

    list.scrollTop +=
      node.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 3;

    dom.set(node, "data-highlight", "");
    clearTimeout(highlight);
    highlight = setTimeout(() => dom.remove(node, "data-highlight"), 2000);
  };

  async function recover() {
    again = true;
    if (catching || destroyed || halted || document.hidden || navigator.onLine === false) return;

    if (!ready) {
      if (!loading) return load(messageId);
      return;
    }

    catching = true;

    const version = generation;

    try {
      while (again && version === generation && !destroyed && !halted) {
        again = false;

        let more;

        do {
          const page = await request({ after: cursor }, undefined, !access.isAdmin() && !messageId);

          if (version !== generation || destroyed || halted) return;

          mute(page.restriction || page.muted);
          if (page.more && page.cursor <= cursor) throw new Error("Invalid cursor");

          if (after) page.messages.forEach((item) => tail.set(item.url, item));
          else insert(page.messages, !messageId && chat.bottom(list));

          cursor = page.cursor;
          more = page.more;
        } while (more);
      }
      recovery.reset();
    } catch (error) {
      if (version === generation && !destroyed && !halted) {
        again = false;
        if ([401, 403].includes(error.status)) access.resume();

        recovery.schedule();
      }
    } finally {
      catching = false;
      if ((again || version !== generation) && ready && !destroyed && !halted) recover();
    }
  }

  const receive = (item, follow = false) => {
    if (destroyed || halted) return;

    if (item?.room !== context.room) return;

    if (sending && !follow && item?.own) {
      deferred.set(item.url, item);
      return;
    }

    if (follow && valid(item)) {
      if (ready) insert([item], true);
      else notices.push(item);
    }

    if (!valid(item) || !ready || catching) return recover();

    if (item.seq <= cursor) return;

    if (item.seq > cursor + 1) return recover();

    if (!access.isAdmin() && (item.blocked || access.isBlocked(item.id))) return recover();

    if (after) tail.set(item.url, item);
    else if (!follow) insert([item], !messageId && chat.bottom(list));

    cursor = item.seq;
  };

  async function load(id = "") {
    if (destroyed || halted) return;
    const version = ++generation;

    recovery.reset();
    ready = false;
    loading = true;
    forward = false;
    failed = null;
    controls();
    try {
      if (id && !rules.validId(id)) throw new Error("Invalid ID");
      const page = await request({ live: "1" }, id, !access.isAdmin());

      if (version !== generation || destroyed) return;

      mute(page.restriction || page.muted);
      staff = access.isAdmin();
      list.replaceChildren(previous, next, ...dom.all(":scope > [data-pending]", list));
      rows.clear();
      tail.clear();
      retries.reset();
      cursor = page.cursor;
      before = id ? page.before : Boolean(page.history && page.more);
      after = id ? page.after : false;
      ready = true;
      insert(page.messages, !id, true);
      if (!joined) {
        joined = true;
        chat.system(list, { text: "chatting.entered" });
      }

      if (id) await focus(id, version);

      if (version !== generation || destroyed || halted) return;

      if (notices.length) insert(notices.splice(0), true);
    } catch (error) {
      if (version !== generation || destroyed) return;

      if (id && [400, 403, 404].includes(error.status)) notice("chatting.unavailable");
      else {
        if ([401, 403].includes(error.status)) access.resume();

        failed = previous;
      }
    } finally {
      if (version === generation) {
        loading = false;
        controls();
        if (ready) recover();
      }
    }
  }

  async function page(direction) {
    if (loading || halted || destroyed) return;

    if (!ready) return load(messageId);
    const items = [...rows.values()];
    const edge = direction ? items.at(-1) : items[0];
    const version = generation;

    if (!edge) return;

    loading = true;
    forward = direction;
    failed = null;
    controls();
    try {
      const result = await request({ [forward ? "after" : "before"]: edge.item.seq });

      if (version !== generation || destroyed) return;

      if (
        result.more &&
        !result.messages.some((item) =>
          forward ? item.seq > edge.item.seq : item.seq < edge.item.seq
        )
      )
        throw new Error("Invalid page cursor");

      retries.reset();
      mute(result.restriction || result.muted);
      if (forward) after = result.more;
      else before = result.more;

      insert(result.messages, false, true);
      if (!after) {
        insert([...tail.values()]);
        tail.clear();
      }
    } catch (error) {
      if (version === generation && !halted && !destroyed) {
        failed = forward ? next : previous;
      }
    } finally {
      if (version === generation) {
        loading = false;
        controls();
      }
    }
  }

  const nearby = () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!ready || loading || halted || destroyed || failed) return;
      const rect = list.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);

      if (bottom <= top) return;

      if (
        before &&
        previous.getBoundingClientRect().bottom >= top - 128 &&
        previous.getBoundingClientRect().top <= bottom
      )
        page(false);
      else if (
        after &&
        next.getBoundingClientRect().top <= bottom + 128 &&
        next.getBoundingClientRect().bottom >= top
      )
        page(true);
    });
  };

  const dispatch = async (file = null, draft = null) => {
    const audio = file?.type.startsWith("audio/");
    const token = draft?.token || crypto.randomUUID();
    const batch = draft?.batch || (file ? [] : attached.snapshot());
    const value = draft?.text ?? input.value;
    const recipient = draft ? draft.recipient : dom.get(form, "data-whisper");
    const used = draft?.used || (file ? [] : recent.snapshot(input, value, batch));
    const version = generation;

    if (
      sending ||
      input.disabled ||
      input.readOnly ||
      halted ||
      destroyed ||
      (!file && !value.trim() && !batch.length)
    )
      return false;

    if (!file && value.length > rules.length) {
      notice("chatting.tooLong");

      return false;
    }

    if (recipient && (file || batch.length)) {
      notice("direct.textOnly");

      return false;
    }

    sending = true;
    await Promise.resolve();

    let succeeded = false;

    if (!file && !draft) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (!draft?.queued || file) attached.busy(true);

    transfer = draft?.controller || new AbortController();

    const signal = batch.some((item) => item.type === "file")
      ? transfer.signal
      : AbortSignal.any([transfer.signal, AbortSignal.timeout(60_000)]);

    const state = (value, cancel = false) => {
      if (draft?.queued && !file) return;

      dom.set(form, "data-send", value);
      form.toggleAttribute("data-cancel", cancel);
      form.dispatchEvent(new Event("chatting-state"));
    };

    const pending = draft
      ? draft.pending
      : attachments.pending(root, batch, value, () => transfer?.abort());

    state(pending ? "uploading" : "sending");

    try {
      if (recipient) {
        const result = await api(`${path}/direct/whisper/${recipient}`, {
          method: "POST",
          signal,
          data: { text: value }
        });

        if (!result.ok) {
          notice(
            result.status === 409
              ? result.data?.code === "offline"
                ? "direct.offline"
                : "direct.refused"
              : result.status === 423
                ? "direct.muted"
                : "direct.error"
          );

          return false;
        }

        succeeded = true;
        recent.commit(used);
        state("success");
        direct.receive(result.data);
        void sound.play("send");

        return true;
      }

      const prepared = await attachments.prepare(batch, attached, signal, pending?.change);

      if (!prepared.ok) {
        if (!signal.aborted)
          notice(prepared.status === 413 ? "image.sizeError" : "image.uploadError");

        return false;
      }

      if (destroyed || halted) return false;
      const items = prepared.items;

      if (signal.aborted) return false;

      pending?.commit();
      state(pending ? "uploading" : "sending");

      const result = file
        ? await upload(`${path}/${audio ? "audio" : "image"}`, file, { cache: "no-store", signal })
        : await api(path, {
            method: "POST",
            cache: "no-store",
            signal: transfer.signal,
            data: { token, text: value, attachments: items }
          });

      if (destroyed || halted) {
        succeeded = result.ok && valid(result.data);
        if (succeeded) recent.commit(used);

        return succeeded;
      }

      if (!result.ok || !valid(result.data)) {
        if (result.status === 400)
          batch.forEach((item) => {
            item.receipt = null;
            attached.receipt(item, null);
          });

        if (result.status === 423) mute(result.data?.restriction || result.data?.until);
        let key = audio ? "chatting.audio.error" : "image.uploadError";

        if (!file) key = "chatting.sendFailed";

        if (result.status === 413) key = audio ? "chatting.audio.size" : "image.sizeError";

        if (result.status === 429) key = "chatting.rate";

        if (result.status === 423) key = "chatting.muted";

        notice(key);

        return false;
      }

      succeeded = true;
      recent.commit(used);
      state("success");
      void sound.play("send");

      if (destroyed || halted) return true;

      attached.clear(batch);
      if (version === generation) {
        if (after || messageId || !ready) {
          messageId = "";
          await load();
        }

        if (pending) confirmation = { id: result.data.url, pending };

        await receive(result.data, true);
        confirmation = undefined;
        pending?.complete(rows.get(result.data.url)?.node);
      }

      return true;
    } finally {
      if (succeeded || transfer.signal.aborted) pending?.remove();

      confirmation = undefined;
      sending = false;
      if (!destroyed && !halted) insert([...deferred.values()], chat.bottom(list));

      deferred.clear();
      transfer = undefined;
      attached.busy(false);
      send.disabled = halted || Boolean(input.disabled);
      state("idle");
    }
  };

  const transmit = attachments.queue(
    root,
    input,
    () => attached,
    dispatch,
    ({ file, batch, text, recipient }) => {
      if (halted || destroyed) return false;

      if (!file && text.length > rules.length) {
        notice("chatting.tooLong");
        return false;
      }

      if (recipient && (file || batch.length)) {
        notice("direct.textOnly");
        return false;
      }
      return true;
    }
  );

  const submit = (event) => {
    event.preventDefault();
    transmit();
  };

  const openLatest = () => {
    if (after || messageId || !ready) {
      messageId = "";
      load();
    }
  };

  off.push(dom.on(form, "submit", submit));
  off.push(viewport(root));
  off.push(
    dom.on(form, "chatting-cancel", () => {
      if (form.hasAttribute("data-cancel")) transfer?.abort();
    })
  );

  off.push(dom.on(list, "scroll", nearby, { passive: true }));
  off.push(dom.on(window, "scroll", nearby, { passive: true, capture: true }));
  off.push(dom.on(window, "resize", nearby, { passive: true }));
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(nearby);

    observer.observe(list);
    off.push(() => observer.disconnect());
  }

  off.push(
    dom.on(source, "mute", (event) => {
      if (halted || destroyed) return;
      try {
        const data = JSON.parse(event.data);

        mute(data);
        receive(data.message, true);
      } catch {}
    })
  );

  off.push(
    dom.on(window, "chatting-stop", () => {
      halted = true;
      recovery.reset();
      transmit.cancel();
      transfer?.abort();
      ready = false;
      generation++;
      clearTimeout(muteTimer);
      clearTimeout(highlight);
      input.disabled = send.disabled = true;
      cancelAnimationFrame(scrollFrame);

      if (voice) voice.disabled = true;

      off.forEach((remove) => remove());
    })
  );

  off.push(dom.on(root, "chatting-latest", openLatest));
  off.push(
    dom.on(source, "chatting-restore", (event) => {
      let item;

      try {
        item = JSON.parse(event.data);
      } catch {
        return;
      }

      if (destroyed || halted || !valid(item) || item.room !== context.room) return;
      const existing = rows.get(item.url);

      if (existing?.node.isConnected) {
        Object.assign(existing.item, item, { deleted: false, restorable: false });

        return;
      }

      rows.delete(item.url);
      for (const [key, row] of rows) {
        if (!row.node.isConnected) rows.delete(key);
      }

      if (ready) insert([item], false);
      else notices.push(item);
    })
  );

  off.push(
    dom.on(root, "chatting-hide", (event) => {
      const { id, hidden: hide } = event.detail;

      const changed = (storage.get(`chatting-hide:${id}`) === "true") !== hide;

      storage.set(`chatting-hide:${id}`, hide);
      if (changed)
        chat.system(list, {
          text: hide ? "chatting.hidden" : "chatting.shown",
          params: { name: names.label(profile.value(id) || event.detail) },
          time: new Date().toISOString()
        });

      if (hide) {
        storage.set(`chatting-hide-since:${id}`, Date.now());

        return;
      }

      rows.forEach((row) => {
        if (row.item.id === id) {
          row.item.hidden = hide;
          row.node.hidden = hide;
        }
      });

      chat.regroup(list);
    })
  );

  off.push(
    dom.on(source, "chatting", (event) => {
      let item;

      try {
        item = JSON.parse(event.data);
      } catch {
        return recover();
      }

      receive(item);
    })
  );

  off.push(
    dom.on(source, "ready", () => {
      if (staff === access.isAdmin()) return recover();

      staff = access.isAdmin();
      rows.clear();
      list.replaceChildren(previous, next, ...dom.all(":scope > [data-pending]", list));
      load(messageId);
    })
  );

  off.push(
    dom.on(source, "role", () => {
      staff = access.isAdmin();
      rows.clear();
      list.replaceChildren(previous, next, ...dom.all(":scope > [data-pending]", list));
      load(messageId);
    })
  );

  for (const type of ["chatting-block", "chatting-unblock"])
    off.push(
      dom.on(source, type, (event) => {
        try {
          const { id } = JSON.parse(event.data);

          if (!access.isAdmin() && type === "chatting-block") {
            rows.forEach((row, url) => {
              if (row.item.id !== id) return;

              row.node.remove();
              rows.delete(url);
            });

            chat.regroup(list);
          }

          recover();
        } catch {}
      })
    );
  off.push(dom.on(source, "sync", recover));
  off.push(dom.on(window, "online", recover));
  off.push(
    dom.on(document, "visibilitychange", () => {
      if (!document.hidden) recover();
    })
  );

  const initial = load(messageId);

  return {
    initial,
    recover,
    image: attached.add,
    attach: attached.add,
    audio: (file) => transmit(file),
    destroy: () => {
      destroyed = true;
      transmit.cancel();
      transfer?.abort();
      attached.destroy();
      generation++;
      clearTimeout(highlight);
      clearTimeout(muteTimer);
      cancelAnimationFrame(scrollFrame);
      retries.reset();
      recovery.reset();

      input.disabled = halted;
      send.disabled = halted;
      if (voice) voice.disabled = halted;

      limit.remove();
      off.forEach((remove) => remove());
      previous.remove();
      next.remove();
    }
  };
}
