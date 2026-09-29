import { TextToSpeechClient } from "@google-cloud/text-to-speech";

import string from "#shared/string";
import cache, { find } from "#service/tts/cache";
import create from "#service/cloud";

const host = "https://translate.google.com";
const timeout = 5000;
const regions = { en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const mode = (process.env.TTS || "").trim().toLowerCase();
const enabled = ["login", "json"].includes(mode);

let client;
let retry = 0;

const models = new Map();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const within = async (promise) => {
  let timer;

  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error());
    }, timeout);
  });

  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
};

const language = (value) => {
  const lang = string(value).trim();

  if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(lang)) {
    return "ko-KR";
  }

  const [base, region] = lang.split("-");
  const code = base.toLowerCase();

  if (!region) {
    return regions[code] || code;
  }

  return `${code}-${region.toUpperCase()}`;
};

const prepare = (value) => {
  const rate = Number(value.rate);
  const pitch = Number(value.pitch);
  const voice = string(value.voice).match(/^[a-z0-9-]{1,100}$/i)?.[0];

  return {
    text: value.text,
    lang: language(value.lang),
    rate: Number.isFinite(rate) ? clamp(rate, 0.25, 2) : 1,
    pitch: Number.isFinite(pitch) ? clamp(pitch, -20, 20) : 0,
    voice
  };
};

const parts = (text) => {
  const chars = [...text];
  const result = [];

  while (chars.length) {
    result.push(chars.splice(0, 180).join(""));
  }

  return result;
};

const connect = () => {
  if (!client) {
    const pending = create(TextToSpeechClient, mode);

    client = pending;
    void pending.catch(() => {
      if (client === pending) client = undefined;
    });
  }

  return client;
};

export const voices = async (lang) => {
  if (!enabled) return [];

  const code = language(lang);
  const saved = models.get(code);

  if (saved && saved.expires > Date.now()) return saved.value;

  const value = within(
    connect().then((target) => target.listVoices({ languageCode: code }, { timeout }))
  )
    .then(([result]) =>
      (result.voices || [])
        .filter((voice) => voice.name)
        .map((voice) => ({
          name: voice.name,
          gender:
            { 1: "male", 2: "female", 3: "neutral" }[voice.ssmlGender] ||
            String(voice.ssmlGender || "neutral").toLowerCase()
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    .catch((error) => {
      models.delete(code);
      throw error;
    });

  models.set(code, { value, expires: Date.now() + 3_600_000 });
  return value;
};

const cloud = async (value) => {
  const target = await within(connect());

  const chirp = value.voice?.includes("-Chirp3-HD-");
  const [response] = await target.synthesizeSpeech(
    {
      input: { text: value.text },
      voice: { languageCode: value.lang, ...(value.voice && { name: value.voice }) },
      audioConfig: {
        audioEncoding: "MP3",
        ...(!chirp && { speakingRate: value.rate, pitch: value.pitch })
      }
    },
    { timeout }
  );

  const audio = response.audioContent;

  if (!audio) {
    throw new Error();
  }

  return typeof audio === "string" ? Buffer.from(audio, "base64") : Buffer.from(audio);
};

const google = async (value) => {
  const audio = [];

  for (const text of parts(value.text)) {
    const url = new URL("/translate_tts", host);

    url.search = new URLSearchParams({
      client: "tw-ob",
      ie: "UTF-8",
      q: text,
      tl: value.lang.split("-")[0],
      ttsspeed: value.rate < 0.75 ? "0.24" : "1"
    });

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(timeout)
    });
    const type = response.headers.get("content-type");

    if (!response.ok || !type?.startsWith("audio/")) {
      throw new Error();
    }

    audio.push(Buffer.from(await response.arrayBuffer()));
  }

  return Buffer.concat(audio);
};

const fromGoogle = (request, uid, time) =>
  cache("google", request, { create: () => google(request), uid, time });

export default async function synthesize(value, options) {
  const { uid, time, type } = options;
  const request = prepare(value);

  if (type === "cache") {
    const saved = await find("cloud", request);

    return saved || find("google", request);
  }

  if (type !== "google") {
    const saved = await find("cloud", request);

    if (saved) {
      return saved;
    }
  }

  if (type === "google") {
    return fromGoogle(request, uid, time);
  }

  if (enabled && Date.now() >= retry) {
    try {
      return await cache("cloud", request, { create: () => cloud(request), uid, time });
    } catch (error) {
      if (error?.code === "55P03") {
        throw error;
      }

      if (client) void client.then((target) => target.close()).catch(() => {});

      client = undefined;
      retry = Date.now() + 60_000;
    }
  }

  return type === "cloud" ? null : fromGoogle(request, uid, time);
}
