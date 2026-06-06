import * as Y from "yjs";
export class YServer {
  static callbackOptions = {};
  name = "doc:test:test";
  document = new Y.Doc();
  env: unknown;
  constructor(_ctx?: unknown, env?: unknown) { this.env = env; }
  sendCustomMessage() {}
  broadcastCustomMessage() {}
}
