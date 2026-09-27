import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import toolbar from "#common/toolbar";
import { bottom } from "#common/chatting";
import emoji from "#common/chatting/emoji";
import image from "#common/chatting/image";
import draw from "#common/chatting/draw";
import stt from "#common/chatting/stt";
import tts from "#common/chatting/tts";
import context from "#common/context";
import * as settings from "#common/menu";

i18n.preload(
  "chatting.tools.open",
  "chatting.tools.emoji",
  "chatting.tools.image",
  "image.camera",
  "chatting.tools.file",
  "chatting.tools.draw",
  "chatting.tools.stt",
  "chatting.tools.tts",
  "chatting.tools.unavailable",
  "image.reset",
  "image.confirm"
);

export default function tools(root, history) {
  const form = dom.query(".chatting-form", root);
  const input = dom.query(".chatting-input", form);
  const list = dom.query(".chatting-list", root);
  const field = input.closest(".input");
  const voice = dom.query(".chatting-voice", form);

  if (voice) context(voice, () => settings.devices());
  const toggle = dom.create("button");
  const entries = [
    ["file", "file", (button) => image(button, history.attach, "")],
    ["smile", "emoji", () => emoji(input, history.attach)],
    ["camera", "camera", (button) => image(button, history.attach, "image/*", true)],
    ["image", "image", (button) => image(button, history.image)],
    ["edit", "draw", (button) => draw(button, history.image)],
    ["voice", "stt", (button) => stt(button, input, history.audio)],
    ["sound", "tts", (button) => tts(button, input, history.audio)]
  ];

  const menu = toolbar(
    entries.map(([icon, name, run]) => ({
      icon,
      color: true,
      text: name === "camera" ? "image.camera" : `chatting.tools.${name}`,
      run
    }))
  );

  toggle.className = "chatting-more";
  toggle.type = "button";
  dom.set(toggle, "data-icon", "plus");
  dom.set(toggle, "data-circle", "");
  dom.set(toggle, "data-scale", "");
  dom.set(toggle, "data-tooltip", "chatting.tools.open");
  dom.set(toggle, "data-response", "");
  menu.classList.add("chatting-toolbar");
  dom.set(menu, "data-position", "bottom");
  entries.forEach(([, name], index) => {
    if (name === "stt") context(menu.children[index], () => settings.devices());

    dom.set(menu.children[index], "data-circle", "");
    dom.set(menu.children[index], "data-scale", "");
    dom.set(
      menu.children[index],
      "data-tooltip",
      name === "camera" ? "image.camera" : `chatting.tools.${name}`
    );
  });

  dom.query(".input-actions", field).prepend(toggle);

  const attached = dom.query(".chatting-attachments", form);

  if (attached) {
    attached.after(menu);
  } else {
    field.before(menu);
  }

  const off = dom.on(toggle, "click", () => {
    if (root.hasAttribute("data-emotes")) {
      form.dispatchEvent(new Event("chatting-emotes-close"));

      return;
    }

    const opened = dom.get(form, "data-expanded") === "true";
    const stick = bottom(list);

    dom.set(form, "data-expanded", String(!opened));
    dom.set(toggle, "data-icon", opened ? "plus" : "close");
    root.dispatchEvent(new Event("chatting-viewport"));
    requestAnimationFrame(() => {
      if (!root.isConnected) return;

      if (stick) list.scrollTop = list.scrollHeight;

      field.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    });
  });

  const update = () => {
    toggle.disabled = input.disabled;
    for (const button of menu.children) {
      button.disabled = input.disabled || input.readOnly;
    }
  };

  const observer = new MutationObserver(update);

  observer.observe(input, { attributes: true, attributeFilter: ["disabled", "readonly"] });

  const preserve = dom.on(menu, "pointerdown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });

  update();

  return () => {
    preserve();
    off();
    observer.disconnect();
    toggle.remove();
    menu.remove();
  };
}
