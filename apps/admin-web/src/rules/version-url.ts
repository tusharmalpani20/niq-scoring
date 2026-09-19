// Keep names intact: replacing punctuation with hyphens would create collisions.
const legacyId = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
export function versionUrl(name: string): string {
  if (legacyId.test(name) || name === "." || name === "..") {
    return `/versions/by-name?name=${encodeURIComponent(name)}`;
  }
  return `/versions/${encodeURIComponent(name)}`;
}
export function versionLookup(segment: string, search: string): { endpoint: string } {
  const explicitName = segment === "by-name" ? new URLSearchParams(search).get("name") : null;
  const value = explicitName ?? decodeURIComponent(segment);
  if (value === "." || value === "..") return { endpoint: `/admin/rules/by-name?name=${encodeURIComponent(value)}` };
  return { endpoint: explicitName === null && legacyId.test(value)
    ? `/admin/rules/${encodeURIComponent(value)}`
    : `/admin/rules/by-name/${encodeURIComponent(value)}` };
}
