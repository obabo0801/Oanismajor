import { on } from "#common/dom";
import sound from "#common/sound";
import vibrate from "#common/vibrate";

export let trigger;

export default function button() {
  on(
    document,
    "click",
    (event) => {
      const source = event.target.closest?.("button:enabled");

      trigger = source;
      setTimeout(() => {
        if (trigger === source) {
          trigger = undefined;
        }
      });
    },
    true
  );

  on(
    document,
    "click",
    (event) => {
      const button = event.target.closest?.("button:enabled, a[href][data-response]");

      if (!button) {
        return;
      }

      const segment = button.closest(".segment");
      const response = button.getAttribute("data-response");

      if (response === null && !segment) {
        return;
      }

      sound.play(response || "click");
      vibrate.play(segment ? "segment" : "click");
    },
    true
  );
}
