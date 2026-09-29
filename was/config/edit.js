import { parseEnv } from "node:util";

// Preserve unrelated entries and comments. Verify the parser's effective values before writing.
export default function edit(content, values) {
  if (typeof content !== "string" || !values || typeof values !== "object")
    throw new TypeError("Invalid environment update");

  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = content.slice(bom.length);
  const before = parseEnv(source);
  const line = source.includes("\r\n") ? "\r\n" : "\n";
  const entries = source.split(/(?<=\n)/);
  const targets = new Set(Object.keys(values));
  const output = [];

  for (const [name, value] of Object.entries(values)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      typeof value !== "string" ||
      /[\r\n\0]/.test(value)
    )
      throw new TypeError("Invalid environment assignment");
  }

  for (let index = 0; index < entries.length; index++) {
    let block = entries[index];

    const entry = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/.exec(block);

    if (!entry) {
      output.push(block);
      continue;
    }

    const start = entry[0].length;
    const quote = block[start];

    if (["'", '"', "`"].includes(quote)) {
      let end = start + 1;
      let closed = false;

      while (!closed) {
        for (; end < block.length; end++) {
          if (block[end] === quote) {
            closed = true;
            break;
          }
        }
        if (closed) break;

        if (++index >= entries.length) throw new Error("Unclosed environment value");

        block += entries[index];
      }
    }

    if (!targets.has(entry[1])) output.push(block);
  }

  let next = output.join("");

  if (next && !next.endsWith("\n")) next += line;
  for (const [name, value] of Object.entries(values)) {
    const quote = !value.includes("'") ? "'" : !value.includes('"') ? '"' : "";

    if (!quote) throw new Error("Environment value contains both quote types");

    next += `${name}=${quote}${value}${quote}${line}`;
  }

  const after = parseEnv(next);
  const expected = { ...before, ...values };

  if (
    Object.keys(expected).length !== Object.keys(after).length ||
    Object.entries(expected).some(([name, value]) => after[name] !== value)
  )
    throw new Error("Environment update verification failed; original must be preserved");

  return bom + next;
}
