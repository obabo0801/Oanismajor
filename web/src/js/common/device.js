import { root, on } from "#common/dom";

const portrait = matchMedia("(orientation: portrait)");
const coarse = matchMedia("(pointer: coarse)");
const touch = matchMedia("(any-pointer: coarse)");
const wearable = matchMedia("(width <= 480px) and (height <= 480px)");

const small = matchMedia("(width <= 32rem) and (height <= 24rem)");

const short = matchMedia("(orientation: landscape) and " + "(height <= 32rem)");
const state = {};

let listening = false;

const sync = () => {
  state.wearable = wearable.matches && coarse.matches;
  state.mobile = !state.wearable && coarse.matches;
  state.window = !state.wearable && !state.mobile;
  state.portrait = portrait.matches;
  state.small = small.matches;
  state.compact = state.small || short.matches;
  state.touch = touch.matches || navigator.maxTouchPoints > 0;

  Object.entries(state).forEach(([name, active]) => {
    root.classList.toggle(name, active);
  });

  return state;
};

export default function device() {
  if (!listening) {
    [portrait, coarse, touch, wearable, small, short].forEach((media) => {
      on(media, "change", sync);
    });

    listening = true;
  }

  return sync();
}
