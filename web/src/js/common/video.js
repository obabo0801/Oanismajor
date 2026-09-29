import * as dom from "./dom.js";
import * as media from "./media.js";
import * as i18n from "./i18n.js";
import * as player from "./player.js";
import * as theme from "./theme.js";
import popover from "./popover.js";
import progress from "./progress.js";
import * as route from "./route.js";
import mount from "./mount.js";
import range from "./range.js";
import * as css from "./css.js";
import double from "./image/double.js";
import "../../css/common/video.css";
import "../../css/common/image/gallery.css";

i18n.preload("video.unavailable", "chatting.attach.reveal");

export function spoiler(root, value) {
  const element = root.querySelector("video");

  media.spoiler(root, element.src, value);
  if (root.hasAttribute("data-spoiler")) element.pause();
}

const neighbor = (root, offset) => {
  const scope = root?.closest(".chatting-image-group");

  if (!scope) return;
  const list = [...scope.querySelectorAll(".video-thumbnail")].filter((item) =>
    item.querySelector(".video-surface")
  );

  const index = list.indexOf(root);

  return index < 0 ? undefined : list[index + offset];
};

route.register("video", (source) => {
  try {
    const url = new URL(source, location.origin);

    if (url.origin !== location.origin || !/^\/[a-f0-9]{8}\/[a-f0-9]{32}\.bin$/.test(url.pathname))
      return false;
    return view(url.href, undefined, url.searchParams.get("name") || "");
  } catch {
    return false;
  }
});

