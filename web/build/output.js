import * as path from "#config/path";

const page = (name) => path.src(`${name}.html`);

const input = {
  index: path.root("web", "index.html"),
  image: page("image"),
  terms: page("terms"),
  privacy: page("privacy"),
  error: page("error"),
  offline: page("offline"),
  denied: page("denied"),
  block: page("block"),
  maint: page("maint")
};

const output = {
  entryFileNames: "assets/[hash].js",
  chunkFileNames: "assets/[hash].js",
  assetFileNames: "assets/[hash][extname]"
};

export default { build: { modulePreload: false, rolldownOptions: { input, output } } };
