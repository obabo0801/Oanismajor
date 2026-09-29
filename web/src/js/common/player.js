import * as dom from "./dom.js";
import * as i18n from "./i18n.js";
import range from "./range.js";
import * as subtitles from "./caption.js";
import api from "./api.js";
import * as media from "./media.js";
import popover from "./popover.js";
import * as route from "./route.js";
import mount from "./mount.js";
import { chatting } from "#shared/route";
import "../../css/common/player.css";
import "../../css/common/image.css";

const players = new Map();
const tracks = new Map();

let observer;

const address = (source) => {
  const url = new URL(source, location.href);

  return url.origin === location.origin && /^\/[a-f0-9]{8}\/[a-f0-9]{32}\.bin$/.test(url.pathname)
    ? `${url.pathname}${url.search}`
    : "";
};

route.register("audio", (source) => {
  try {
    const url = address(source);

    if (!url) return false;
    return open({ url, name: new URL(url, location.origin).searchParams.get("name") || "" });
  } catch {
    return false;
  }
});

i18n.preload(
  "player.play",
  "player.pause",
  "player.seek",
  "player.error",
  "player.volume",
  "player.previous",
  "player.next",
  "player.full",
  "player.mute",
  "assets.openAudio",
  "chatting.audio.preview"
);

export const clock = (value) => {
  if (!Number.isFinite(value) || value < 0) return "--:--";
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);

  return `${hours ? `${hours}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(hours ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export function create(audio, shared = false) {
  if (players.has(audio) || !audio.parentNode) return;
  const root = dom.create("div");
  const button = dom.create("button");
  const caption = dom.create("span");
  const seek = dom.create("label");
  const name = dom.create("span");
  const slider = dom.create("div");
  const track = dom.create("span");
  const fill = dom.create("span");
  const thumb = dom.create("span");
  const input = dom.create("input");
  const time = dom.create("output");
  const total = dom.create("output");
  const error = dom.create("span");
  const off = [];

  if (!shared) off.push(media.default(audio));

  const video = audio.tagName === "VIDEO";
  const speech = !video && audio.hasAttribute("data-stt");
  const controller = new AbortController();
  const wave = dom.create("canvas");
  const session = navigator.mediaSession;

  const artwork = (source) => {
    root.querySelector(".player-artwork")?.remove();
    root.toggleAttribute("data-cover", Boolean(source));
    if (!source) return;
    const interactive = !audio.closest(".audio-view");
    const button = dom.create(interactive ? "button" : "div");
    const image = dom.create("img");

    if (interactive) button.type = "button";

    button.className = "player-artwork";
    image.className = "player-cover";
    image.src = source;
    image.alt = i18n.message("assets.openAudio");
    image.draggable = false;
    button.append(image);
    if (interactive)
      dom.on(button, "click", (event) => {
        event.stopPropagation();
        void open({ url: audio.src }, root);
      });

    root.append(button);
  };

  let metadata;

  const describe = () => {
    if (!session || typeof MediaMetadata === "undefined") return;

    const title = root.querySelector(".player-name")?.textContent;
    const cover = root.querySelector(".player-cover");

    metadata = title
      ? new MediaMetadata({
          title,
          artist: audio.dataset.artist || "",
          artwork: cover ? [{ src: cover.src }] : []
        })
      : null;

    session.metadata = metadata;
  };

  const release = () => {
    if (metadata && session?.metadata === metadata) session.metadata = null;

    metadata = null;
  };

  off.push(dom.on(audio, "play", describe));
  for (const event of ["ended", "emptied", "error"]) off.push(dom.on(audio, event, release));
  off.push(release);
  off.push(
    dom.on(audio, "media-change", (event) => {
      const item = event.detail;
      const title = root.querySelector(".player-name");

      audio.dataset.name = item.title || item.name;
      if (title) title.textContent = audio.dataset.name;

      if (item.artist !== undefined) audio.dataset.artist = item.artist;

      const artist = root.querySelector(".player-artist");

      if (artist) {
        artist.textContent = audio.dataset.artist || "";
        artist.hidden = !artist.textContent;
      }

      audio.dataset.cover = item.cover === false ? "none" : item.cover || "";
      artwork(item.cover || "");

      if (metadata && session?.metadata === metadata) describe();
    })
  );

  let samples;

  let frame;
  let moving = false;
  let probing = false;
  let duration = NaN;
  let closed = false;
  let failed = false;

  root.className = `player ${audio.className}`.trim();
  root.toggleAttribute("data-video", video);
  root.toggleAttribute("data-stt", speech);
  audio.className = "";
  dom.set(root, "data-background", "");
  button.type = "button";
  button.className = "player-control";
  dom.set(button, "data-key", "K");
  caption.className = "player-label";
  button.append(caption);
  for (const key of ["data-response", "data-circle", "data-shadow"]) dom.set(button, key, "");
  seek.className = "player-seek";
  name.className = "player-label";
  name.textContent = i18n.message("player.seek");
  dom.set(name, "data-i18n", "player.seek");
  slider.className = "range";
  track.className = "range-track";
  fill.className = "range-fill";
  thumb.className = "range-thumb";
  input.type = "range";
  input.name = "position";
  input.min = "0";
  input.max = "1000";
  input.step = "any";
  input.value = "0";
  time.className = "player-time";
  total.className = "player-total";
  error.className = "player-error";
  error.textContent = i18n.message("player.error");
  dom.set(error, "data-i18n", "player.error");
  error.hidden = true;
  track.append(fill);
  slider.append(track, thumb, input);
  seek.append(name, slider);
  if (video || !speech) seek.append(time, total);

  const volume = dom.create("button");
  const label = dom.create("span");

  volume.className = "player-volume";
  volume.type = "button";
  dom.set(volume, "data-tooltip", "player.volume");
  dom.set(volume, "data-key", "M");
  label.className = "player-label";
  label.textContent = i18n.message("player.volume");
  dom.set(label, "data-i18n", "player.volume");
  volume.append(label);
  for (const key of ["data-response", "data-circle"]) dom.set(volume, key, "");

  const levels = !speech ? seek.cloneNode(true) : null;
  const level = levels?.querySelector("input");

  if (levels) {
    levels.className = "player-level";
    levels.hidden = true;
    levels.querySelectorAll("output").forEach((element) => element.remove());

    const name = levels.querySelector(".player-label");

    name.textContent = i18n.message("player.volume");
    dom.set(name, "data-i18n", "player.volume");
    level.name = "volume";
    level.max = "100";
    level.value = String(Math.round(audio.volume * 100));
    root.append(levels);
    off.push(
      dom.on(level, "input", () => {
        audio.volume = Number(level.value) / 100;
        audio.muted = audio.volume === 0;
      })
    );
  }

  const loudness = () => {
    const value = audio.muted ? 0 : Math.round(audio.volume * 100);

    if (level) {
      level.value = String(value);
      range(levels);
    }

    dom.set(
      volume,
      "data-icon",
      value ? (value > 50 ? "volume-high" : "volume-low") : "volume-mute"
    );
  };

  off.push(
    dom.on(volume, "click", () => {
      if (levels) return;

      if (audio.muted || audio.volume === 0) {
        if (audio.volume === 0) audio.volume = 1;

        audio.muted = false;
      } else audio.muted = true;

      loudness();
    })
  );

  off.push(dom.on(audio, "volumechange", loudness));
  if (levels) off.push(media.volume(audio, volume, levels));

  audio.before(root);
  if (shared && root.moveBefore && audio.isConnected) root.moveBefore(audio, null);
  else root.append(audio);

  root.append(button, seek, error);
  if (!speech) root.append(volume);

  if (!video) {
    if (speech) root.append(time);

    if (!speech) {
      const info = dom.create("div");
      const title = dom.create("span");
      const artist = dom.create("span");

      info.className = "player-info";
      title.className = "player-name";
      title.textContent =
        audio.dataset.name ||
        new URL(audio.src, location.href).searchParams.get("name") ||
        i18n.message("chatting.audio.preview");

      artist.className = "player-artist";
      artist.textContent = audio.dataset.artist || "";
      artist.hidden = !artist.textContent;
      info.append(title, artist);
      root.append(info);

      const scope = audio.closest(".chatting-image-group");
      const message = audio.closest(".chatting-message") || root;
      const previous = dom.create("button");
      const next = dom.create("button");
      const entry = { root, scope, message };

      tracks.set(audio, entry);

      const adjacent = (offset) => {
        const list = [...tracks.entries()]
          .filter(
            ([item, track]) =>
              item.isConnected && track.scope === scope && (scope || item === audio)
          )
          .sort((a, b) => {
            const position = a[1].message.compareDocumentPosition(b[1].message);

            return position & Node.DOCUMENT_POSITION_FOLLOWING
              ? -1
              : position & Node.DOCUMENT_POSITION_PRECEDING
                ? 1
                : 0;
          });

        return list[list.findIndex(([item]) => item === audio) + offset]?.[0];
      };

      entry.update = () => {
        if (previous.disabled !== !adjacent(-1)) previous.disabled = !adjacent(-1);

        if (next.disabled !== !adjacent(1)) next.disabled = !adjacent(1);
      };

      for (const [control, key, offset] of [
        [previous, "previous", -1],
        [next, "next", 1]
      ]) {
        control.type = "button";
        control.className = `player-${key}`;
        dom.set(control, "data-tooltip", `player.${key}`);
        dom.set(control, "data-key", offset < 0 ? "J" : "L");
        dom.set(control, "data-icon", "skip");
        if (offset < 0) dom.set(control, "data-angle", "left");
        for (const key of ["data-circle", "data-response"]) dom.set(control, key, "");
        const label = dom.create("span");

        label.className = "player-label";
        dom.set(label, "data-i18n", `player.${key}`);
        label.textContent = i18n.message(`player.${key}`);
        control.append(label);
        off.push(
          dom.on(control, "click", () => {
            const target = adjacent(offset);

            if (!target) return;
            const viewer = root.closest(".audio-view");

            if (viewer) viewer.dispatchEvent(new CustomEvent("player-switch", { detail: target }));
            else if (root.closest(".chatting-preview"))
              void open({ url: target.src }, tracks.get(target)?.root);

            media.activate(target);
            target.play().catch(() => {});
          })
        );

        root.append(control);
      }
      entry.update();
      off.push(() => tracks.delete(audio));

      const cover = (source) => {
        if (!source || closed) return;

        artwork(source);
        if (metadata && session?.metadata === metadata) describe();
      };

      if (audio.dataset.cover) {
        if (audio.dataset.cover !== "none") cover(audio.dataset.cover);
      } else {
        const observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;

          observer.disconnect();
          void media.resolve(audio.src, "cover", controller.signal).then((source) => {
            if (!audio.dataset.cover) cover(source);
          });
        });

        observer.observe(root);
        off.push(() => observer.disconnect());
      }
    }
  }

  audio.controls = false;
  off.push(
    media.keys(root, (key) => {
      if (["k", " "].includes(key)) button.click();
      else if (["j", "l"].includes(key)) {
        if (video)
          root.dispatchEvent(
            new CustomEvent("video-step", { bubbles: true, detail: key === "j" ? -1 : 1 })
          );
        else root.querySelector(key === "j" ? ".player-previous" : ".player-next")?.click();
      } else if (key === "f")
        root.closest(".audio-view, .video-view")?.querySelector(".image-view-full")?.click();
      else return media.command(audio, key);
      return true;
    })
  );

  audio.hidden = !video;
  audio.preload = "metadata";
  range(root);
  loudness();

  const draw = () => {
    if (!samples || closed) return;
    const context = wave.getContext("2d");
    const colors = getComputedStyle(root);
    const progress = Number(input.value) / 1000;

    context.clearRect(0, 0, wave.width, wave.height);
    for (const [color, width] of [
      ["--mute", wave.width],
      ["--focus", wave.width * progress]
    ]) {
      context.save();
      context.beginPath();
      context.rect(0, 0, width, wave.height);
      context.clip();
      context.fillStyle = colors.getPropertyValue(color).trim();
      samples.forEach((value, index) => {
        const height = Math.max(4, value * 88);

        context.beginPath();
        context.roundRect(index * 20 + 4, (96 - height) / 2, 12, height, 6);
        context.fill();
      });

      context.restore();
    }
  };

  if (speech && window.OfflineAudioContext) {
    wave.className = "player-wave";
    wave.width = 1200;
    wave.height = 96;
    slider.append(wave);

    const load = () =>
      fetch(audio.currentSrc || audio.src, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Audio unavailable");
          return response.arrayBuffer();
        })
        .then((buffer) => new OfflineAudioContext(1, 1, 8000).decodeAudioData(buffer))
        .then((buffer) => {
          if (closed) return;
          const channel = buffer.getChannelData(0);
          const step = Math.max(1, Math.floor(channel.length / 60));

          samples = Array.from({ length: 60 }, (_, index) => {
            let peak = 0;

            for (
              let offset = index * step;
              offset < Math.min((index + 1) * step, channel.length);
              offset += 1
            )
              peak = Math.max(peak, Math.abs(channel[offset]));
            return peak;
          });

          const maximum = Math.max(...samples, 0.01);

          samples = samples.map((value) => value / maximum);
          root.setAttribute("data-wave", "");
          draw();
        })
        .catch(() => {});

    const visible = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;

      visible.disconnect();
      void load();
    });

    visible.observe(root);
    off.push(() => visible.disconnect());
  }

  const position = () => (Number(input.value) / 1000) * duration;

  const paint = () => {
    if (!moving && !probing) {
      input.value = String(
        input.disabled ? 0 : audio.ended ? 1000 : (audio.currentTime / duration) * 1000
      );

      range(seek);
    }

    const current = probing ? 0 : moving ? position() : audio.currentTime;

    time.textContent = clock(!speech ? current : Math.ceil(Math.max(0, duration - current)));
    draw();

    total.textContent = clock(video ? duration : Math.ceil(duration));
  };

  const update = () => {
    if (Number.isFinite(audio.duration)) duration = audio.duration;
    const playing = !audio.paused && !audio.ended;

    dom.set(button, "data-icon", playing ? "pause" : "play");
    dom.set(button, "data-tooltip", playing ? "player.pause" : "player.play");
    caption.textContent = i18n.message(playing ? "player.pause" : "player.play");

    root.toggleAttribute("data-playing", playing);

    const converting = audio.hasAttribute("data-converting");

    root.toggleAttribute("data-error", !converting && (Boolean(audio.error) || failed));
    error.hidden = converting || (!audio.error && !failed);
    button.disabled = Boolean(audio.error);
    input.disabled = !Number.isFinite(duration) || duration <= 0 || Boolean(audio.error);

    paint();
  };

  const animate = () => {
    cancelAnimationFrame(frame);
    if (closed || audio.paused || audio.ended || document.hidden) return;

    paint();
    frame = requestAnimationFrame(animate);
  };

  off.push(dom.on(audio, "playing", animate));
  off.push(dom.on(document, "visibilitychange", animate));
  off.push(() => cancelAnimationFrame(frame));

  let pending;
  let bound = false;
  let cues = [];

  const prepare = async () => {
    if (!speech || bound || closed) return;

    if (audio.dataset.message && !audio.dataset.caption) {
      const query = new URLSearchParams(audio.dataset.room ? { room: audio.dataset.room } : {});

      pending ||= api(
        chatting + "/" + encodeURIComponent(audio.dataset.message) + "/caption?" + query,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) }
      );

      const response = await pending;

      pending = null;
      if (closed) return;

      if (response.ok) {
        audio.dataset.channel = response.data?.channel || "media";
        media.sync();
        audio.dataset.caption = response.data?.text || audio.dataset.caption || "";
        cues = response.data?.cues || [];
      }
    }

    if (audio.dataset.caption && !bound) {
      bound = true;
      off.push(subtitles.bind(audio, audio.dataset.caption, cues));
    }
  };

  if (audio.dataset.caption) void prepare();

  off.push(
    dom.on(audio, "play", () => {
      void prepare();
    })
  );

  off.push(
    dom.on(button, "click", async () => {
      if (!audio.paused) return audio.pause();

      media.activate(audio);
      for (const item of players.keys()) if (item !== audio) item.pause();
      if (probing || audio.ended) audio.currentTime = 0;

      probing = false;
      failed = false;
      try {
        button.disabled = true;
        await prepare();
        if (closed) return;

        await audio.play();
      } catch {
        if (!closed) failed = true;
      }
      if (!closed) update();
    })
  );

  off.push(
    dom.on(input, "input", () => {
      moving = true;
      time.textContent = clock(
        !speech ? position() : Math.ceil(Math.max(0, duration - position()))
      );

      draw();
    })
  );

  off.push(
    dom.on(input, "change", () => {
      if (!input.disabled) audio.currentTime = position();

      moving = false;
      update();
    })
  );

  off.push(
    dom.on(input, "pointercancel", () => {
      moving = false;
      update();
    })
  );

  off.push(
    dom.on(audio, "loadedmetadata", () => {
      if (audio.duration === Infinity && audio.paused && audio.currentTime === 0) {
        probing = true;
        audio.currentTime = 1e10;
      }

      update();
    })
  );

  off.push(
    dom.on(audio, "seeked", () => {
      if (probing) {
        if (Number.isFinite(audio.currentTime) && audio.currentTime < 1e10)
          duration = audio.currentTime;

        probing = false;
        audio.currentTime = 0;
      }

      update();
    })
  );

  off.push(
    dom.on(audio, "emptied", () => {
      duration = NaN;
      probing = false;
      failed = false;
      update();
    })
  );

  for (const event of [
    "timeupdate",
    "durationchange",
    "play",
    "pause",
    "ended",
    "error",
    "conversion"
  ])
    off.push(dom.on(audio, event, update));
  players.set(audio, () => {
    closed = true;
    controller.abort();
    off.forEach((remove) => remove());
    if (!shared) audio.pause();

    players.delete(audio);
    audio.className = root.className.replace(/^player\s*/, "");
    audio.hidden = false;
    audio.controls = true;
    if (shared && root.parentElement?.moveBefore && audio.isConnected) {
      root.parentElement.moveBefore(audio, root);
      root.remove();
    } else root.replaceWith(audio);
  });

  update();
  return root;
}

