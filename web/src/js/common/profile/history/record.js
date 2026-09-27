import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as link from "#common/link";
import label from "#common/profile/label";
import media from "#common/chatting/media";
import view from "#common/image/view";
import avatar from "#common/avatar";
import * as clock from "#common/chatting/time";
import * as profile from "#common/profile";
import { actions } from "#shared/history";
import { reasons } from "#shared/report";

i18n.preload(
  ...Object.values(actions),
  ...reasons.map((key) => `report.${key}`),
  "profile.chatHistory",
  "profile.blockHistory",
  "profile.reportHistory",
  "profile.historyReason",
  "profile.handler",
  "profile.until",
  "profile.around",
  "profile.anonymous",
  "report.inbox",
  "report.user",
  "report.message",
  "report.reason",
  "report.description",
  "report.target",
  "report.reporter",
  "history.handling",
  "chatting.audio.message"
);

const text = (tag, key, className = "") => {
  const node = dom.create(tag);

  node.className = className;
  node.textContent = i18n.message(key);
  dom.set(node, "data-i18n", key);

  return node;
};

const handler = (entry) => {
  const row = label("profile.handler", entry.handler);

  if (!row || !/^[a-f0-9]{32}$/.test(entry.handlerId || "")) return row;
  const field = dom.query(".label", row);
  const button = dom.create("button");

  button.type = "button";
  button.className = "label";
  button.append(...field.childNodes);
  dom.set(button, "data-response", "");
  dom.on(button, "click", () => location.assign(`/profile/${entry.handlerId}`));
  field.replaceWith(button);

  return row;
};

const conversation = (entries, archived, target) => {
  const root = dom.create("div");

  root.className = "chatting history-conversation";
  dom.set(root, "data-chatting", "stream");

  let previous;

  for (const entry of entries) {
    const article = dom.create("article");
    const heading = dom.create("div");
    const name = dom.create("strong");
    const body = dom.create("div");
    const picture = avatar(entry.avatar || "");

    article.className = "chatting-message";
    heading.className = "chatting-profile";
    name.className = "chatting-name";
    picture.root.classList.add("chatting-avatar");
    body.className = "chatting-text";
    heading.append(picture.root);
    if (entry.id) {
      const render = (user) => picture.set(user.avatar || "");

      profile.bind(picture.root, entry.id, render);
      profile
        .read(entry.id)
        .then((result) => {
          if (result.ok) render(result.data);
        })
        .catch(() => {});
    }

    name.textContent =
      entry.name ||
      (entry.id ? i18n.message("profile.anonymous").replace("{id}", entry.id.slice(0, 8)) : "");

    if (name.textContent) heading.append(name);
    const time = dom.create("time");
    const stamp = clock.stamp(entry.time);

    time.className = "chatting-time";
    if (entry.time) {
      time.textContent = clock.format(stamp);
      time.dateTime = new Date(stamp).toISOString();
      time.title = clock.detail(stamp);
    }

    if (target && entry.url === target) {
      dom.set(article, "data-target", "");
    }

    link.render(body, entry.text || "");

    const images = dom.create("div");

    images.className = "history-media";
    if (archived) {
      media(images, { attachments: entry.attachments || [] });
      for (const item of entry.images || []) {
        if (!/^data:image\/webp;base64,/.test(item.image || "")) continue;
        const button = dom.create("button");
        const image = dom.create("img");

        button.type = "button";
        dom.set(button, "data-response", "");

        image.src = item.image;
        image.alt = item.description || "";
        image.loading = "lazy";
        image.draggable = false;
        button.append(image);
        dom.on(button, "click", () => view(item.image, button));
        images.append(button);
      }
    } else {
      media(images, entry);
      if (entry.audio) {
        const audio = dom.create("audio");

        audio.controls = true;
        audio.setAttribute("data-stt", "");
        audio.preload = "none";
        audio.src = entry.audio;
        audio.dataset.caption = entry.text || "";
        images.append(audio);
      }
    }

    if (!body.textContent && !body.childElementCount && !images.childElementCount) continue;

    if (heading.childElementCount) article.append(heading);

    if (images.childElementCount) body.append(images);

    article.append(body);
    if (entry.time) article.append(time);
    const follow =
      entry.id &&
      previous?.id === entry.id &&
      stamp >= previous.time &&
      stamp - previous.time <= 30 * 60 * 1000;

    if (follow) dom.set(article, "data-follow", "");

    previous = { id: entry.id, time: follow ? previous.time : stamp };
    root.append(article);
  }

  return root;
};

export default function record(entry, type) {
  const root = dom.create("div");
  const head = dom.create("div");
  const report = type === "report";
  const chat = type === "chatting";
  const key = report
    ? `report.${entry.type}`
    : chat
      ? "profile.chatHistory"
      : actions[entry.action];

  root.className = "group history-record";
  head.className = "history-record-head";
  dom.set(head, "data-kind", report ? "report" : chat ? "chatting" : entry.action);

  head.append(text("h3", key || "profile.blockHistory"));
  if (entry.time) {
    const source = String(entry.time);
    const date = new Date(source.includes("T") ? source : `${source.replace(" ", "T")}+09:00`);

    if (Number.isFinite(date.getTime())) {
      const meta = dom.create("div");
      const time = dom.create("time");

      meta.className = "history-record-time";
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat(dom.root.lang || undefined, {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(date);

      meta.append(time);
      head.append(meta);
    }
  }

  root.append(head);

  const snapshot = entry.snapshot;
  const messages =
    snapshot?.messages ||
    (chat ? [entry] : report && entry.type === "message" ? [{ ...entry, url: entry.message }] : []);

  const content = conversation(
    messages.map((message) => {
      if (!snapshot || message.attachments?.length || message.url !== entry.message) return message;
      return {
        ...message,
        attachments: (entry.attachments || []).filter(
          (item) => item.provider === "giphy" || item.type === "ogq"
        )
      };
    }),
    Boolean(snapshot),
    report ? entry.message : ""
  );

  if (content.childElementCount) {
    root.append(content);
  }

  const id = chat
    ? entry.url
    : entry.message || snapshot?.messages.find((item) => item.target)?.url;

  if (id && snapshot?.kind !== "whisper") {
    const button = dom.create("button");
    const arrow = dom.create("span");

    button.type = "button";
    arrow.className = "group-next";
    dom.set(arrow, "data-icon", "arrow");
    dom.set(button, "data-response", "");
    button.append(text("span", "profile.around"), arrow);
    dom.on(button, "click", () => location.assign(`/?message=${encodeURIComponent(id)}`));

    root.append(button);
  }

  const details = report
    ? [
        label("report.reason", i18n.message(`report.${entry.reason}`)),
        label("report.description", entry.detail),
        label("report.target", entry.name || entry.target),
        label("report.reporter", entry.reporter)
      ]
    : chat
      ? []
      : [
          label("profile.historyReason", entry.reason),
          handler(entry),
          label("profile.until", entry.until, { date: true })
        ];
  const valid = details.filter(Boolean);

  if (valid.length) {
    const section = dom.create("section");

    section.className = "history-handling";
    section.append(text("h4", "history.handling"), ...valid);
    root.append(section);
  }

  return root;
}
