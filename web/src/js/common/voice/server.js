import { stt as route } from "#shared/route";

import string from "#shared/string";

let cloud;

const encode = (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));

  return btoa(String.fromCharCode(...bytes));
};

export const available = async () => {
  if (cloud === true) {
    return cloud;
  }

  try {
    const response = await fetch(`/api${route}`);

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    cloud = Boolean(data.cloud);

    return cloud;
  } catch {
    return false;
  }
};

export const upload = async (blob, options) => {
  const { lang, text, pitch, signal } = options;

  if (!blob?.size) {
    return { text, confidence: null };
  }

  try {
    const response = await fetch(`/api${route}`, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        "X-STT-Meta": encode({ lang, text, pitch })
      },
      body: blob,
      signal
    });

    if (!response.ok) {
      if (!text) throw new Error("Speech recognition unavailable");
      return { text, confidence: null };
    }

    if (response.status === 204) return { text, confidence: null };

    const data = await response.json();

    return {
      text: string(data.text, null)?.trim() ?? text,
      confidence: Number(data.confidence) > 0 ? Number(data.confidence) : null
    };
  } catch (error) {
    if (signal?.aborted || !text) throw error;

    return { text, confidence: null };
  }
};

export const report = (lang, text, signal) =>
  fetch(`/api${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang, text }),
    signal
  }).catch(() => null);