export function thumbnail(source, name = "", interactive = true, cover) {
  const root = dom.create("span");
  const surface = interactive ? dom.create("button") : null;
  const video = dom.create("video");
  const badge = dom.create("span");
  const error = dom.create("span");
  const symbol = dom.create("span");
  const description = dom.create("span");
  const icon = dom.create(interactive ? "button" : "span");
  const time = dom.create("span");
  const overlay = dom.create("span");
  const play = dom.create("span");
  const loading = progress({ type: "circular", value: 25, show: false });

  root.className = "video-thumbnail";
  if (surface) {
    surface.type = "button";
    surface.className = "video-surface";
    icon.type = "button";
    dom.set(icon, "data-circle", "");
  }

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = source;
  video.dataset.name = name;
  video.dataset.cover = cover === false ? "none" : cover || "";
  if (cover) video.poster = cover;

  video.draggable = false;
  badge.className = "video-badge";
  overlay.className = "video-overlay";
  play.className = "video-play";
  dom.set(icon, "data-icon", "play");
  dom.set(play, "data-icon", "play");
  dom.set(play, "data-circle", "");
  time.textContent = "0:00";
  badge.append(icon, time);
  overlay.append(play, loading.element);
  error.className = "video-error";
  dom.set(symbol, "data-icon", "error");
  dom.set(description, "data-i18n", "video.unavailable");
  description.textContent = i18n.message("video.unavailable");
  error.append(symbol, description);
  error.hidden = true;
  root.append(video, badge, overlay, error);
  if (surface) root.append(surface);

  let pending = false;

  const update = () => {
    const active = !video.paused && !video.ended;

    dom.set(icon, "data-icon", active ? "pause" : "play");
    if (interactive) {
      dom.set(icon, "data-tooltip", active ? "player.pause" : "player.play");
      dom.set(icon, "data-key", "K");
    }

    time.textContent = Number.isFinite(video.duration)
      ? player.clock(Math.ceil(Math.max(0, video.duration - video.currentTime)))
      : "0:00";

    const converting = video.hasAttribute("data-converting");
    const waiting =
      converting || ((pending || !video.paused) && video.readyState < 3 && !video.error);

    root.toggleAttribute("data-failed", Boolean(video.error) && !converting);
    error.hidden = !video.error || converting;
    badge.hidden = Boolean(video.error);
    root.toggleAttribute("data-loading", waiting);
    root.toggleAttribute("data-playing", !video.paused && !video.ended);
    loading.element.hidden = !waiting;
  };

  const off = [
    "loadedmetadata",
    "loadeddata",
    "timeupdate",
    "playing",
    "pause",
    "ended",
    "waiting",
    "canplay",
    "error",
    "conversion"
  ].map((event) => dom.on(video, event, update));

  off.push(media.default(video));
  off.push(
    dom.on(video, "media-change", (event) => {
      const item = event.detail;

      video.dataset.name = item.title || item.name || name;
      video.dataset.cover = item.cover === false ? "none" : item.cover || "";
      video.poster = item.cover || "";
      if (typeof item.spoiler === "boolean") spoiler(root, item.spoiler);

      if (video.paused && !root.hasAttribute("data-active")) video.load();
    })
  );

  if (interactive) {
    const volume = dom.create("button");
    const levels = dom.create("label");
    const slider = dom.create("span");
    const track = dom.create("span");
    const fill = dom.create("span");
    const thumb = dom.create("span");
    const input = dom.create("input");

    volume.type = "button";
    volume.className = "player-volume";
    dom.set(volume, "data-tooltip", "player.volume");
    dom.set(volume, "data-key", "M");
    dom.set(volume, "data-circle", "");
    levels.className = "player-level";
    levels.hidden = true;
    slider.className = "range";
    track.className = "range-track";
    fill.className = "range-fill";
    thumb.className = "range-thumb";
    input.type = "range";
    input.name = "volume";
    input.min = "0";
    input.max = "100";
    input.value = "100";
    track.append(fill);
    slider.append(track, thumb, input);
    levels.append(slider);
    root.append(volume, levels);

    const loudness = () => {
      input.value = String(video.muted ? 0 : Math.round(video.volume * 100));
      dom.set(volume, "data-icon", Number(input.value) ? "volume-high" : "volume-mute");
      range(levels);
    };

    off.push(
      dom.on(input, "input", () => {
        video.volume = Number(input.value) / 100;
        video.muted = video.volume === 0;
      }),
      dom.on(video, "volumechange", loudness),
      dom.on(icon, "click", () => {
        if (!video.paused) video.pause();
        else surface.click();
      })
    );

    loudness();
    off.push(media.volume(video, volume, levels));
    off.push(
      media.keys(root, (key) => {
        if (["k", " "].includes(key)) icon.click();
        else if (["j", "l"].includes(key)) {
          const next = neighbor(root, key === "j" ? -1 : 1);
          const target = next?.querySelector("video");

          if (target?.paused) next.querySelector(".video-badge button")?.click();
        } else return media.command(video, key);
        return true;
      })
    );
  }

  off.push(
    dom.on(video, "loadedmetadata", () => {
      if (!video.poster && video.paused && video.currentTime === 0 && video.duration > 0)
        video.currentTime = Math.min(0.1, video.duration / 2);
    })
  );

  if (interactive)
    off.push(
      dom.on(surface, "click", async () => {
        if (root.hasAttribute("data-spoiler")) {
          spoiler(root, false);
        }

        if (video.paused || video.ended) {
          if (pending) return;

          pending = true;
          media.activate(video);
          if (!root.hasAttribute("data-active")) video.muted = false;

          root.setAttribute("data-active", "");
          update();
          try {
            await video.play();
          } catch {
            root.removeAttribute("data-active");
          } finally {
            pending = false;
            update();
          }
          return;
        }

        if (root.hasAttribute("data-open")) return;

        root.setAttribute("data-open", "");

        try {
          await view(source, root, video.dataset.name);
        } finally {
          root.removeAttribute("data-open");
          root.toggleAttribute("data-active", !video.paused);
        }
      })
    );

  update();
  return {
    root,
    destroy: () => {
      off.forEach((remove) => remove());
      loading.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  };
}

export default async function view(source, anchor, name = "", position = 0) {
  const root = dom.create("div");

  let shared = anchor?.querySelector(".video-surface")
    ? anchor.querySelector("video")
    : media.find(source, "video");
  let video = shared || dom.create("video");
  let home = shared?.parentElement;

  let returned = false;

  const back = dom.create("button");
  const full = dom.create("button");
  const previous = dom.create("button");
  const next = dom.create("button");
  const loading = progress({ type: "circular", value: 25, show: false });
  const off = [];
  const listeners = [];
  const listen = (type, run, options) => {
    const entry = { type, run, options, remove: dom.on(video, type, run, options) };

    listeners.push(entry);
    return () => entry.remove();
  };

  let close;
  let restore;
  let timer;
  let held = false;
  let pointer;
  let rate = 1;
  let control;
  let state = { time: position, paused: false, volume: 1, muted: false };

  for (const event of ["timeupdate", "play", "pause", "volumechange", "ended"])
    off.push(
      listen(event, () => {
        if (root.isConnected)
          state = {
            time: video.currentTime,
            paused: video.paused,
            volume: video.volume,
            muted: video.muted
          };
      })
    );

  root.className = "video-view";
  root.setAttribute("data-controls", "");
  dom.set(root, "data-drag", "none");
  if (!shared) video.src = source;

  video.playsInline = true;
  video.textContent = name;
  if (!shared) root.append(video);

  for (const [button, icon, style] of [
    [back, "arrow", "back"],
    [full, "full", "full"]
  ]) {
    button.type = "button";
    button.className = `image-view-${style}`;
    for (const key of ["data-circle", "data-blur", "data-response"]) dom.set(button, key, "");
    dom.set(button, "data-icon", icon);
  }
  dom.set(back, "data-angle", "left");
  dom.set(full, "data-tooltip", "player.full");
  dom.set(full, "data-key", "F");
  full.hidden = !root.requestFullscreen || !document.fullscreenEnabled;
  root.append(back, full, loading.element);

  const navigate = (offset) =>
    root.dispatchEvent(new CustomEvent("video-step", { detail: offset }));

  const adjacent = () => {
    const left = Boolean(neighbor(home, -1)?.querySelector("video"));
    const right = Boolean(neighbor(home, 1)?.querySelector("video"));

    previous.hidden = next.hidden = !left && !right;
    previous.disabled = !left;
    next.disabled = !right;
  };

  for (const [button, key, offset] of [
    [previous, "previous", -1],
    [next, "next", 1]
  ]) {
    button.type = "button";
    button.className = `image-view-${key}`;
    dom.set(button, "data-icon", "arrow");
    dom.set(button, "data-tooltip", `player.${key}`);
    dom.set(button, "data-key", offset < 0 ? "J" : "L");
    for (const key of ["data-circle", "data-blur", "data-response"]) dom.set(button, key, "");
    if (offset < 0) dom.set(button, "data-angle", "left");

    off.push(dom.on(button, "click", () => navigate(offset)));
    root.append(button);
  }
  adjacent();

  const group = home?.closest(".chatting-image-group");

  if (group) {
    const observer = new MutationObserver(adjacent);

    observer.observe(group, { childList: true, subtree: true });
    off.push(() => observer.disconnect());
  }

  const waiting = (value) => {
    loading.element.hidden = !value;
    root.toggleAttribute("data-loading", value);
  };

  const reset = () => {
    clearTimeout(timer);
    pointer = null;
    if (held) video.playbackRate = rate;

    root.removeAttribute("data-slow");
  };

  const points = new Map();

  let scale = 1;
  let x = 0;
  let y = 0;
  let moved = false;
  let swipe;
  let switching = false;

  const point = (event) => {
    const box = root.getBoundingClientRect();

    return {
      x: event.clientX - box.left - box.width / 2,
      y: event.clientY - box.top - box.height / 2
    };
  };

  const render = () => {
    const box = root.getBoundingClientRect();
    const width = Math.min(box.width, box.height * (video.videoWidth / video.videoHeight || 1));
    const height = Math.min(box.height, box.width / (video.videoWidth / video.videoHeight || 1));
    const horizontal = Math.max(0, (width * scale - box.width) / 2);
    const vertical = Math.max(0, (height * scale - box.height) / 2);

    x = Math.max(-horizontal, Math.min(horizontal, x));
    y = Math.max(-vertical, Math.min(vertical, y));
    css.set(video, { "--video-scale": scale, "--video-x": `${x}px`, "--video-y": `${y}px` });
  };

  const zoom = (value, center) => {
    const next = Math.max(1, Math.min(4, value));
    const ratio = next / scale;

    x = center.x + (x - center.x) * ratio;
    y = center.y + (y - center.y) * ratio;
    scale = next;
    swipe = null;
    css.set(video, { "--video-slide": null });
    reset();
    render();
  };

  let gesture = double(video, { scale: () => scale, point, zoom });

  const cancel = () => {
    const ids = [...points.keys()];

    points.clear();
    swipe = null;
    gesture.cancel();
    reset();
    root.removeAttribute("data-moving");
    css.set(video, { "--video-slide": null });
    for (const id of ids) if (video.hasPointerCapture(id)) video.releasePointerCapture(id);
  };

  const release = (event) => {
    if (!points.delete(event.pointerId)) return;

    const start = swipe;
    const horizontal = start ? event.clientX - start.x : 0;
    const vertical = start ? Math.abs(event.clientY - start.y) : 0;
    const minimum = Math.max(24, Math.min(80, root.clientWidth * 0.2));
    const commit =
      start?.id === event.pointerId &&
      event.type === "pointerup" &&
      !event.defaultPrevented &&
      !held &&
      scale <= 1.01 &&
      Math.abs(horizontal) >= minimum &&
      Math.abs(horizontal) > vertical * 1.5;

    swipe = null;
    root.toggleAttribute("data-moving", points.size > 0);
    css.set(video, { "--video-slide": null });
    if (commit) {
      moved = true;
      navigate(horizontal < 0 ? 1 : -1);
    }
  };

  off.push(
    () => gesture.destroy(),
    listen(
      "wheel",
      (event) => {
        event.preventDefault();
        zoom(scale * Math.exp(-event.deltaY * 0.0015), point(event));
      },
      { passive: false }
    ),
    listen("pointerdown", (event) => {
      if (event.button !== 0) return;

      if (!points.size) {
        moved = false;
        swipe =
          scale <= 1.01
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null }
            : null;
      }

      points.set(event.pointerId, point(event));
      video.setPointerCapture(event.pointerId);
      root.setAttribute("data-moving", "");
      if (points.size > 1) {
        swipe = null;
        css.set(video, { "--video-slide": null });
        reset();
      }
    }),
    listen("pointermove", (event) => {
      const previous = points.get(event.pointerId);

      if (!previous) return;
      const current = point(event);
      const other = [...points.entries()].find(([id]) => id !== event.pointerId)?.[1];

      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(current.x - other.x, current.y - other.y);

        if (before > 0) zoom((scale * after) / before, other);

        moved = true;
      } else if (scale > 1) {
        x += current.x - previous.x;
        y += current.y - previous.y;
        if (Math.hypot(current.x - previous.x, current.y - previous.y) > 1) moved = true;

        reset();
        render();
      } else if (swipe?.id === event.pointerId) {
        const horizontal = event.clientX - swipe.x;
        const vertical = event.clientY - swipe.y;

        if (!swipe.axis && Math.hypot(horizontal, vertical) > 8) {
          swipe.axis = Math.abs(horizontal) > Math.abs(vertical) ? "x" : "y";
          moved = true;
          reset();
        }

        if (swipe.axis === "x") {
          const target = neighbor(home, horizontal < 0 ? 1 : -1)?.querySelector("video");

          css.set(video, { "--video-slide": `${horizontal * (target ? 1 : 0.2)}px` });
        }
      }

      points.set(event.pointerId, current);
    }),
    ...["pointerup", "pointercancel", "lostpointercapture"].map((event) => listen(event, release)),
    dom.on(window, "resize", () => {
      cancel();
      render();
    })
  );

  off.push(
    dom.on(root, "video-step", (event) => {
      if (![-1, 1].includes(event.detail) || !close || returned || switching) return;
      const next = neighbor(home, event.detail);
      const target = next?.querySelector("video");

      if (!target || !next.isConnected) return;
      const volume = video.volume;
      const muted = video.muted;

      switching = true;
      try {
        cancel();
        gesture.destroy();
        listeners.forEach((entry) => entry.remove());
        video.pause();
        returner();
        shared = video = target;
        home = next;
        returned = false;
        scale = 1;
        x = y = 0;
        held = false;
        moved = true;
        gesture = double(video, { scale: () => scale, point, zoom });
        for (const entry of listeners)
          entry.remove = dom.on(video, entry.type, entry.run, entry.options);

        video.volume = volume;
        video.muted = muted;
        begin();
        route.replace("video", ["popover", "video", video.src]);
      } finally {
        switching = false;
      }
    }),
    dom.on(back, "click", async () => {
      if (document.fullscreenElement === root) await document.exitFullscreen().catch(() => {});

      close?.();
    }),
    dom.on(full, "click", () => {
      const action = document.fullscreenElement
        ? document.exitFullscreen()
        : root.requestFullscreen();

      action.catch(() => {});
    }),
    listen("pointerdown", (event) => {
      if (event.button !== 0 || video.paused || scale > 1 || points.size > 1) return;

      held = false;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      rate = video.playbackRate;
      timer = setTimeout(() => {
        held = true;
        video.playbackRate = 0.25;
        root.setAttribute("data-slow", "");
      }, 450);
    }),
    dom.on(window, "pointermove", (event) => {
      if (
        pointer &&
        (event.pointerId !== pointer.id ||
          Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10)
      )
        reset();
    }),
    dom.on(window, "pointerup", reset),
    dom.on(window, "pointercancel", reset),
    dom.on(window, "blur", cancel),
    dom.on(document, "fullscreenchange", () => {
      dom.set(full, "data-icon", document.fullscreenElement === root ? "full-exit" : "full");
      cancel();
      render();
    }),
    listen("contextmenu", (event) => event.preventDefault()),
    listen("click", () => {
      if (held || moved) {
        held = false;
        return;
      }

      root.toggleAttribute("data-controls");
    })
  );

  for (const event of ["waiting", "seeking"]) off.push(listen(event, () => waiting(true)));
  for (const event of ["playing", "canplay", "seeked", "error", "ended"])
    off.push(listen(event, () => waiting(false)));
  waiting(video.readyState < 3 && !video.error);

  function returner() {
    if (!shared || returned) return;

    returned = true;
    reset();
    css.remove(video);
    player.release(video);
    video.controls = false;
    home.removeAttribute("data-open");
    home.toggleAttribute("data-active", !video.paused);
    if (home.isConnected) media.move(video, home, home.firstChild);
    else video.pause();
  }

  function begin(initial = false) {
    if (shared) {
      if (home.hasAttribute("data-spoiler")) spoiler(home, false);

      if (initial && !home.hasAttribute("data-active")) video.muted = false;

      home.setAttribute("data-active", "");
      home.setAttribute("data-open", "");
      media.move(video, root);
    }

    video.playsInline = true;
    video.textContent = video.dataset.name || name;
    video.controls = true;
    control = player.create(video, Boolean(shared));
    mount(control);
    if (!shared && position > 0) video.currentTime = position;

    rate = video.playbackRate;
    state = {
      time: video.currentTime,
      paused: video.paused,
      volume: video.volume,
      muted: video.muted
    };

    render();
    adjacent();
    waiting(video.readyState < 3 && !video.error);

    const current = video;

    current
      .play()
      .then(() => {
        if (current === video && !returned) waiting(current.readyState < 3);
      })
      .catch(() => {
        if (current === video && !returned) waiting(false);
      });
  }

  try {
    await popover({
      anchor,
      route: ["video", source],
      content: root,
      fullscreen: true,
      closing: returner,
      ready: (_, done) => {
        close = done;
        begin(true);
        restore = theme.color(root);
      }
    });

    return state;
  } finally {
    cancel();
    returner();
    css.remove(video);
    off.forEach((remove) => remove());
    if (!shared) {
      returned = true;
      player.release(video);
      video.pause();
      video.removeAttribute("src");
      video.load();
    }

    loading.destroy();
    restore?.();
  }
}
