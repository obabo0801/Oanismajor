import patterns from "#common/pattern";
import { get } from "#common/storage";

let timer;
let tracks = [];

function native(value) {
  try {
    const bridge = globalThis.oanismajor;

    return typeof value === "string" && bridge?.haptic?.(value) === true;
  } catch {
    return false;
  }
}

function durations(value) {
  if (typeof value === "string") {
    const pattern = patterns[value] || [];

    return pattern.flatMap(([, duration, gap]) => [duration, gap]).slice(0, -1);
  }

  const pattern = Array.isArray(value) ? value : [value];

  return pattern.map((duration) => {
    const number = Number(duration);

    if (!Number.isFinite(number)) {
      return 0;
    }

    return Math.max(0, Math.round(number));
  });
}

function intervals(track, now) {
  const result = [];

  let start = track.start;

  track.pattern.forEach((duration, index) => {
    const end = start + duration;

    if (index % 2 === 0 && end > now) {
      result.push([Math.max(start, now), end]);
    }

    start = end;
  });

  return result;
}

function merge(ranges) {
  const result = [];

  ranges.sort((a, b) => a[0] - b[0]);

  for (const range of ranges) {
    const last = result.at(-1);

    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);

      continue;
    }

    result.push([...range]);
  }

  return result;
}

function render() {
  const now = performance.now();

  tracks = tracks.filter(({ end }) => end > now);

  const ranges = tracks.flatMap((track) => intervals(track, now));
  const pattern = [];

  let cursor = now;

  for (const [start, end] of merge(ranges)) {
    const gap = Math.max(0, start - cursor);

    if (!pattern.length && gap) {
      pattern.push(0);
    }

    if (gap) {
      pattern.push(gap);
    }

    pattern.push(end - start);
    cursor = end;
  }

  navigator.vibrate(pattern.map((duration) => Math.max(0, Math.round(duration))));

  clearTimeout(timer);

  if (!tracks.length) {
    return;
  }

  const end = Math.max(...tracks.map((track) => track.end));

  timer = setTimeout(() => {
    tracks = [];
  }, end - now);
}

export function play(value = 50) {
  if (get("vibration", "true") === "false") {
    return false;
  }

  if (native(value)) {
    return true;
  }

  if (typeof navigator === "undefined" || !("vibrate" in navigator)) {
    return false;
  }

  if (navigator.userActivation?.hasBeenActive === false) {
    return false;
  }

  const pattern = durations(value);

  if (!pattern.some(Boolean)) {
    return false;
  }

  const start = performance.now();
  const length = pattern.reduce((total, duration) => total + duration, 0);

  tracks.push({ pattern, start, end: start + length });
  render();

  return true;
}

export function stop() {
  tracks = [];
  clearTimeout(timer);

  if (typeof navigator === "undefined" || !("vibrate" in navigator)) {
    return false;
  }

  if (navigator.userActivation?.hasBeenActive === false) {
    return false;
  }

  return navigator.vibrate(0);
}

export default Object.freeze({ play, stop });
