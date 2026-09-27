import * as dom from "#common/dom";
import * as i18n from "#common/i18n";

const today = "chatting.today";
const yesterday = "chatting.yesterday";
const duration = 86_400_000;

i18n.preload(today, yesterday);

const parse = (value) => {
  if (value instanceof Date || typeof value === "number") {
    return new Date(value);
  }

  const source = String(value ?? "").trim();

  if (!source) {
    return new Date();
  }

  const normalized = source.replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);

  return new Date(
    zoned ? normalized : `${normalized}${normalized.includes("T") ? "" : "T00:00:00"}+09:00`
  );
};

export const datetime = (value, seconds = false) => {
  if (value === null || value === undefined || value === "") return "";
  const source = parse(value);

  if (!Number.isFinite(source.getTime())) return String(value);

  return new Date(source.getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, seconds ? 23 : 16)
    .replace("T", " ")
    .replace(/\.000$/, "");
};

export const day = (value) =>
  new Date(parse(value).getTime() + 9 * 3600000).toISOString().slice(0, 10);

export const label = (value) => {
  const source = parse(value);

  if (day(source) === day(new Date())) return i18n.message(today);

  return new Intl.DateTimeFormat(dom.root.lang || navigator.language, {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(source);
};

export const stamp = (value) => {
  const result = parse(value).getTime();

  return Number.isFinite(result) ? result : Date.now();
};

export const detail = (value) => {
  const source = parse(value);
  const lang = dom.root.lang || navigator.language;
  const clock = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    timeZone: "Asia/Seoul",
    minute: "2-digit",
    hour12: true
  }).format(source);

  const full = day(source);

  return `${full} ${clock}`;
};

export const format = (value) => {
  const source = parse(value);
  const now = new Date();
  const lang = dom.root.lang || navigator.language;
  const clock = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    timeZone: "Asia/Seoul",
    minute: "2-digit",
    hour12: true
  }).format(source);
  const passed = (Date.parse(day(now)) - Date.parse(day(source))) / duration;

  if (passed === 0) {
    return clock;
  }

  if (passed === 1) {
    return `${i18n.message(yesterday)} ${clock}`.trim();
  }

  const full = day(source);

  return `${full} ${clock}`;
};
