import * as route from "#common/route";

const stack = [];

let watcher;
let running = false;

function stop() {
  watcher?.destroy();
  watcher = undefined;
}

function watch() {
  stop();

  if (!stack.length || !("CloseWatcher" in window)) {
    return;
  }

  watcher = new CloseWatcher();
  watcher.addEventListener(
    "close",
    () => {
      watcher = undefined;
      back().catch(console.error);
    },
    { once: true }
  );
}

function drop(item) {
  const index = stack.lastIndexOf(item);

  if (index < 0) {
    return false;
  }

  const last = index === stack.length - 1;

  stack.splice(index, 1);

  const released = item.release?.();

  if (last && !running) {
    watch();
  }

  return released ? released.then(() => true) : true;
}

export function add(run, state) {
  if (typeof run !== "function") {
    return () => {};
  }

  const item = { run };

  stack.push(item);

  if (state) {
    item.release = route.add(state, async () => {
      while (stack.at(-1) && stack.at(-1) !== item) {
        const top = stack.at(-1);

        await back();
        if (stack.at(-1) === top) return false;
      }

      return run();
    });
  }

  if (!running) {
    watch();
  }

  return () => drop(item);
}

export function remove(run) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].run === run) {
      return drop(stack[index]);
    }
  }

  return false;
}

export async function back() {
  if (running) {
    return true;
  }

  const item = stack.at(-1);

  if (!item) {
    return false;
  }

  stop();
  running = true;

  let keep = false;

  try {
    keep = (await item.run()) === false;
  } finally {
    if (!keep) {
      await drop(item);
    }

    running = false;
    watch();
  }

  return true;
}

export function clear() {
  stack.length = 0;
  stop();
}

export function has() {
  return stack.length > 0;
}
