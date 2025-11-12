// Type declarations for bun:sqlite
// See: https://bun.sh/docs/api/sqlite

declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: { create?: boolean; readwrite?: boolean; readonly?: boolean });
    exec(sql: string): void;
    close(): void;
    run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number };
    prepare(sql: string): Statement;
  }

  export class Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number };
    get(...params: any[]): any;
    all(...params: any[]): any[];
    values(...params: any[]): any[][];
    finalize(): void;
  }
}
