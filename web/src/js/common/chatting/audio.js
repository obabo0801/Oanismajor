import * as dom from "#common/dom";
import * as caption from "#common/caption";
import * as i18n from "#common/i18n";
import popover from "#common/popover";
import toast from "#common/toast";
import maximum from "#shared/upload";

i18n.preload(
  "chatting.audio.preview",
  "chatting.audio.error",
  "chatting.audio.size",
  "chatting.send",
  "image.cancel"
);

export default async function preview(file, anchor, send, text = "", transcript = true) {
  if (!file?.size) return;

  if (file.size > maximum) {
    toast({ text: "chatting.audio.size", type: "error" });

    return;
  }

  const root = dom.create("div");
  const audio = dom.create("audio");

  audio.dataset.channel = transcript ? "media" : "tts";

  const url = URL.createObjectURL(file);

  let active = true;
  let failed = false;

  root.className = "chatting-preview-audio";
  audio.controls = true;
  audio.setAttribute("data-stt", "");
  audio.preload = "metadata";
  audio.src = url;
  file.caption = transcript ? text : "";

  const unbind = caption.bind(audio, text);

  dom.on(audio, "error", () => {
    failed = true;
    if (active) toast({ text: "chatting.audio.error", type: "error" });
  });

  root.append(audio);
  try {
    await popover({
      anchor,
      back: true,
      title: "chatting.audio.preview",
      content: root,
      direction: "→",
      actions: [
        { text: "image.cancel", icon: "close", value: false },
        {
          text: "chatting.send",
          icon: "send",
          data: ["data-confirm"],
          disabled: () => failed,
          run: async ({ button }) => {
            button.disabled = true;
            audio.pause();

            try {
              return (await send(file)) && active;
            } catch {
              if (active) toast({ text: "chatting.audio.error", type: "error" });

              return false;
            } finally {
              button.disabled = false;
            }
          }
        }
      ]
    });
  } finally {
    unbind();
    active = false;
    audio.pause();
    dom.remove(audio, "src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
