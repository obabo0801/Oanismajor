import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as storage from "#common/storage";
import dialog from "#common/dialog";
import toast from "#common/toast";
import preview from "#common/chatting/audio";
import { tts as path } from "#shared/route";

i18n.preload("chatting.audio.text", "image.confirm", "image.cancel");

export default async function speak(anchor, input, send) {
  const root = dom.create("div");
  const text = dom.create("textarea");
  const controller = new AbortController();

  let file;

  root.className = "input";
  text.maxLength = 500;
  text.rows = 3;
  text.value = input.value;
  dom.set(text, "data-control", "");
  dom.set(text, "data-i18n-placeholder", "chatting.audio.text");
  root.append(text);

  const cancel = dom.on(window, "chatting-stop", () => controller.abort());

  try {
    file = await dialog({
      anchor,
      title: "chatting.tools.tts",
      content: root,
      direction: "→",
      actions: [
        { text: "image.cancel", icon: "close", value: false },
        {
          text: "image.confirm",
          icon: "check",
          data: ["data-confirm"],
          disabled: () => !text.value.trim() || text.value.length > 500,
          run: async ({ button }) => {
            if (input.disabled || controller.signal.aborted) return false;

            button.disabled = true;
            try {
              const response = await fetch(`/api${path}`, {
                method: "POST",
                cache: "no-store",
                signal: controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: text.value.trim(),
                  lang: dom.root.lang,
                  voice: storage.get("voice", "")
                })
              });

              if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/"))
                throw new Error("Speech synthesis failed");
              const blob = await response.blob();

              if (!blob.size) throw new Error("Empty speech");

              return blob;
            } catch {
              if (!controller.signal.aborted)
                toast({ text: "chatting.audio.error", type: "error" });

              return false;
            } finally {
              button.disabled = false;
            }
          }
        }
      ]
    });
  } finally {
    controller.abort();
    cancel();
  }

  if (file instanceof Blob && !input.disabled)
    await preview(file, anchor, send, text.value.trim(), false);
}
