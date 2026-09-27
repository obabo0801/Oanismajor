import speech from "@google-cloud/speech";

const { SpeechClient } = speech.v2;
const mode = (process.env.STT || "").trim().toLowerCase();
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS;

export const enabled = ["login", "json"].includes(mode);

let client;
let project;

const connect = () => {
  if (mode === "json") {
    if (!key) {
      throw new Error();
    }

    return new SpeechClient({ keyFilename: key });
  }

  return new SpeechClient();
};

export default async function recognize(audio, lang) {
  if (!enabled || !Buffer.isBuffer(audio) || !audio.length) {
    return { text: "", confidence: null };
  }

  client ||= connect();
  project ||= await client.getProjectId();

  const [response] = await client.recognize({
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
