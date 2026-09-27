import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import popover from "#common/popover";
import toast from "#common/toast";
import maximum from "#shared/upload";
import device from "#common/device";

i18n.preload(
  "image.sizeError",
  "image.loadError",
  "image.uploadError",
  "image.cancel",
  "chatting.tools.preview",
  "chatting.send"
);

export const preview = async (file, anchor, send) => {
  if (!file?.size) return;

  if (file.size > maximum) {
    toast({ text: "image.sizeError", type: "error" });

    return;
  }

  const url = URL.createObjectURL(file);
  const root = dom.create("div");
  const image = dom.create("img");

  let active = true;

  root.className = "chatting-preview-image";
  image.src = url;
  image.alt = i18n.message("chatting.tools.image");
  image.draggable = false;
  root.append(image);
  try {
    await image.decode();
    await popover({
      anchor,
      back: true,
      title: "chatting.tools.preview",
      content: root,
      direction: "→",
      actions: [
        { text: "image.cancel", icon: "close", value: false },
        {
          text: "chatting.send",
          icon: "send",
          data: ["data-confirm"],
          run: async ({ button }) => {
            button.disabled = true;
            try {
              const saved = await send(file);

              return active && saved;
            } catch {
              if (active) toast({ text: "image.uploadError", type: "error" });

              return false;
            } finally {
              button.disabled = false;
            }
          }
        }
      ]
    });
  } catch {
    toast({ text: "image.loadError", type: "error" });
  } finally {
    active = false;
    URL.revokeObjectURL(url);
  }
};

export default async function image(
  anchor,
  send,
  accept = "image/jpeg,image/png,image/webp,image/gif",
  capture = false
) {
  if (capture && device().window) {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ text: "chatting.tools.unavailable", type: "error" });
      return;
    }
    const root = dom.create("div");
    const video = dom.create("video");

    let stream;
    let active = true;

    root.className = "chatting-preview-image";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    root.append(video);
    try {
      await popover({
        anchor,
        title: "image.camera",
        content: root,
        back: true,
        ready: async () => {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (!active) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }

            video.srcObject = stream;
            await video.play();
          } catch {
            if (active) toast({ text: "chatting.tools.unavailable", type: "error" });
          }
        },
        actions: [
          { text: "image.cancel", icon: "close", value: false },
          {
            text: "image.camera",
            icon: "camera",
            data: ["data-confirm"],
            run: async () => {
              if (!video.videoWidth || !video.videoHeight) return false;
              const canvas = dom.create("canvas");

              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.getContext("2d").drawImage(video, 0, 0);

              const blob = await new Promise((resolve) =>
                canvas.toBlob(resolve, "image/jpeg", 0.9)
              );

              return blob && (await send(new File([blob], "camera.jpg", { type: blob.type })));
            }
          }
        ]
      });
    } finally {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    return;
  }

  if (!accept && window.showOpenFilePicker) {
    let handles;

    try {
      handles = await window.showOpenFilePicker({ multiple: true });
    } catch (error) {
      if (error.name === "AbortError") return;
    }
    if (handles) {
      for (const handle of handles) {
        if (!(await send(await handle.getFile()))) break;
      }
      return;
    }
  }
  const input = dom.create("input");

  input.type = "file";
  input.multiple = !capture;
  input.accept = accept;
  input.name = "attachment";
  input.hidden = true;
  if (capture) input.capture = "environment";

  dom.body.append(input);
  try {
    const files = await new Promise((resolve) => {
      dom.on(input, "change", () => resolve([...input.files]), { once: true });
      dom.on(input, "cancel", () => resolve([]), { once: true });
      input.click();
    });

    for (const file of files) {
      if (!(await send(file))) break;
    }
  } finally {
    input.remove();
  }
}
