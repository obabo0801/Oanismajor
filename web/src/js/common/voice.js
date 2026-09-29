import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import device from "#common/device";
import sound from "#common/sound";

import * as server from "#common/voice/server";
import * as audio from "#common/voice/audio";
import * as media from "#common/voice/media";
import * as speech from "#common/voice/speech";
import * as view from "#common/voice/view";

export { meter } from "#common/voice/audio";
export { microphones } from "#common/voice/media";

const regions = { en: "en-US", ja: "ja-JP", ko: "ko-KR" };

i18n.preload("voice.listening", "voice.processing");

let session;

const language = () => {
  const value = dom.root.lang || navigator.language || "ko";
  const lang = value.toLowerCase();
  const base = lang.split("-")[0];

  return regions[base] || lang;
};

const record = async (options, live = false) => {
  const { lang, deviceId, target, signal, stop } = options;
  const stream = await media.microphone(deviceId);

  let release = () => {};
  let saved;
  let heard;

  try {
    if (signal.aborted || stop.aborted) {
      return { text: "", confidence: 0 };
    }

    release = view.visualize(target, stream);

    saved = media.record(stream);
    heard = live
      ? speech.listen({
          lang,
          stream,
          target,
          signal,
          keep: true,
          change: (text) => view.preview(target, text)
        })
      : null;

    await audio.silence(stream, signal, stop);

    heard?.stop();

    if (saved.recorder.state !== "inactive") {
      saved.recorder.stop();
    }

    const [blob, recognized] = await Promise.all([
      saved.done,
      heard?.done || { text: "", confidence: 0 }
    ]);

    media.close(stream);

    if (signal.aborted || !blob.size) {
      return { text: "", confidence: 0 };
    }

    view.status(target, "voice.processing");

    const pitch = await audio.analyze(blob);
    const result = await server.upload(blob, { lang, text: recognized.text, pitch, signal });

    return { text: result.text, confidence: result.confidence ?? recognized.confidence };
  } finally {
    heard?.abort();
    try {
      if (saved?.recorder.state === "recording") saved.recorder.stop();
    } finally {
      release();
      media.close(stream);
    }
  }
};

const match = (text, keywords, lang) => {
  const value = text.toLocaleLowerCase(lang);

  return keywords.some((keyword) => {
    if (typeof keyword !== "string") {
      return false;
    }

    const word = keyword.trim().toLocaleLowerCase(lang);

    return word && value.includes(word);
  });
};

export const stop = () => {
  if (!session) {
    return null;
  }

  session.stop();

  return session.done;
};

export default async function voice(keywords, options = {}) {
  if (options instanceof Element) {
    options = { target: options };
  } else if (typeof options === "string") {
    options = { deviceId: options };
  }

  if (session) {
    session.stop();

    return session.done;
  }

  const controller = new AbortController();
  const stopper = new AbortController();
  const { signal } = controller;
  const stop = stopper.signal;

  let finish;
  let output = { action: "none" };

  const done = new Promise((resolve) => {
    finish = resolve;
  });

  session = {
    stop: () => {
      if (stopper.signal.aborted) {
        controller.abort();

        return;
      }

      stopper.abort();
    },
    done
  };

  const complete = (value) => {
    output = value;

    return value;
  };

  try {
    const { deviceId, target } = options;
    const allowed = await media.authorize(deviceId, signal, stop);

    if (!allowed) {
      if (!signal.aborted && !stop.aborted) {
        sound.play("failure");
      }

      return complete({ action: "none" });
    }

    sound.play("open");

    const lang = language();
    const base = lang.split("-")[0];
    const words = Array.isArray(keywords) ? keywords : keywords?.[lang] || keywords?.[base] || [];
    const state = device();
    const input = { lang, deviceId, target, signal, stop };

    let result;

    if (
      state.window &&
      speech.supported &&
      window.MediaRecorder &&
      navigator.mediaDevices?.getUserMedia
    ) {
      result = await record(input, true);
    } else if (
      (await server.available()) &&
      window.MediaRecorder &&
      navigator.mediaDevices?.getUserMedia
    ) {
      result = await record(input);
    } else {
      result = await speech.native(input);

      if (result.text) {
        await server.report(lang, result.text, signal);
      }
    }

    if (signal.aborted) {
      return complete({ action: "none" });
    }

    if (!result.text) {
      sound.play("noinput");

      return complete({ action: "none" });
    }

    if (words.length && !match(result.text, words, lang)) {
      sound.play("failure");

      return complete({ action: "none" });
    }

    sound.play("success");

    return complete({
      action: !words.length || result.confidence >= 0.8 ? "run" : "ask",
      text: result.text
    });
  } catch {
    if (!signal.aborted) {
      sound.play("failure");
    }

    return complete({ action: "none" });
  } finally {
    finish(output);

    if (session?.done === done) {
      session = undefined;
    }
  }
}
