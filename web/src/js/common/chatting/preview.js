import * as dom from "#common/dom";
import * as css from "#common/css";
import * as names from "#common/profile/name";
import * as clock from "#common/chatting/time";
import avatar from "#common/avatar";

const copy = (source) => {
  const clone = source.cloneNode(true);
  const sources = [source, ...dom.all("*", source)];
  const targets = [clone, ...dom.all("*", clone)];

  targets.forEach((target, index) => css.copy(sources[index], target));

  return clone;
};

export default function preview(message, selected, options = {}) {
  const element = dom.create("div");
  const clone = message
    ? selected
      ? message.cloneNode(false)
      : copy(message)
    : dom.create("article");

  if (message && selected) css.copy(message, clone);

  element.className = "chatting chatting-preview";
  dom.set(element, "data-chatting", "stream");
  clone.className = "chatting-message";
  if (selected) {
    const profile = message && dom.query(":scope > .chatting-profile", message);
    const time = message && dom.query(":scope > .chatting-time", message);
    const body = dom.create("p");
    const sender = options.sender || {};

    body.className = "chatting-text";
    if (profile) clone.append(copy(profile));
    else if (sender.id || sender.name) {
      const head = dom.create("div");
      const name = dom.create("span");
      const picture = avatar(sender.avatar || "", "span");

      head.className = "chatting-profile";
      name.className = "chatting-name";
      picture.root.classList.add("chatting-avatar");
      name.textContent = names.label(sender);

      head.append(picture.root, name);
      clone.append(head);
    }

    body.append(selected);
    clone.append(body);
    if (time) clone.append(copy(time));
    else if (options.time) {
      const stamp = dom.create("time");

      stamp.className = "chatting-time";
      stamp.textContent = clock.format(options.time);
      stamp.dateTime = new Date(clock.stamp(options.time)).toISOString();
      stamp.title = clock.detail(options.time);
      clone.append(stamp);
    }
  }

  if (!dom.query(":scope > .chatting-profile", clone)) {
    dom.query(":scope > .chatting-time", clone)?.remove();
  }

  clone.inert = !selected?.matches(".chatting-audio") && !selected?.querySelector("audio, video");
  if (!clone.inert) {
    for (const child of clone.children) if (!child.contains(selected)) child.inert = true;
  }

  dom.remove(clone, "data-own");
  dom.remove(clone, "data-follow");
  dom.query(".chatting-unread", clone)?.remove();
  for (const node of dom.all(".embed-body, .embed-notice, iframe", clone)) node.remove();

  for (const target of [clone, ...dom.all("*", clone)]) {
    if (target.matches("img")) target.loading = "eager";

    for (const name of [
      "id",
      "autofocus",
      "tabindex",
      "data-response",
      "data-action",
      "data-layer-action",
      "data-shadow"
    ])
      dom.remove(target, name);
  }

  element.append(clone);

  return element;
}
