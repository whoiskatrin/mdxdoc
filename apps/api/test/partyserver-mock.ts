export type Connection = WebSocket & { id: string };
export type WSMessage = ArrayBuffer | ArrayBufferView | string;
export class Server {
  name = "doc:test:test";
  env: unknown;
  constructor(_ctx?: unknown, env?: unknown) { this.env = env; }
  broadcast(_message: string) {}
}
export async function routePartykitRequest() { return null; }
