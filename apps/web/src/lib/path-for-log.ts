// A request path with its query removed, for log lines and error messages. A query can carry what a person typed into a search box.
export function pathForLog(path: string): string {
  const query = path.indexOf('?');
  return query === -1 ? path : path.slice(0, query);
}
