import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as media from "#common/voice/media";
import popover from "#common/popover";
import toast from "#common/toast";
import preview from "#common/chatting/audio";
import * as server from "#common/voice/server";

i18n.preload(
  "chatting.audio.record",
  "chatting.audio.stop",
  "chatting.audio.hint",
  "chatting.audio.error",
  "chatting.tools.stt",
  "image.cancel"
);

export default async function record(anchor, input, send) {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    toast({ text: "chatting.tools.unavailable", type: "error" });

    return;
  }

  const root = dom.create("p");
  const off = [];

  let active = true;
  let stream;
  let session;
  let timer;
  let finish;
  let file;

  dom.set(root, "data-i18n", "chatting.audio.hint");

  const stop = () => {
    if (session?.recorder.state === "recording") session.recorder.stop();

    media.close(stream);
    clearTimeout(timer);
  };

  off.push(
    dom.on(window, "chatting-stop", () => {
      active = false;
      stop();
      finish?.(false);
    })
  );

  try {
    file = await popover({
      anchor,
      back: true,
      title: "chatting.tools.stt",
      content: root,
      direction: "→",
      ready: (_, close) => {
        finish = close;
      },
      actions: [
        { text: "image.cancel", icon: "close", value: false },
        {
          text: "chatting.audio.record",
          icon: "voice",
          close: false,
          data: ["data-confirm"],
          run: async ({ button }) => {
            if (session) {
              stop();

              return;
            }

            if (input.disabled) return;

            button.disabled = true;
            try {
              stream = await media.microphone();
              if (!active || input.disabled) {
                media.close(stream);

                return;
              }

              session = media.record(stream);
              off.push(
                dom.on(session.recorder, "error", () => {
                  active = false;
                  stop();
                  toast({ text: "chatting.audio.error", type: "error" });
                  finish(false);
                })
              );

              for (const track of stream.getTracks()) off.push(dom.on(track, "ended", stop));
              session.done.then((blob) => {
                stop();
                if (active) finish(blob.size ? blob : false);
              });

              const label = dom.query(".layer-label", button);

              dom.set(label, "data-i18n", "chatting.audio.stop");
              label.textContent = i18n.message("chatting.audio.stop");
              if (dom.get(button, "data-icon")) dom.set(button, "data-icon", "wave");

              timer = setTimeout(stop, 60_000);
            } catch {
              media.close(stream);
              if (active) toast({ text: "chatting.audio.error", type: "error" });
            } finally {
              button.disabled = false;
            }
          }
        }
      ]
    });
  } finally {
    active = false;
    stop();
    off.forEach((remove) => remove());
  }

  if (file instanceof Blob && !input.disabled) {
    let text = "";

    if (await server.available()) {
      const lang = dom.root.lang || navigator.language || "ko";
      const regions = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };
      const result = await server
        .upload(file, {
          lang: regions[lang] || lang,
          text: "",
          signal: AbortSignal.timeout(60_000)
        })
        .catch(() => null);

      text = result?.text || "";
    }

    if (!input.disabled) await preview(file, anchor, send, text);
  }
}
