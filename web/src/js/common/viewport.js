export default function viewport() {
  const view = window.visualViewport;

  return { width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight };
}
