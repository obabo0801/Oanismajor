import * as dom from "#common/dom";
import toast from "#common/toast";
import * as i18n from "#common/i18n";

i18n.preload("chatting.copyFailed", "chatting.saveFailed");

const blob = async (source) => {
  const url = typeof source === "function" ? await source() : source;

  if (!url) throw new Error("Missing image");

  const response = await fetch(url);

  if (!response.ok) throw new Error("Image fetch failed");

  return { blob: await response.blob(), url };
};

export const copy = async (value) => {
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
  } catch {
    toast({ text: "chatting.copyFailed", type: "error" });
  }
};

export const save = async (sources, filename = "") => {
  try {
    for (const source of sources) {
      if (filename && typeof source === "string") {
        const link = dom.create("a");

        link.href = source;
        link.download = filename;
        link.hidden = true;
        dom.body.append(link);
        link.click();
        link.remove();
        continue;
      }
      const data = await blob(source);
      const url = URL.createObjectURL(data.blob);
      const link = dom.create("a");
      const path = new URL(data.url, location.href).pathname;
      const extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif"
      };
      const name = path.split("/").at(-1) || "image";
      const extension = extensions[data.blob.type];

      link.href = url;
      link.download =
        filename || (name.includes(".") || !extension ? name : `${name}.${extension}`);

      link.hidden = true;
      dom.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch {
    toast({ text: "chatting.saveFailed", type: "error" });
  }
};

export const image = async (source) => {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard unavailable");
    }

    const value = (async () => {
      const data = await blob(source);
      const bitmap = await createImageBitmap(data.blob);

      try {
        const canvas = dom.create("canvas");

        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);

        return await new Promise((resolve, reject) => {
          canvas.toBlob(
            (result) => (result ? resolve(result) : reject(new Error("Image conversion failed"))),
            "image/png"
          );
        });
      } finally {
        bitmap.close();
      }
    })();

    await navigator.clipboard.write([new ClipboardItem({ "image/png": value })]);
  } catch {
    toast({ text: "chatting.copyFailed", type: "error" });
  }
};
