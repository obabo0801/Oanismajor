import { tts as route } from "#shared/route";

import * as dom from "#common/dom";
import * as storage from "#common/storage";
import { context, level } from "#common/audio";
import string from "#shared/string";
import caption from "./caption.js";

const buffers = new Map();
const logged = new Set();
const requests = new Set();
const sources = new Map();
const volumes = new WeakMap();
const waits = new WeakMap();
const live = new Set();
const calls = new Set();
const utterances = new Map();

let token = 0;

const synth = window.speechSynthesis;

export const busy = () => Boolean(calls.size || live.size || synth?.speaking || synth?.pending);

export const sync = () => {
  for (const gain of sources.values()) {
    gain.gain.value = level("tts", volumes.get(gain));
  }
  for (const [speech, volume] of utterances) speech.volume = level("tts", volume);

  return utterances.size > 0;
};

const key = (text, { lang, pitch, rate, voice, type }) =>
  JSON.stringify({ text, lang, pitch, rate, voice: voice || "", type: type || "" });

const record = (text, options) => {
  const id = key(text, options);

  if (logged.has(id)) {
    return;
  }

  logged.add(id);
  fetch(`/api${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: options.voice, type: "browser" })
  })
    .then((response) => {
      if (!response.ok) {
        logged.delete(id);
      }
    })
    .catch(() => {
      logged.delete(id);
    });
};

const watch = (source, text, options, audio) => {
  const off = [];

  let item;
  let closed = false;
  let finish;

  const done = new Promise((resolve) => {
    finish = resolve;
  });

  const open = () => {
    if (closed || item || options.caption === false) return;

    const value = options.caption;
    const style = value && typeof value === "object" ? value : {};

    try {
      item = caption({ text, ...style, duration: 0 });
    } catch (error) {
      console.error(error);
    }
  };

  const close = (smooth = true) => {
    if (closed) return;

    closed = true;
    off.forEach((remove) => remove());
    item?.close(smooth);
    live.delete(close);
    utterances.delete(source);
    finish();
  };

  const event = audio ? "ended" : "end";

  off.push(dom.on(source, event, close));
  off.push(dom.on(source, "error", close));

  if (audio) {
    off.push(
      dom.on(audio, "statechange", () => {
        if (audio.state === "running") open();
      })
    );
  } else {
    off.push(dom.on(source, "start", open));
  }

  live.add(close);
  waits.set(source, done);

  return { open, close };
};

export const voices = () => synth?.getVoices() || [];

const browser = (text, options, report = true) => {
  if (!synth) {
    return null;
  }

  const { lang, pitch, rate, voice, volume } = options;
  const speech = new SpeechSynthesisUtterance(text);
  const selected = voices().find((item) => item.name === voice);
  const name = selected?.name || "default";

  speech.lang = lang;
  speech.pitch = pitch;
  speech.rate = rate;
  speech.volume = level("tts", volume);
  speech.voice = selected || null;

  const item = watch(speech, text, options);

  utterances.set(speech, volume);

  try {
    synth.speak(speech);
  } catch {
    item.close(false);

    return null;
  }

  if (report) {
    record(text, { ...options, voice: name, type: "browser" });
  }

  return speech;
};

const load = (audio, text, options) => {
  const id = key(text, options);

  if (!buffers.has(id)) {
    const { lang, pitch, rate, voice, type } = options;
    const controller = new AbortController();

    requests.add(controller);

    const request = fetch(`/api${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, pitch, rate, voice, type }),
      signal: controller.signal
    })
      .then((response) => {
        if (response.status === 204) {
          return null;
        }

        if (!response.ok) {
          throw new Error();
        }

        return response.arrayBuffer();
      })
      .then((data) => (data ? audio.decodeAudioData(data) : null))
      .then((buffer) => {
        if (!buffer) buffers.delete(id);

        return buffer;
      })
      .catch((error) => {
        buffers.delete(id);

        throw error;
      })
      .finally(() => {
        requests.delete(controller);
      });

    buffers.set(id, request);
  }

  return buffers.get(id);
};

const remote = async (text, options) => {
  const audio = context();

  if (!audio) {
    return null;
  }

  const id = token;

  let buffer;

  try {
    buffer = await load(audio, text, options);
  } catch {
    return null;
  }

  if (!buffer || id !== token) {
    return null;
  }

  const source = audio.createBufferSource();
  const gain = audio.createGain();

  source.buffer = buffer;
  gain.gain.value = level("tts", options.volume);
  source.connect(gain);
  gain.connect(audio.destination);
  sources.set(source, gain);
  volumes.set(gain, options.volume);
  dom.on(
    source,
    "ended",
    () => {
      if (!sources.delete(source)) {
        return;
      }

      source.disconnect();
      gain.disconnect();
    },
    { once: true }
  );

  const item = watch(source, text, options, audio);

  try {
    source.start();

    if (audio.state === "running") item.open();
  } catch {
    item.close(false);
    sources.delete(source);
    source.disconnect();
    gain.disconnect();

    return null;
  }

  return source;
};

export async function speak(
  text,
  {
    lang = dom.root.lang,
    pitch = 0,
    rate = 1,
    voice = storage.get("voice", ""),
    volume = 1,
    type = "server",
    caption: display = true
  } = {}
) {
  const value = string(text).trim();

  if (!value || storage.get("sound", "true") === "false") return null;

  const options = { lang, pitch, rate, voice, volume, caption: display };
  const id = token;
  const task = {};

  calls.add(task);

  try {
    if (type === "cache") {
      const saved = await remote(value, { ...options, type });

      if (id !== token) return null;

      return saved || browser(value, options, false);
    }

    if (type === "browser") {
      return browser(value, options);
    }

    if (["server", "cloud", "google"].includes(type)) {
      return await remote(value, { ...options, type });
    }

    const cloud = await remote(value, { ...options, type: "cloud" });

    if (id !== token) return null;

    if (cloud) return cloud;

    const local = browser(value, options);

    if (local) return local;

    return await remote(value, { ...options, type: "google" });
  } finally {
    calls.delete(task);
  }
}

export const wait = (source) => waits.get(source) || Promise.resolve();

export function stop() {
  token += 1;
  calls.clear();
  utterances.clear();
  [...live].forEach((close) => close(false));
  synth?.cancel();

  for (const request of requests) {
    request.abort();
  }

  requests.clear();

  for (const [source, gain] of sources) {
    try {
      source.stop();
    } catch {}

    source.disconnect();
    gain.disconnect();
  }

  sources.clear();
}
