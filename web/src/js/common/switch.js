import * as dom from "#common/dom";
import sound from "#common/sound";
import vibrate from "#common/vibrate";

export default function toggle() {
  dom.on(document, "change", (event) => {
    const input = event.target;

    if (!input.matches?.('.switch input[type="checkbox"]')) {
      return;
    }

    sound.play("choice");
    vibrate.play("swipe");
  });
}
