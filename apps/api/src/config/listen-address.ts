// Where the API listens. It stays on loopback unless API_HOST names another address, so an unconfigured process is not reachable from the network.
// A port that is not a whole number from 1 to 65535 stops the boot. Tests: apps/api/test/listen-address.test.ts.
export interface ListenAddress {
  host: string;
  port: number;
}

export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 3001;

export function resolveListenAddress(env: NodeJS.ProcessEnv): ListenAddress {
  const rawHost = env.API_HOST;
  const host = rawHost === undefined || rawHost.trim() === '' ? DEFAULT_API_HOST : rawHost.trim();

  const rawPort = env.API_PORT;
  if (rawPort === undefined || rawPort === '') return { host, port: DEFAULT_API_PORT };
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be a port number between 1 and 65535 (got "${rawPort}")`);
  }
  return { host, port };
}
