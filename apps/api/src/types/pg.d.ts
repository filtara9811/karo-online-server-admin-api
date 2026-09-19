declare module "pg" {
  import { EventEmitter } from "node:events";

  export class Pool extends EventEmitter {
    constructor(config?: Record<string, unknown>);
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
    end(): Promise<void>;
    on(event: "error", listener: (err: Error) => void): this;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
}
