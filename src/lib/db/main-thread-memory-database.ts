import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

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
  serialize: (database: number, schema: string) => Uint8Array | null;
  statements: (database: number, sql: string) => AsyncIterable<number>;
  step: (statement: number) => Promise<number>;
};

export type MainThreadMemoryVfs = {
  close: () => void;
  snapshotDatabase?: () => Uint8Array | null;
};

export type MainThreadDatabasePersistence = {
  save: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  closeSync?: () => void;
  readonly needsCloudRebuild?: boolean;
};

export class WebDatabaseDurabilityError extends Error {
  readonly code = 'WEB_DATABASE_NOT_DURABLE';
  readonly committed = true;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('This change committed in the open tab but could not be saved durably. Do not retry it; refresh JIEN to recover safely.');
    this.name = 'WebDatabaseDurabilityError';
    this.cause = cause;
  }
}

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
  readonly recommendedJournalMode = 'DELETE';
  private closed = false;
  private transactionDepth = 0;
  private readonly sqlite: MainThreadSQLiteApi;
  private readonly pointer: number;
  private readonly vfs: MainThreadMemoryVfs;
  private readonly resultCodes: { done: number; row: number };
  private readonly persistence: MainThreadDatabasePersistence | null;
  private operationChain: Promise<void> = Promise.resolve();
  private persistenceChain: Promise<void> = Promise.resolve();
  private persistencePaused: boolean;
  private durabilityFailure: WebDatabaseDurabilityError | null = null;

  constructor(
    sqlite: MainThreadSQLiteApi,
    pointer: number,
    vfs: MainThreadMemoryVfs,
    resultCodes: { done: number; row: number },
    persistence: MainThreadDatabasePersistence | null = null,
    startPersistencePaused = false,
  ) {
    this.sqlite = sqlite;
    this.pointer = pointer;
    this.vfs = vfs;
    this.resultCodes = resultCodes;
    this.persistence = persistence;
    this.persistencePaused = startPersistencePaused;
  }

  async execAsync(sql: string): Promise<void> {
    return this.enqueueOperation(async () => {
      await this.directExecAsync(sql);
      await this.persistAsync();
    }, true);
  }

  async runAsync(sql: string, ...values: unknown[]): Promise<SQLiteRunResult> {
    return this.enqueueOperation(async () => {
      const result = await this.directRunAsync(sql, ...values);
      await this.persistAsync();
      return result;
    }, true);
  }

  async getAllAsync<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    return this.enqueueOperation(() => this.directGetAllAsync<T>(sql, ...values));
  }

  async getFirstAsync<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    return this.enqueueOperation(() => this.directGetFirstAsync<T>(sql, ...values));
  }

  async withTransactionAsync(_task: () => Promise<void>): Promise<void> {
    throw new Error('Web repositories must use withExclusiveTransaction with its scoped database handle.');
  }

  withExclusiveTransactionAsync<T>(
    task: (transactionDatabase: SQLiteDatabase) => Promise<T>,
  ): Promise<T> {
    return this.enqueueOperation(() => this.executeTransaction(task), true);
  }

  withDeferredPersistenceAsync<T>(
    task: (database: SQLiteDatabase) => Promise<T>,
  ): Promise<T> {
    return this.enqueueOperation(async () => {
      const result = await task(this.createTransactionDatabase());
      await this.directExecAsync('VACUUM');
      await this.persistAsync();
      return result;
    }, true);
  }

  private async directExecAsync(sql: string): Promise<void> {
    this.assertOpen();
    await this.sqlite.exec(this.pointer, sql);
  }

  private async directRunAsync(sql: string, ...values: unknown[]): Promise<SQLiteRunResult> {
    this.assertOpen();
    const bindings = normalizeBindings(values);
    for await (const statement of this.sqlite.statements(this.pointer, sql)) {
      this.sqlite.bind_collection(statement, bindings);
      while (true) {
        const result = await this.sqlite.step(statement);
        if (result === this.resultCodes.done) break;
        if (result !== this.resultCodes.row) throw new Error(`SQLite returned unexpected result ${result}.`);
      }
      const runResult = {
        changes: this.sqlite.changes(this.pointer),
        lastInsertRowId: Number(this.sqlite.last_insert_rowid(this.pointer)),
      };
      return runResult;
    }
    throw new Error('SQLite did not prepare the statement.');
  }

  private async directGetAllAsync<T>(sql: string, ...values: unknown[]): Promise<T[]> {
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

  private async directGetFirstAsync<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    const rows = await this.directGetAllAsync<T>(sql, ...values);
    return rows[0] ?? null;
  }

  private async executeTransaction<T>(
    task: (transactionDatabase: SQLiteDatabase) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    const depth = this.transactionDepth++;
    const savepoint = `jien_transaction_${depth}`;
    let committed = false;
    let result!: T;
    const scopedDatabase = this.createTransactionDatabase();
    try {
      await this.directExecAsync(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      result = await task(scopedDatabase);
      await this.directExecAsync(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
      committed = true;
    } catch (cause) {
      if (depth === 0) {
        await this.directExecAsync('ROLLBACK').catch(() => undefined);
      } else {
        await this.directExecAsync(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
        await this.directExecAsync(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      }
      throw cause;
    } finally {
      this.transactionDepth -= 1;
    }
    if (depth === 0 && committed) await this.persistAsync();
    return result;
  }

  private createTransactionDatabase(): SQLiteDatabase {
    const database = {
      execAsync: (sql: string) => this.directExecAsync(sql),
      runAsync: (sql: string, ...values: unknown[]) => this.directRunAsync(sql, ...values),
      getAllAsync: <T>(sql: string, ...values: unknown[]) => this.directGetAllAsync<T>(sql, ...values),
      getFirstAsync: <T>(sql: string, ...values: unknown[]) => this.directGetFirstAsync<T>(sql, ...values),
      withTransactionAsync: async (nestedTask: () => Promise<void>) => {
        await this.executeTransaction(async () => nestedTask());
      },
      withExclusiveTransactionAsync: <T>(nestedTask: (transactionDatabase: SQLiteDatabase) => Promise<T>) => (
        this.executeTransaction(nestedTask)
      ),
    };
    return database as unknown as SQLiteDatabase;
  }

  private enqueueOperation<T>(task: () => Promise<T>, writable = false): Promise<T> {
    const operation = this.operationChain.then(async () => {
      if (writable) this.assertWritable();
      else this.assertOpen();
      return task();
    });
    this.operationChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async persistAsync(): Promise<void> {
    if (!this.persistence || this.persistencePaused) return;
    if (this.durabilityFailure) throw this.durabilityFailure;
    let image: Uint8Array | null;
    try {
      image = this.vfs.snapshotDatabase?.()
        ?? this.sqlite.serialize(this.pointer, 'main');
    } catch (cause) {
      this.durabilityFailure = new WebDatabaseDurabilityError(cause);
      throw this.durabilityFailure;
    }
    if (!image) {
      this.durabilityFailure = new WebDatabaseDurabilityError(
        new Error('SQLite could not create a durable local snapshot.'),
      );
      throw this.durabilityFailure;
    }
    const immutableImage = image.slice();
    const write = this.persistenceChain.then(() => this.persistence!.save(immutableImage));
    this.persistenceChain = write.catch(() => undefined);
    try {
      await write;
    } catch (cause) {
      this.durabilityFailure = new WebDatabaseDurabilityError(cause);
      throw this.durabilityFailure;
    }
  }

  async resumePersistenceAsync(): Promise<void> {
    this.assertWritable();
    this.persistencePaused = false;
    await this.persistAsync();
  }

  get requiresCloudRebuild(): boolean {
    return this.persistence?.needsCloudRebuild === true;
  }

  closeSync(): void {
    if (this.closed) return;
    this.closed = true;
    this.persistence?.closeSync?.();
    void this.sqlite.close(this.pointer)
      .catch(() => undefined)
      .finally(() => this.vfs.close());
  }

  async closeAsync(): Promise<void> {
    if (this.closed) return;
    await this.persistAsync();
    this.closed = true;
    await this.persistenceChain;
    await this.sqlite.close(this.pointer);
    this.vfs.close();
    await this.persistence?.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The in-memory database is closed.');
  }

  private assertWritable(): void {
    this.assertOpen();
    if (this.durabilityFailure) throw this.durabilityFailure;
  }
}
