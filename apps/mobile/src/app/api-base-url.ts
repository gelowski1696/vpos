export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = stripTrailingSlash((value || "").trim());
  if (!trimmed) {
    return "";
  }

  // Accept either http://host:port or http://host:port/api.
  if (trimmed.endsWith("/api")) {
    return trimmed;
  }
  return `${trimmed}/api`;
}
