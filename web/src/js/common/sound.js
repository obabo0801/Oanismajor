import { on } from "#common/dom";
import { context, level } from "#common/audio";
import { get } from "#common/storage";
import patterns from "#common/pattern";

const file = (name) => new URL(`../../assets/audio/${name}.mp3`, import.meta.url).href;

const backgrounds = Object.freeze({
  loop: file("loop"),
  semenota: file("semenota"),
  sunflower: file("sunflower")
});

const effects = Object.freeze({
  bell: file("bell"),
  choice: file("choice"),
  click: file("click"),
  down: file("down"),
  eoheo: file("eoheo"),
  failure: file("failure"),
  noinput: file("noinput"),
  open: file("open"),
  pop: file("pop"),
  send: { url: file("send"), volume: 0.2 },
  snap: file("snap"),
  success: file("success")
});

const waves = new Set(["sine", "square", "sawtooth", "triangle"]);
const buffers = new Map();
const players = new Map();
const tones = new Set();
const active = new Set();

let track;
let source = "";
let token = 0;

const load = (audio, url) => {
  if (!buffers.has(url)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error();
        }

        return response.arrayBuffer();
      })
      .then((data) => audio.decodeAudioData(data))
      .catch((error) => {
        buffers.delete(url);

        throw error;
      });

    buffers.set(url, request);
  }

  return buffers.get(url);
};

export function beep(
  frequency = 440,
  duration = 80,
  { channel = "system", delay = 0, type = "sine", volume = 1 } = {}
) {
  if (get("sound", "true") === "false") {
    return null;
  }

  const audio = context();

  if (!audio) {
    return null;
  }

  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  duration = Math.max(1, Number(duration) || 80);
  delay = Math.max(0, Number(delay) || 0);

  const length = duration / 1000;
  const start = audio.currentTime + delay / 1000;
  const end = start + length;
  const attack = Math.min(0.01, length / 2);

  oscillator.frequency.setValueAtTime(Math.max(1, Number(frequency) || 440), start);

  oscillator.type = waves.has(type) ? type : "sine";
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level(channel, volume), start + attack);
  gain.gain.linearRampToValueAtTime(0, end);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  tones.add(oscillator);
  on(
    oscillator,
    "ended",
    () => {
      tones.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    },
    { once: true }
  );

  oscillator.start(start);
  oscillator.stop(end);

  return oscillator;
}

const beeps = (name, options = {}) => {
  const pattern = patterns[name];

  if (!pattern) {
    return [];
  }

  let delay = Number(options.delay) || 0;

  return pattern
    .map(([frequency, duration, gap]) => {
      const tone = beep(frequency, duration, { ...options, delay });

      delay += duration + gap;

      return tone;
    })
    .filter(Boolean);
};

const effect = async (url, { channel = "system", delay = 0, volume = 1 } = {}) => {
  if (get("sound", "true") === "false") {
    return null;
  }

  const audio = context();

  if (!audio || !url) {
    return null;
  }

  const id = token;

  let buffer;

  try {
    buffer = await load(audio, url);
  } catch {
    return null;
  }

  if (id !== token || get("sound", "true") === "false") {
    return null;
  }

  const player = audio.createBufferSource();
  const gain = audio.createGain();

  player.buffer = buffer;
  gain.gain.value = level(channel, volume);
  player.connect(gain);
  gain.connect(audio.destination);
  players.set(player, gain);
  on(
    player,
    "ended",
    () => {
      if (!players.delete(player)) {
        return;
      }

      player.disconnect();
      gain.disconnect();
    },
    { once: true }
  );

  const start = audio.currentTime + Math.max(0, Number(delay) || 0) / 1000;

  player.start(start);

  return player;
};

export async function play(name, { overlap = false, ...options } = {}) {
  if (get("sound", "true") === "false" || (overlap && active.has(name))) {
    return null;
  }

  const release = () => {
    if (overlap) {
      active.delete(name);
    }
  };

  if (overlap) {
    active.add(name);
  }

  const id = token;
  const preset = effects[name];
  const url = typeof preset === "string" ? preset : preset?.url;

  if (url) {
    const volume = preset?.volume ?? 1;
    const player = await effect(url, { volume, ...options });

    if (player) {
      on(player, "ended", release, { once: true });

      return player;
    }

    if (id !== token) {
      release();

      return null;
    }
  }

  const result = beeps(name, options);

  if (!result.length) {
    release();

    return result;
  }

  let count = result.length;

  for (const tone of result) {
    on(
      tone,
      "ended",
      () => {
        count -= 1;

        if (!count) {
          release();
        }
      },
      { once: true }
    );
  }

  return result;
}

const clearTrack = (player) => {
  if (track !== player) {
    return;
  }

  track = undefined;
  source = "";
};

const reset = () => {
  if (!track) {
    return false;
  }

  const player = track;

  track = undefined;
  source = "";
  player.pause();

  try {
    player.currentTime = 0;
  } catch {}

  return true;
};

export function playing(name) {
  if (!track || track.paused) {
    return false;
  }

  if (!name) {
    return true;
  }

  return source === (backgrounds[name] || name);
}

export function halt(name) {
  if (name && source !== (backgrounds[name] || name)) {
    return false;
  }

  return reset();
}

export function music(name, { loop = false, volume = 1 } = {}) {
  if (typeof Audio === "undefined" || get("sound", "true") === "false") {
    reset();

    return null;
  }

  const url = backgrounds[name] || name;

  if (!url) {
    return null;
  }

  if (track && source === url) {
    const player = track;

    player.loop = loop;
    player.volume = level("media", volume);

    if (player.paused) {
      player.play().catch(() => clearTrack(player));
    }

    return player;
  }

  reset();

  const player = new Audio(url);

  player.loop = loop;
  player.volume = level("media", volume);
  track = player;
  source = url;
  on(player, "ended", () => clearTrack(player), { once: true });

  on(player, "error", () => clearTrack(player), { once: true });
  player.play().catch(() => clearTrack(player));

  return player;
}

export function stop() {
  token += 1;
  active.clear();
  reset();

  for (const tone of tones) {
    try {
      tone.stop();
    } catch {}
  }

  tones.clear();

  for (const [player, gain] of players) {
    try {
      player.stop();
    } catch {}

    player.disconnect();
    gain.disconnect();
  }

  players.clear();
}

export default Object.freeze({ beep, music, playing, play, stop, halt });
