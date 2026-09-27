import { on } from "#common/dom";
import * as pointer from "#common/pointer";

const shapes = ["○", "△", "□"];
const gestures = new Set();

let points = [];
let id = null;
let offs = [];

const reset = () => {
  points = [];
  id = null;
};

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pathLength(path) {
  let total = 0;

  for (let index = 1; index < path.length; index++) {
    total += distance(path[index - 1], path[index]);
  }

  return total;
}

function sample(path, count = 32) {
  const total = pathLength(path);

  if (!total) {
    return path;
  }

  const gap = total / (count - 1);
  const result = [path[0]];

  let point = path[0];
  let index = 1;
  let moved = 0;

  while (index < path.length && result.length < count - 1) {
    const next = path[index];
    const size = distance(point, next);

    if (!size) {
      point = next;
      index++;

      continue;
    }

    if (moved + size >= gap) {
      const rate = (gap - moved) / size;

      point = { x: point.x + (next.x - point.x) * rate, y: point.y + (next.y - point.y) * rate };

      result.push(point);
      moved = 0;
    } else {
      moved += size;
      point = next;
      index++;
    }
  }

  result.push(path.at(-1));

  return result;
}

function turn(a, b, c) {
  const ax = a.x - b.x;
  const ay = a.y - b.y;
  const cx = c.x - b.x;
  const cy = c.y - b.y;
  const size = Math.hypot(ax, ay) * Math.hypot(cx, cy);

  if (!size) {
    return 0;
  }

  const value = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / size));

  return 180 - (Math.acos(value) * 180) / Math.PI;
}

function countCorners(path) {
  const count = path.length;
  const marked = [];

  for (let index = 0; index < count; index++) {
    const before = path[(index - 2 + count) % count];
    const after = path[(index + 2) % count];

    marked.push(turn(before, path[index], after) > 45);
  }

  let result = 0;

  marked.forEach((active, index) => {
    const previous = marked[(index - 1 + count) % count];

    if (active && !previous) {
      result++;
    }
  });

  return result;
}

function detect(path) {
  if (path.length < 8) {
    return null;
  }

  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(width, height);

  if (size < 48 || Math.min(width, height) < size * 0.35) {
    return null;
  }

  if (distance(path[0], path.at(-1)) > Math.max(32, size * 0.35)) {
    return null;
  }

  if (pathLength(path) < size * 2) {
    return null;
  }

  const sampled = sample([...path, path[0]]).slice(0, -1);
  const corners = countCorners(sampled);

  if (corners === 3) {
    return "△";
  }

  if (corners === 4) {
    return "□";
  }

  if (corners <= 2) {
    return "○";
  }

  return null;
}

function trigger(event) {
  const shape = detect(points);

  reset();

  if (!shape) {
    return;
  }

  gestures.forEach((item) => {
    if (item.shape === shape) {
      item.listener(event);
    }
  });
}

function touchStart(event) {
  if (event.touches.length !== 1) {
    reset();

    return;
  }

  const touch = event.touches[0];

  id = touch.identifier;
  points = [{ x: touch.clientX, y: touch.clientY }];
}

function touchMove(event) {
  if (id === null) {
    return;
  }

  const touch = [...event.touches].find((item) => item.identifier === id);

  if (!touch) {
    return;
  }

  const point = { x: touch.clientX, y: touch.clientY };

  if (distance(points.at(-1), point) >= 4) {
    points.push(point);
  }
}

function touchEnd(event) {
  if (id === null) {
    return;
  }

  const touch = [...event.changedTouches].find((item) => item.identifier === id);

  if (!touch) {
    return;
  }

  points.push({ x: touch.clientX, y: touch.clientY });
  trigger(event);
}

function pointerDown(event) {
  if (!event.isPrimary || !pointer.press(event) || !event.shiftKey) {
    return;
  }

  id = event.pointerId;
  points = [{ x: event.clientX, y: event.clientY }];
}

function pointerMove(event) {
  if (!pointer.match(event, id)) {
    return;
  }

  const point = { x: event.clientX, y: event.clientY };

  if (distance(points.at(-1), point) >= 4) {
    points.push(point);
  }
}

function pointerUp(event) {
  if (!pointer.match(event, id)) {
    return;
  }

  points.push({ x: event.clientX, y: event.clientY });
  trigger(event);
}

function cancel(event) {
  if ("pointerType" in event && !pointer.match(event, id)) {
    return;
  }

  reset();
}

function watch() {
  if (offs.length) {
    return;
  }

  const options = { passive: true };

  offs = [
    on(document, "pointerdown", pointerDown),
    on(document, "pointermove", pointerMove),
    on(document, "pointerup", pointerUp),
    on(document, "pointercancel", cancel),
    on(document, "touchstart", touchStart, options),
    on(document, "touchmove", touchMove, options),
    on(document, "touchend", touchEnd, options),
    on(document, "touchcancel", cancel, options)
  ];
}

function unwatch() {
  if (gestures.size) {
    return;
  }

  offs.forEach((remove) => {
    remove();
  });

  offs = [];
  reset();
}

export default function gesture(value, listener) {
  const shape = String(value).trim();

  if (!shapes.includes(shape) || typeof listener !== "function") {
    return () => {};
  }

  const item = { shape, listener };

  gestures.add(item);
  watch();

  return () => {
    gestures.delete(item);
    unwatch();
  };
}