export const release = (audio) => players.get(audio)?.();

export async function open(item, anchor) {
  const root = dom.create("div");
  const full = dom.create("button");
  const back = dom.create("button");
  const off = [];
  const url = address(item.url);
  const state = url ? ["audio", url] : undefined;

  let close;
  let restore;

  root.className = "audio-view";
  dom.set(root, "data-drag", "none");

  for (const [button, icon, name] of [
    [back, "arrow", "back"],
    [full, "full", "full"]
  ]) {
    button.type = "button";
    button.className = `image-view-${name}`;
    dom.set(button, "data-blur", "");
    dom.set(button, "data-icon", icon);
    dom.set(button, "data-circle", "");
    dom.set(button, "data-response", "");
  }

  dom.set(back, "data-angle", "left");
  dom.set(full, "data-tooltip", "player.full");
  dom.set(full, "data-key", "F");
  full.hidden = !document.fullscreenEnabled || !root.requestFullscreen;
  root.append(back, full);

  off.push(
    dom.on(back, "click", async () => {
      if (document.fullscreenElement === root) await document.exitFullscreen().catch(() => {});

      close?.();
    }),
    dom.on(full, "click", () => {
      const action =
        document.fullscreenElement === root ? document.exitFullscreen() : root.requestFullscreen();

      action.catch(() => {});
    }),
    dom.on(document, "fullscreenchange", () => {
      const active = document.fullscreenElement === root;

      dom.set(full, "data-icon", active ? "full-exit" : "full");
    })
  );

  const attached = anchor?.matches(".player") ? anchor : anchor?.querySelector(".player");
  const current = media.find(item.url, "audio", item.record?.token || item.record?.url);
  const original = attached || current?.closest(".player");
  const existing = original?.querySelector("audio");
  const audio = existing || dom.create("audio");

  const take = (target) => {
    restore?.();

    const audio = target.querySelector("audio");
    const update = () =>
      audio.dispatchEvent(
        new CustomEvent("media-change", {
          detail: {
            title: audio.dataset.name,
            artist: audio.dataset.artist || "",
            cover:
              audio.dataset.cover === "none"
                ? false
                : audio.dataset.cover || target.querySelector(".player-cover")?.src
          }
        })
      );
    const release = media.borrow(target, root);

    update();
    restore = () => {
      release();
      update();
    };
  };

  off.push(
    dom.on(root, "player-switch", (event) => {
      const target = tracks.get(event.detail)?.root;

      if (!target) return;

      take(target);

      const url = address(event.detail.src);

      if (url) route.replace("audio", ["popover", "audio", url]);
    })
  );

  if (!existing) {
    audio.src = item.url;
    audio.dataset.channel = item.channel || "media";
    audio.controls = true;
    audio.dataset.name = item.title || item.name || "";
    audio.dataset.artist = item.artist || "";
    audio.dataset.message = item.record?.token || item.record?.url || "";
    if (item.size != null) audio.dataset.size = String(item.size);

    if (item.cover !== undefined) audio.dataset.cover = item.cover === false ? "none" : item.cover;

    root.append(audio);
  }

  try {
    await popover({
      anchor,
      route: state,
      title: "",
      fullscreen: true,
      content: root,
      ready: (_, done) => {
        close = done;
        if (existing) take(original);
        else {
          const control = create(audio);

          if (control) mount(control);
        }
      },
      closing: () => {
        restore?.();
        restore = null;
      }
    });
  } finally {
    restore?.();
    off.forEach((remove) => remove());
    if (!existing) {
      release(audio);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }
}

export default function player(root = document) {
  dom.find("audio[controls]", root).forEach((audio) => create(audio));
  if (!observer) {
    observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element)
            dom.find("audio[controls]", node).forEach((audio) => create(audio));
      for (const [audio, close] of players) if (!audio.isConnected) close();
      for (const entry of tracks.values()) entry.update();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
}
