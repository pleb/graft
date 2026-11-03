export type TrustKeys = { keys: string[] } | { refusal: string };

function slashed(path: string): string {
  const forward = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\/*$/.test(forward)) return `${forward.slice(0, 2)}/`;
  return forward.replace(/(?<=.)\/+$/, "");
}

function isRoot(path: string): boolean {
  return path === "/" || /^[A-Za-z]:\/$/.test(path) || /^\/\/[^/]+(\/[^/]+)?$/.test(path);
}

export function trustKeys(root: string, realRoot: string, home: string): TrustKeys {
  const keys = [...new Set([slashed(root), slashed(realRoot)])];
  const homeKey = slashed(home).toLowerCase();
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (isRoot(key)) return { refusal: `${key} is a drive or share root` };
    if (lower === homeKey) return { refusal: `${key} is the home directory` };
    if (homeKey.startsWith(`${lower}/`))
      return { refusal: `${key} is an ancestor of the home directory ${home}` };
  }
  return { keys };
}
