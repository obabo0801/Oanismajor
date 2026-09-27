import { get } from "#common/storage";

let audioContext;

export function context() {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContext = window.AudioContext;

  if (!AudioContext) {
    return null;
  }

  audioContext ||= new AudioContext();

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

const percent = (name) => {
  const value = Number(get(`volume-${name}`, 100));

  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : 1;
};

export function level(channel, value = 1) {
  const volume = percent(channel);

  return Math.min(1, Math.max(0, value * volume));
}
