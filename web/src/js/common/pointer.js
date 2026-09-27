export const is = (event, type) => event.pointerType === type;

export const press = (event) => is(event, "mouse") && event.button === 0;

export const match = (event, id) => is(event, "mouse") && event.pointerId === id;

export const blocked = (event) => {
  const target = event.target;

  if (
    target.closest?.(
      "input, select, textarea, [contenteditable], .select, .range, " + '[data-drag="none"]'
    )
  ) {
    return true;
  }

  if (!is(event, "mouse") || !target.textContent?.trim()) return false;

  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  const range = document.createRange();

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;

    if (getComputedStyle(node.parentElement).userSelect === "none") continue;

    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return true;
      }
    }
  }

  return false;
};
