import { context } from "#common/audio";
import * as dom from "#common/dom";

const frequency = (buffer) => {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const size = Math.min(data.length, rate);
  const start = Math.max(0, Math.floor((data.length - size) / 2));

  let power = 0;
  let count = 0;

  for (let i = start; i < start + size; i += 4) {
    power += data[i] ** 2;
    count += 1;
  }

  if (!count || Math.sqrt(power / count) < 0.01) {
    return 0;
  }

  const min = Math.floor(rate / 300);
  const max = Math.floor(rate / 80);

  let best = 0;
  let score = 0;

  for (let lag = min; lag <= max; lag += 1) {
    let value = 0;

    for (let i = start; i < start + size - lag; i += 4) {
      value += data[i] * data[i + lag];
    }

    if (value > score) {
      score = value;
      best = lag;
    }
  }

  return best ? rate / best : 0;
};

const pitch = (hz) => {
  if (!hz) {
    return "unknown";
  }

  if (hz < 130) {
    return "low";
  }

  if (hz > 210) {
    return "high";
  }

  return "mid";
};

export const analyze = async (blob) => {
  if (!window.OfflineAudioContext) {
    return "unknown";
  }

  try {
    const audio = new OfflineAudioContext(1, 1, 44100);
    const buffer = await audio.decodeAudioData(await blob.arrayBuffer());

    return pitch(frequency(buffer));
  } catch {
    return "unknown";
  }
};

export const meter = (stream, callback) => {
  const audio = context();

  if (!audio) {
    return () => {};
  }

  const source = audio.createMediaStreamSource(stream);
  const analyser = audio.createAnalyser();

  analyser.fftSize = 1024;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);

  let frame;
  let stopped = false;

  const check = () => {
    if (stopped) return;

    analyser.getByteTimeDomainData(data);

    let power = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const value = (data[i] - 128) / 128;

      power += value ** 2;
      count += 1;
    }

    const level = count ? Math.sqrt(power / count) : 0;

    callback(level);
    if (!stopped) frame = requestAnimationFrame(check);
  };

  frame = requestAnimationFrame(check);

  return () => {
    if (stopped) return;

    stopped = true;
    cancelAnimationFrame(frame);
    source.disconnect();
  };
};

export const silence = (stream, signal, stop) =>
  new Promise((resolve) => {
    const audio = context();

    if (!audio) {
      let offSignal = () => {};

      let offStop = () => {};

      let timer;
      let settled = false;

      const done = (spoken = false) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        offSignal();
        offStop();
        resolve(spoken);
      };

      timer = setTimeout(() => done(true), 60_000);
      offSignal = dom.on(signal, "abort", () => done(false), { once: true });

      offStop = dom.on(stop, "abort", () => done(true), { once: true });

      if (signal?.aborted || stop?.aborted) {
        done();
      }

      return;
    }

    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();

    analyser.fftSize = 1024;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const start = performance.now();

    let spoken = false;
    let quiet = start;
    let frame;
    let timer;
    let stopped = false;
    let offSignal = () => {};

    let offStop = () => {};

    const done = () => {
      if (stopped) {
        return;
      }

      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      offSignal();
      offStop();
      source.disconnect();
      resolve(spoken);
    };

    offSignal = dom.on(signal, "abort", done, { once: true });
    offStop = dom.on(stop, "abort", done, { once: true });

    if (signal?.aborted || stop?.aborted) {
      done();

      return;
    }

    const check = (time) => {
      analyser.getByteTimeDomainData(data);

      let power = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const value = (data[i] - 128) / 128;

        power += value ** 2;
        count += 1;
      }

      const level = count ? Math.sqrt(power / count) : 0;

      if (level > 0.012) {
        spoken = true;
        quiet = time;
      }

      if (
        (spoken && time - quiet >= 2200) ||
        (!spoken && time - start >= 10000) ||
        time - start >= 60_000
      ) {
        done();

        return;
      }

      frame = requestAnimationFrame(check);
    };

    frame = requestAnimationFrame(check);
    timer = setTimeout(done, 60_000);
  });
