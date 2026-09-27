import hash from "#config/hash";

const rename = (code) =>
  code.replace(
    /\bdata-([a-z][a-z0-9_.:-]*)/gi,

    (_, name) => `data-${hash(8, name.toLowerCase())}`
  );

export const css = {
  postcssPlugin: "data-hash",
  Once(root) {
    root.walkRules((rule) => {
      rule.selector = rename(rule.selector);
    });

    root.walkDecls((declaration) => {
      declaration.value = rename(declaration.value);
    });

    root.walkAtRules((rule) => {
      rule.params = rename(rule.params);
    });
  }
};

export default {
  name: "data-hash",
  apply: "build",
  enforce: "pre",
  transformIndexHtml: rename,
  transform(code, id) {
    if (/\.js(\?|$)|\.html\?raw$/.test(id)) {
      return rename(code);
    }
  }
};
