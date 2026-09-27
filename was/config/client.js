const clean = (value) => value?.replaceAll('"', "").trim() || "";

const os = (req) => {
  const wearable = req.get("x-wearable") === "true" || req.query?.wearable === "true";
  const value = clean(req.get("sec-ch-ua-platform"));

  if (wearable && ["Android", "iOS"].includes(value)) {
    return "Wearable";
  }

  if (value) {
    return value;
  }

  const agent = req.get("user-agent") || "";

  if (wearable && /Android|iPhone|iPad/.test(agent)) {
    return "Wearable";
  }

  if (agent.includes("Android")) {
    return "Android";
  }

  if (/iPhone|iPad/.test(agent)) {
    return "iOS";
  }

  if (agent.includes("Windows")) {
    return "Windows";
  }

  if (agent.includes("Mac OS")) {
    return "macOS";
  }

  if (agent.includes("Linux")) {
    return "Linux";
  }

  return "Unknown";
};

const browser = (req) => {
  const brands = req.get("sec-ch-ua") || "";
  const agent = req.get("user-agent") || "";

  if (agent.includes("SamsungBrowser/")) {
    return "Samsung Internet";
  }

  if (brands.includes("Microsoft Edge")) {
    return "Edge";
  }

  if (brands.includes("Google Chrome")) {
    return "Chrome";
  }

  if (brands.includes("Chromium")) {
    return "Chromium";
  }

  if (agent.includes("Edg/")) {
    return "Edge";
  }

  if (agent.includes("Firefox/") || agent.includes("FxiOS/")) {
    return "Firefox";
  }

  if (agent.includes("Chrome/") || agent.includes("CriOS/")) {
    return "Chrome";
  }

  if (agent.includes("Safari/")) {
    return "Safari";
  }

  return "Unknown";
};

const lang = (req) => {
  const [value] = req.acceptsLanguages();

  if (!value || value === "*") {
    return "";
  }

  try {
    const item = new Intl.Locale(value);

    const region = item.region || item.maximize().region;

    return region ? `${item.language}-${region}` : item.language;
  } catch {
    return "";
  }
};

export default function client(req) {
  return { os: os(req), browser: browser(req), lang: lang(req) };
}
