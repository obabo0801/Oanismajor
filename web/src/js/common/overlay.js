import * as dom from "#common/dom";

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export default function overlay(element) {
  let effect;
  let frame;
  let done;
  let level = 0;
  let strength = 0;
  let opened = false;
  let closed = false;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = undefined;
    done?.();
    done = undefined;
  };

  const keyframes = () => {
    const theme = getComputedStyle(dom.root);
    const shade = theme.getPropertyValue("--shade").trim();
    const percent = Math.round(strength * 100);
    const color =
      percent === 0
        ? shade
        : percent === 100
          ? "#000000"
          : `color-mix(in srgb, ${shade}, #000 ${percent}%)`;

    const blur = element.hasAttribute("data-backdrop") ? "blur(2px)" : "blur(0px)";

    return [
      {
        backgroundColor: "transparent",
        backdropFilter: "blur(0px)",
        webkitBackdropFilter: "blur(0px)"
      },
      { backgroundColor: color, backdropFilter: blur, webkitBackdropFilter: blur }
    ];
  };

  const animation = () => {
    if (!opened) {
      return null;
    }

    if (effect) {
      return effect;
    }

    effect = element.animate(keyframes(), {
      duration: 1,
      fill: "both",
      pseudoElement: "::backdrop"
    });

    effect.pause();
    effect.currentTime = level;

    return effect;
  };

  const paint = (value) => {
    level = clamp(value);

    const current = animation();

    if (!current) {
      return;
    }

    current.pause();
    current.currentTime = level;
  };

  const move = (target) =>
    new Promise((finish) => {
      stop();
      done = finish;

      target = clamp(target);

      const from = level;

      if (reduce.matches || from === target) {
        paint(target);
        done();
        done = undefined;

        return;
      }

      const start = performance.now();
      const duration = 160 * Math.max(0.4, Math.abs(target - from));

      const run = (now) => {
        const time = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - time, 3);

        paint(from + (target - from) * ease);

        if (time < 1) {
          frame = requestAnimationFrame(run);

          return;
        }

        frame = undefined;
        done();
        done = undefined;
      };

      frame = requestAnimationFrame(run);
    });

  const release = async (smooth = true) => {
    if (closed) {
      return;
    }

    closed = true;

    if (!opened) {
      return;
    }

    if (smooth) {
      await move(0);
    } else {
      stop();
      paint(0);
    }

    stop();

    effect?.cancel();
  };

  release.open = () => {
    if (opened || closed) {
      return;
    }

    opened = true;
    move(1);
  };

  release.shade = (value = 0) => {
    stop();
    paint(1 - clamp(value));
  };

  release.strength = (value = 0) => {
    strength = clamp(value);
    effect?.effect?.setKeyframes(keyframes());
  };

  return release;
}
