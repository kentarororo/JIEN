import type { SQLiteRunResult } from 'expo-sqlite';

export type MainThreadBindValue = null | boolean | number | string | Uint8Array;
type BindParams = MainThreadBindValue[] | Record<string, MainThreadBindValue>;

export type MainThreadSQLiteApi = {
  bind_collection: (statement: number, bindings: BindParams) => void;
  changes: (database: number) => number;
  close: (database: number) => Promise<void>;
  column_names: (statement: number) => string[];
  exec: (database: number, sql: string) => Promise<void>;
  last_insert_rowid: (database: number) => number | bigint;
  row: (statement: number) => unknown[];
  statements: (database: number, sql: string) => AsyncIterable<number>;
  step: (statement: number) => Promise<number>;
};

export type MainThreadMemoryVfs = { close: () => void };

function normalizeBindings(values: unknown[]): BindParams {
  if (values.length === 0) return [];
  if (values.length === 1) {
    const first = values[0];
    if (Array.isArray(first)) return first as MainThreadBindValue[];
    if (first && typeof first === 'object' && !(first instanceof Uint8Array)) {
      return first as Record<string, MainThreadBindValue>;
    }
  }
  return values as MainThreadBindValue[];
}

function rowObject(columns: string[], values: unknown[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}

export class MainThreadMemoryDatabase {
  private closed = false;
  private transactionDepth = 0;
  private readonly sqlite: MainThreadSQLiteApi;
  private readonly pointer: number;
  private readonly vfs: MainThreadMemoryVfs;
  private readonly resultCodes: { done: number; row: number };

  constructor(
    sqlite: MainThreadSQLiteApi,
    pointer: number,
    vfs: MainThreadMemoryVfs,
    resultCodes: { done: number; row: number },
  ) {
    this.sqlite = sqlite;
    this.pointer = pointer;
    this.vfs = vfs;
    this.resultCodes = resultCodes;
  }

  async execAsync(sql: string): Promise<void> {
    this.assertOpen();
    await this.sqlite.exec(this.pointer, sql);
  }

  async runAsync(sql: string, ...values: unknown[]): Promise<SQLiteRunResult> {
    this.assertOpen();
    const bindings = normalizeBindings(values);
    for await (const statement of this.sqlite.statements(this.pointer, sql)) {
      this.sqlite.bind_collection(statement, bindings);
      while (true) {
        const result = await this.sqlite.step(statement);
        if (result === this.resultCodes.done) break;
        if (result !== this.resultCodes.row) throw new Error(`SQLite returned unexpected result ${result}.`);
      }
      return {
        changes: this.sqlite.changes(this.pointer),
        lastInsertRowId: Number(this.sqlite.last_insert_rowid(this.pointer)),
      };
    }
    throw new Error('SQLite did not prepare the statement.');
  }

  async getAllAsync<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    this.assertOpen();
    const bindings = normalizeBindings(values);
    const rows: T[] = [];
    for await (const statement of this.sqlite.statements(this.pointer, sql)) {
      this.sqlite.bind_collection(statement, bindings);
      const columns = this.sqlite.column_names(statement);
      while (true) {
        const result = await this.sqlite.step(statement);
        if (result === this.resultCodes.done) break;
        if (result !== this.resultCodes.row) throw new Error(`SQLite returned unexpected result ${result}.`);
        rows.push(rowObject(columns, this.sqlite.row(statement)) as T);
      }
    }
    return rows;
  }

  async getFirstAsync<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, ...values);
    return rows[0] ?? null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.assertOpen();
    const depth = this.transactionDepth++;
    const savepoint = `jien_transaction_${depth}`;
    try {
      await this.execAsync(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      await task();
      await this.execAsync(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    } catch (cause) {
      if (depth === 0) {
        await this.execAsync('ROLLBACK').catch(() => undefined);
      } else {
        await this.execAsync(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
        await this.execAsync(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      }
      throw cause;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  closeSync(): void {
    void this.closeAsync();
  }

  async closeAsync(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sqlite.close(this.pointer);
    this.vfs.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The in-memory database is closed.');
  }
}
