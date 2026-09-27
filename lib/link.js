import * as mention from "./mention.js";

const protocols = new Set(["http:", "https:", "mailto:", "tel:"]);

export function resolve(value, base) {
  if (typeof value !== "string") return "";

  const text = value.trim();

  if (!text || text.length > 4096 || /[\u0000-\u0020\u007f]/u.test(text)) return "";

  try {
    const url = new URL(text, base);

    if (!protocols.has(url.protocol) || url.username || url.password) return "";

    return url.href;
  } catch {
    return "";
  }
}

const unescape = (text) => text.replace(/\\([\\[\]()<>])/g, "$1");

const markdown = (text, start) => {
  let end = start + 1;
  let depth = 1;

  while (end < text.length && end - start < 4096) {
    if (text[end] === "\\") end += 2;
    else {
      if (text[end] === "[") depth += 1;

      if (text[end] === "]") depth -= 1;

      if (!depth || depth > 16) break;

      end += 1;
    }
  }

  if (depth || text[end + 1] !== "(") return null;

  const label = unescape(text.slice(start + 1, end));
  const begin = end + 2;

  end = begin;
  depth = 1;
  while (end < text.length && end - begin < 4096) {
    if (text[end] === "\\") end += 2;
    else {
      if (text[end] === "(") depth += 1;

      if (text[end] === ")") depth -= 1;

      if (!depth || depth > 16) break;

      end += 1;
    }
  }

  if (depth) return null;

  let url = text.slice(begin, end).trim();

  if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);

  return { text: label, url: unescape(url), end: end + 1 };
};

const trim = (value) => {
  let text = value.replace(/[.,!?;:]+$/u, "");

  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"]
  ]) {
    while (text.endsWith(close) && text.split(close).length > text.split(open).length) {
      text = text.slice(0, -1);
    }
  }

  return text.replace(/[.,!?;:]+$/u, "");
};

export function parse(value, base) {
  const text = String(value ?? "");
  const result = [];
  const mentions = new Map(mention.matches(text).map((item) => [item.index, item[0].length]));

  let index = 0;
  let start = 0;

  const append = (end, label, url) => {
    if (start < index) result.push({ text: text.slice(start, index) });

    result.push(url ? { text: label, url } : { text: text.slice(index, end) });
    index = start = end;
  };

  while (index < text.length) {
    if (mentions.has(index)) {
      index += mentions.get(index);
      continue;
    }

    if (text[index] === "\\") {
      index += 2;
      continue;
    }

    if (text[index] === "`") {
      const marks = text.slice(index).match(/^`+/)[0];
      const end = text.indexOf(marks, index + marks.length);

      index = end < 0 ? text.length : end + marks.length;
      continue;
    }

    if (text[index] === "[" || (text[index] === "!" && text[index + 1] === "[")) {
      const image = text[index] === "!";
      const item = markdown(text, index + Number(image));

      if (item) {
        append(item.end, item.text || item.url, image ? "" : resolve(item.url, base));

        continue;
      }
    }

    if (
      /^https?:\/\//i.test(text.slice(index, index + 8)) &&
      (index === 0 || !/[\w@]/u.test(text[index - 1]))
    ) {
      const raw = text.slice(index).match(/^[^\s<>"'`]+/u)?.[0] || "";
      const value = trim(raw);
      const url = resolve(value, base);

      if (url) {
        append(index + value.length, value, url);
        continue;
      }
    }

    index += 1;
  }

  if (start < text.length) result.push({ text: text.slice(start) });

  return result;
}
