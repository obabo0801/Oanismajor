import speech from "@google-cloud/speech";
import create from "#service/cloud";

const { SpeechClient } = speech.v2;
const mode = (process.env.STT || "").trim().toLowerCase();

export const enabled = ["login", "json"].includes(mode);

let client;
let project;

const connect = () => {
  if (!client) {
    const pending = create(SpeechClient, mode);

    client = pending;
    void pending.catch(() => {
      if (client === pending) client = undefined;
    });
  }

  return client;
};

export default async function recognize(audio, lang) {
  if (!enabled || !Buffer.isBuffer(audio) || !audio.length) {
    return { text: "", confidence: null };
  }

  const target = await connect();

  project ||= await target.getProjectId();

  const [response] = await target.recognize({
    recognizer: `projects/${project}/locations/global/` + "recognizers/_",
    config: {
      autoDecodingConfig: {},
      languageCodes: [lang],
      model: "long",
      features: { enableWordTimeOffsets: true }
    },
    content: audio
  });

  const items = (response.results || []).map((result) => result.alternatives?.[0]).filter(Boolean);

  const text = items
    .map((item) => item.transcript?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  const scores = items.map((item) => Number(item.confidence)).filter((value) => value > 0);

  const confidence = scores.length
    ? scores.reduce((sum, value) => sum + value, 0) / scores.length
    : null;

  const seconds = (value) => Number(value?.seconds || 0) + Number(value?.nanos || 0) / 1e9;
  const cues = items.flatMap((item) =>
    (item.words || []).map((word) => ({
      text: word.word,
      start: seconds(word.startOffset),
      end: seconds(word.endOffset)
    }))
  );

  return { text, confidence, cues };
}
