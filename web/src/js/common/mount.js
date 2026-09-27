const components = new Set();

export function register(...items) {
  items.forEach((item) => components.add(item));
}

export default function mount(root = document) {
  if (!components.size) {
    throw new Error("DOM components must be registered by init before mount");
  }

  components.forEach((component) => component(root));
}
