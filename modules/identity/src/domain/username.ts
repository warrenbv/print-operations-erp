// One normalisation, trimmed and lower-case, for every place a username is stored or compared.
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isBreakGlassUsername(raw: string, reservedUsername: string): boolean {
  return normalizeUsername(raw) === normalizeUsername(reservedUsername);
}
