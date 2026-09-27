import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

const browser = ["\\#src/*", "\\#common/*", "\\#ui/*"];
const request = [
  "\\#router*",
  "\\#middleware/*",
  "\\#block",
  "\\#maint",
  "\\#page",
  "\\#assets",
  "\\#upload",
  "\\#error"
];

const backend = ["\\#config/*", "\\#build/*", "\\#db*", "\\#service/*", ...request, "node:*"];

export default [
  {
    ignores: ["web/dist/**", "storage/**", "replica/**", "node/**", ".codex*/**"]
  },
  {
    files: [
      "*.js",
      "was/server.js",
      "web/vite.config.js",
      "was/config/**/*.js",
      "db/**/*.js",
      "was/service/**/*.js",
      "web/build/**/*.js",
      "was/middleware/**/*.js",
      "was/router/**/*.js"
    ],
    languageOptions: { globals: globals.node }
  },
  {
    files: ["web/src/js/**/*.js"],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ["was/server.js", "was/middleware/**/*.js", "was/router/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...browser, "\\#build/*"] }]
    }
  },
  {
    files: ["was/config/**/*.js", "db/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...browser, ...request, "\\#service/*", "\\#build/*"] }
      ]
    }
  },
  {
    files: ["was/service/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...browser, ...request, "\\#build/*"] }]
    }
  },
  {
    files: ["web/build/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...browser, ...request, "\\#service/*", "\\#db*"] }
      ]
    }
  },
  {
    files: ["web/src/js/**/*.js"],
    rules: { "no-restricted-imports": ["error", { patterns: backend }] }
  },
  {
    files: ["web/src/js/common/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...backend, "\\#src/*", "\\#ui/*"] }]
    }
  },
  {
    files: ["lib/**/*.js"],
    languageOptions: { globals: { URL: "readonly" } },
    rules: {
      "no-restricted-imports": ["error", { patterns: [...backend, ...browser] }]
    }
  },
  {
    files: ["web/public/worker.js"],
    languageOptions: { globals: globals.serviceworker }
  },
  {
    files: ["**/*.js"],
    plugins: { "@stylistic": stylistic },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-constant-binary-expression": "error",
      "no-unexpected-multiline": "error",
      "no-use-before-define": ["error", { functions: false }],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: ["const", "let"], next: "*" },
        { blankLine: "any", prev: ["const", "let"], next: ["const", "let"] },
        { blankLine: "always", prev: "let", next: "const" },
        { blankLine: "always", prev: "const", next: "let" },
        { blankLine: "always", prev: "expression", next: ["const", "let"] },
        { blankLine: "always", prev: "if", next: ["if", "expression"] },
        { blankLine: "always", prev: "multiline-expression", next: "*" },
        {
          blankLine: "always",
          prev: "multiline-const",
          next: "multiline-const"
        }
      ]
    }
  }
];
