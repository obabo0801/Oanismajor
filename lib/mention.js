const pattern = /@\[([^\]\r\n]{1,80})\]\(([a-f0-9]{32})\)/gu;

export const matches = (text = "") => [...text.matchAll(pattern)];

export const ids = (text) => [...new Set(matches(text).map((item) => item[2]))];

export const token = (user) => `@[${user.name.replace(/[\]\r\n]/g, "").slice(0, 80)}](${user.id})`;

export const plain = (text) => text.replace(pattern, (_, name) => `@${name}`);

export const omit = (text, id) =>
  text.replace(pattern, (token, name, target) => (target === id ? `@${name}` : token));

export const query = (text, start, end = start) => {
  if (start !== end) return null;
  const match = text.slice(0, start).match(/(?:^|\s)([/@:])([^\s/@:\[\]]*)$/u);

  if (!match) return null;

  return {
    type: match[1],
    value: match[2].toLocaleLowerCase(),
    start: start - match[1].length - match[2].length,
    end: start
  };
};

const normalize = (value) => value.toLocaleLowerCase().normalize("NFD");
const initials = (value) =>
  [...value.toLocaleLowerCase()]
    .map((letter) => {
      const code = letter.codePointAt(0) - 0xac00;

      return code >= 0 && code <= 11171
        ? "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor(code / 588)]
        : letter;
    })
    .join("");

export const rank = (items, value, recent = []) => {
  const needle = normalize(value);
  const consonants = /^[ㄱ-ㅎ]+$/u.test(value);
  const score = (item) => {
    const names = [item.label, item.search || item.label].map((name) =>
      consonants ? initials(name) : normalize(name)
    );
    const match = consonants ? value : needle;

    if (value && !names.some((name) => name.includes(match))) return -1;
    const used = recent.indexOf(item.value);
    const exact = names.some((name) => name === match);
    const prefix = names.some((name) => name.startsWith(match));

    return (
      (value ? (exact ? 300 : prefix ? 200 : 100) : 0) +
      (used < 0 ? 0 : (recent.length - used) / (recent.length * 100))
    );
  };

  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
};
