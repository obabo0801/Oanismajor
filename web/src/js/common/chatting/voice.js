import * as dom from "#common/dom";
import voice, { stop } from "#common/voice";
import { insert } from "#common/input";
import toast from "#common/toast";

const active = new WeakSet();

export default async function listen(input, button) {
  if (active.has(input)) {
    stop();

    return;
  }

  if (input.disabled || input.readOnly) return;

  active.add(input);
  dom.set(button, "data-recording", "");
  dom.set(button, "data-icon", "wave");

  const cancel = dom.on(window, "chatting-stop", () => {
    stop();
    stop();
  });
  const start = input.selectionStart;
  const end = input.selectionEnd;

  try {
    const result = await voice([], input);

    if (input.disabled || result.action === "none" || !result.text) return;

    input.setSelectionRange(start, end);
    if (!insert(input, result.text)) toast({ text: "chatting.tooLong", type: "warning" });
  } finally {
    active.delete(input);
    cancel();
    dom.remove(button, "data-recording");
    dom.set(button, "data-icon", "voice");
    input.form?.dispatchEvent(new Event("chatting-state"));
    input.dispatchEvent(new Event("chatting-viewport", { bubbles: true }));
  }
}
