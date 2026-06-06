export class DurableObject<Env = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkflowEntrypoint<Env = unknown, T = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
  async run(_event: Readonly<WorkflowEvent<T>>, _step: WorkflowStep): Promise<unknown> {
    return undefined;
  }
}

export type WorkflowEvent<T = unknown> = { payload: T; timestamp?: Date; instanceId?: string };
export class WorkflowStep {}
