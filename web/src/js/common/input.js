import * as i18n from "#common/i18n";

const editors = new WeakMap();

export const register = (element, insert) => editors.set(element, insert);

const placeholder = (element, value) => {
  element.placeholder = value;
};

export const insert = (element, value, focus = true) => {
  if (element.disabled || element.readOnly || typeof value !== "string") return false;

  if (editors.has(element)) {
    return editors.get(element)(value, focus);
  }

  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  const length = element.value.length - (end - start) + value.length;

  if (element.maxLength >= 0 && length > element.maxLength) return false;

  element.setRangeText(value, start, end, "end");
  element.dispatchEvent(new Event("input", { bubbles: true }));
  if (focus) {
    element.focus({ preventScroll: true });
  }

  return true;
};

export default function input() {
  return i18n.register("data-i18n-placeholder", placeholder);
}
