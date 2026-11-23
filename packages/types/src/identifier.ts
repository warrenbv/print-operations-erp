// A short display form of an id, for screens and message subjects where a record has no number of its own.
// Keys are UUIDv7 (docs/decisions/010-orm-spike.md), which begin with a timestamp, so the tail is the part that tells records apart.
export function shortId(uuid: string): string {
  return uuid.slice(uuid.lastIndexOf('-') + 1).slice(-8);
}
