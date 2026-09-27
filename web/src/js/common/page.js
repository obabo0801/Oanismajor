export default async function available() {
  try {
    const response = await fetch("/", { cache: "no-store", headers: { Accept: "text/html" } });

    return response.status < 500;
  } catch {
    return false;
  }
}
