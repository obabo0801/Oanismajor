import * as dom from "#common/dom";
import sound from "#common/sound";
import vibrate from "#common/vibrate";

export default function choice() {
  dom.on(document, "change", (event) => {
    const input = event.target;

    if (!input.matches?.(".radio input, .checkbox input")) {
      return;
    }

    sound.play("choice");
    vibrate.play("confirm");
  });
}
