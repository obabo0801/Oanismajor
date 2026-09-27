import * as dom from "#common/dom";
import * as view from "#common/voice/view";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supported = Boolean(Recognition);

export const listen = (options) => {
  const { lang, stream, target, signal } = options;
  const { keep = false, change } = options;

  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();

  recognition.lang = lang;
  recognition.continuous = keep;
  recognition.interimResults = Boolean(change);
  recognition.maxAlternatives = 1;

  let text = "";
  let prefix = "";

  const finals = new Map();

  let length = 0;
  let confidence = 0;
  let release = () => {};

  let stopped = false;
  let settled = false;
  let shown = false;
  let off = () => {};

  let complete;

  const done = new Promise((resolve) => {
    complete = resolve;
  });

  const finish = () => {
    if (settled) {
      return;
    }

    settled = true;
    off();
    release();
    complete({ text, confidence });
  };

  const start = () => {
    if (stopped || signal?.aborted) {
      return;
    }

    try {
      prefix = text;
      finals.clear();
      length = 0;
      recognition.start();
    } catch {
      finish();
    }
  };

  dom.on(recognition, "result", (event) => {
    if (settled || signal?.aborted) return;
    const first = event.results[0]?.[0]?.transcript.trim();

    if (
      event.results.length < length ||
      (event.resultIndex === 0 &&
        finals.has(0) &&
        event.results[0]?.isFinal &&
        finals.get(0) !== first)
    ) {
      prefix = text;
      finals.clear();
    }

    length = event.results.length;

    const current = [];

    for (let index = 0; index < event.results.length; index++) {
      const result = event.results[index];
      const item = result[0];
      const value = item?.transcript.trim();

      if (!value) continue;

      if (result.isFinal) {
        finals.set(index, value);
        confidence = Number(item.confidence) || 0;
      } else current.push(value);
    }

    text = [prefix, ...finals.values()].filter(Boolean).join(" ");
    change?.([text, ...current].filter(Boolean).join(" "));
  });

  dom.on(recognition, "start", () => {
    if (shown || stream) {
      return;
    }

    shown = true;
    release = view.visualize(target, stream);
  });

  dom.on(recognition, "error", (event) => {
    if (keep && event.error === "no-speech" && !stopped && !signal?.aborted) {
      return;
    }

    stopped = true;
    finish();
  });

  dom.on(recognition, "end", () => {
    if (keep && !stopped && !signal?.aborted) {
      setTimeout(start, 0);

      return;
    }

    finish();
  });

  off = dom.on(
    signal,
    "abort",
    () => {
      stopped = true;

      try {
        recognition.abort();
      } catch {}

      finish();
    },
    { once: true }
  );

  start();

  return {
    done,
    abort: () => {
      stopped = true;
      try {
        recognition.abort();
      } catch {}
      finish();
    },
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;

      try {
        recognition.stop();
      } catch {
        finish();
      }
    }
  };
};

export const native = async (options) => {
  const { lang, target, signal, stop } = options;

  if (!Recognition) {
    return { text: "", confidence: 0 };
  }

  const heard = listen({
    lang,
    stream: null,
    target,
    signal,
    keep: true,
    change: (text) => view.preview(target, text)
  });
  const timer = setTimeout(heard.stop, 60_000);

  const off = dom.on(stop, "abort", heard.stop, { once: true });

  if (stop.aborted) {
    heard.stop();
  }

  try {
    return await heard.done;
  } finally {
    clearTimeout(timer);
    off();
  }
};
