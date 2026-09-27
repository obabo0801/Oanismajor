export default {
  plugins: ["prettier-plugin-sh"],
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "none",
  objectWrap: "collapse",
  overrides: [{ files: "eslint.config.js", options: { printWidth: 100, objectWrap: "preserve" } }]
};
