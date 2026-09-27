import * as i18n from "#common/i18n";

i18n.preload("direct.image", "direct.audio", "direct.deleted");

export default function summary(item) {
  if (item.deleted) return i18n.message("direct.deleted");
  const text = item.text || "";
  const image = item.image || item.attachments?.length;
  const label = image
    ? i18n.message("direct.image")
    : item.audio
      ? i18n.message("direct.audio")
      : "";

  return [text, label].filter(Boolean).join(" ");
}
