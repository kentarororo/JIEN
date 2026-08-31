const SNAPSHOT_FORMAT_VERSION = 1;
const ACTIVE_KEY = 'active';
const QUARANTINED_STATE_KEY = 'quarantined-active-state';
const STORE_NAME = 'sqlite_snapshots';
const SNAPSHOT_WRITE_MARGIN_BYTES = 1024 * 1024;

type WebStorageManager = {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
};

let persistenceRequestStarted = false;

export async function requestPersistentWebStorage(
  storage: WebStorageManager | undefined = globalThis.navigator?.storage,
): Promise<boolean | null> {
  if (!storage?.persisted || !storage.persist) return null;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}

export async function assertSnapshotStorageHeadroom(
  snapshotByteLength: number,
  storage: WebStorageManager | undefined = globalThis.navigator?.storage,
): Promise<void> {
  if (!storage?.estimate) return;
  let estimate: { quota?: number; usage?: number };
  try {
    estimate = await storage.estimate();
  } catch {
    return;
  }
  const quota = estimate.quota;
  const usage = estimate.usage;
  if (!Number.isFinite(quota) || !Number.isFinite(usage)) return;
  const available = Math.max(0, Number(quota) - Number(usage));
  if (available < snapshotByteLength + SNAPSHOT_WRITE_MARGIN_BYTES) {
    throw new DOMException(
      'Not enough browser storage is available for the next durable SQLite snapshot. Existing local data was preserved.',
      'QuotaExceededError',
    );
  }
}

export type WebDatabaseSnapshot = {
  key: string;
  kind: 'snapshot';
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
  ownerUserId: string;
  generation: number;
  savedAt: string;
  bytes: ArrayBuffer;
};

export type WebDatabaseSnapshotState = {
  key: typeof ACTIVE_KEY;
  kind: 'state';
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
  ownerUserId: string;
  epoch: string;
  generation: number;
  activeSnapshotKey: string | null;
  previousSnapshotKey: string | null;
  quarantinedSnapshotKey: string | null;
  requiresCloudRebuild: boolean;
};

type WebDatabaseSnapshotIdentity = Pick<
  WebDatabaseSnapshotState,
  'epoch' | 'generation' | 'activeSnapshotKey'
>;

export function webDatabaseStorageName(ownerUserId: string): string {
  if (!isUuid(ownerUserId)) throw new Error('A verified account is required for durable web storage.');
  return `jien-web-sqlite-v1:${ownerUserId.toLowerCase()}`;
}

export function hasSQLiteFileHeader(bytes: Uint8Array): boolean {
  const header = 'SQLite format 3\0';
  return bytes.length >= header.length
    && [...header].every((character, index) => bytes[index] === character.charCodeAt(0));
}

export function parseWebDatabaseSnapshot(
  value: unknown,
  ownerUserId: string,
): WebDatabaseSnapshot | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object') throw new Error('The saved web database has an invalid envelope.');
  const record = value as Partial<WebDatabaseSnapshot>;
  if (
    typeof record.key !== 'string'
    || !record.key.startsWith('snapshot:')
    || record.kind !== 'snapshot'
    || record.formatVersion !== SNAPSHOT_FORMAT_VERSION
    || record.ownerUserId !== ownerUserId
    || !isGeneration(record.generation)
    || typeof record.savedAt !== 'string'
    || !(record.bytes instanceof ArrayBuffer)
  ) {
    throw new Error('The saved web database does not belong to this account or app version.');
  }
  return record as WebDatabaseSnapshot;
}

export function parseWebDatabaseSnapshotState(
  value: unknown,
  ownerUserId: string,
): WebDatabaseSnapshotState | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object') throw new Error('The saved web database state is invalid.');
  const record = value as Partial<WebDatabaseSnapshotState>;
  if (
    record.key !== ACTIVE_KEY
    || record.kind !== 'state'
    || record.formatVersion !== SNAPSHOT_FORMAT_VERSION
    || record.ownerUserId !== ownerUserId
    || !isStateEpoch(record.epoch)
    || !isGeneration(record.generation)
    || !isNullableKey(record.activeSnapshotKey)
    || !isNullableKey(record.previousSnapshotKey)
    || !isNullableKey(record.quarantinedSnapshotKey)
    || typeof record.requiresCloudRebuild !== 'boolean'
  ) {
    throw new Error('The saved web database state does not belong to this account or app version.');
  }
  return record as WebDatabaseSnapshotState;
}

export class WebDatabaseSnapshotStore {
  private readonly database: IDBDatabase;
  private readonly ownerUserId: string;
  private epoch: string | null = null;
  private generation = 0;
  private activeSnapshotKey: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private closing = false;
  private _needsCloudRebuild = false;

  private constructor(database: IDBDatabase, ownerUserId: string) {
    this.database = database;
    this.ownerUserId = ownerUserId;
    this.database.onversionchange = () => this.closeSync();
  }

  get needsCloudRebuild(): boolean {
    return this._needsCloudRebuild;
  }

  static async open(ownerUserId: string): Promise<WebDatabaseSnapshotStore> {
    const databaseName = webDatabaseStorageName(ownerUserId);
    if (typeof indexedDB === 'undefined') {
      throw new Error('This browser does not provide durable IndexedDB storage.');
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const next = request.result;
        if (!next.objectStoreNames.contains(STORE_NAME)) next.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Durable web storage could not be opened.'));
      request.onblocked = () => reject(new Error('Another tab is updating local storage. Close it, then retry.'));
    });
    if (!persistenceRequestStarted) {
      persistenceRequestStarted = true;
      void requestPersistentWebStorage();
    }
    return new WebDatabaseSnapshotStore(database, ownerUserId);
  }

  async load(): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { stateValue, snapshotValue } = await this.readActiveSnapshot();
      let state: WebDatabaseSnapshotState | null;
      try {
        state = parseWebDatabaseSnapshotState(stateValue, this.ownerUserId);
      } catch {
        const recovered = await this.quarantineBrokenState();
        if (!recovered) continue;
        this._needsCloudRebuild = true;
        return null;
      }
      this.rememberState(state);
      if (!state?.activeSnapshotKey) {
        this._needsCloudRebuild = state?.requiresCloudRebuild ?? false;
        return null;
      }
      try {
        const snapshot = parseWebDatabaseSnapshot(snapshotValue, this.ownerUserId);
        if (!snapshot || snapshot.key !== state.activeSnapshotKey || snapshot.generation !== state.generation) {
          throw new Error('The active web database generation is incomplete.');
        }
        return new Uint8Array(snapshot.bytes.slice(0));
      } catch {
        await this.quarantineCurrent('snapshot_envelope_invalid');
        this._needsCloudRebuild = true;
        return null;
      }
    }
    throw staleSnapshotError();
  }

  save(bytes: Uint8Array): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Durable web storage is closing.'));
    const image = bytes.slice().buffer;
    const write = this.writeChain.then(() => this.writeNextGeneration(image));
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  async quarantineCurrent(reason: string): Promise<void> {
    const expected = this.currentIdentity();
    if (!expected?.activeSnapshotKey) return;
    let nextState: WebDatabaseSnapshotState | null = null;
    await this.runReadWriteTransaction((store, transaction) => {
      const request = store.get(ACTIVE_KEY);
      request.onsuccess = () => {
        try {
          const current = parseWebDatabaseSnapshotState(request.result, this.ownerUserId);
          if (!current || !sameIdentity(current, expected)) {
            transaction.abort();
            return;
          }
          nextState = {
            ...current,
            activeSnapshotKey: null,
            quarantinedSnapshotKey: expected.activeSnapshotKey,
            requiresCloudRebuild: true,
          };
          store.put({
            ...nextState,
            quarantineReason: reason,
            quarantinedAt: new Date().toISOString(),
          });
        } catch {
          transaction.abort();
        }
      };
      request.onerror = () => transaction.abort();
    }).catch((cause) => {
      if (cause instanceof Error && cause.name === 'AbortError') throw staleSnapshotError();
      throw cause;
    });
    this.rememberState(nextState);
    this._needsCloudRebuild = true;
  }

  async close(): Promise<void> {
    if (this.closing) {
      await this.writeChain;
      return;
    }
    this.closing = true;
    await this.writeChain;
    this.database.close();
  }

  closeSync(): void {
    if (this.closing) return;
    this.closing = true;
    void this.writeChain.finally(() => this.database.close());
  }

  private readActiveSnapshot(): Promise<{ stateValue: unknown; snapshotValue: unknown }> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const stateRequest = store.get(ACTIVE_KEY);
      let stateValue: unknown;
      let snapshotValue: unknown;
      stateRequest.onsuccess = () => {
        stateValue = stateRequest.result;
        try {
          const state = parseWebDatabaseSnapshotState(stateValue, this.ownerUserId);
          if (!state?.activeSnapshotKey) return;
          const snapshotRequest = store.get(state.activeSnapshotKey);
          snapshotRequest.onsuccess = () => { snapshotValue = snapshotRequest.result; };
          snapshotRequest.onerror = () => transaction.abort();
        } catch {
          // Invalid state is recovered in a separate atomic read/write transaction.
        }
      };
      stateRequest.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve({ stateValue, snapshotValue });
      transaction.onabort = () => reject(transaction.error ?? new Error('Reading durable web storage was interrupted.'));
    });
  }

  private writeNextGeneration(bytes: ArrayBuffer): Promise<void> {
    const expected = this.currentIdentity();
    let nextState: WebDatabaseSnapshotState | null = null;
    return assertSnapshotStorageHeadroom(bytes.byteLength).then(() => this.runReadWriteTransaction((store, transaction) => {
      const request = store.get(ACTIVE_KEY);
      request.onsuccess = () => {
        try {
          const current = parseWebDatabaseSnapshotState(request.result, this.ownerUserId);
          if (!sameNullableIdentity(current, expected)) {
            transaction.abort();
            return;
          }
          const currentGeneration = current?.generation ?? 0;
          const nextGeneration = currentGeneration + 1;
          const snapshotKey = `snapshot:${nextGeneration}:${randomKey()}`;
          const previousSnapshotKey = current?.activeSnapshotKey ?? current?.previousSnapshotKey ?? null;
          store.put({
            key: snapshotKey,
            kind: 'snapshot',
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            ownerUserId: this.ownerUserId,
            generation: nextGeneration,
            savedAt: new Date().toISOString(),
            bytes,
          } satisfies WebDatabaseSnapshot);
          nextState = {
            key: ACTIVE_KEY,
            kind: 'state',
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            ownerUserId: this.ownerUserId,
            epoch: current?.epoch ?? randomKey(),
            generation: nextGeneration,
            activeSnapshotKey: snapshotKey,
            previousSnapshotKey,
            quarantinedSnapshotKey: current?.quarantinedSnapshotKey ?? null,
            requiresCloudRebuild: false,
          };
          store.put(nextState);
          const obsoleteKey = current?.activeSnapshotKey ? current.previousSnapshotKey : null;
          if (obsoleteKey && obsoleteKey !== current?.quarantinedSnapshotKey) store.delete(obsoleteKey);
        } catch {
          transaction.abort();
        }
      };
      request.onerror = () => transaction.abort();
    })).then(() => {
      this.rememberState(nextState);
      this._needsCloudRebuild = false;
    }, (cause) => {
      throw cause instanceof Error && cause.name === 'AbortError' ? staleSnapshotError() : cause;
    });
  }

  private async quarantineBrokenState(): Promise<boolean> {
    let nextState: WebDatabaseSnapshotState | null = null;
    let recovered = false;
    await this.runReadWriteTransaction((store, transaction) => {
      const request = store.get(ACTIVE_KEY);
      request.onsuccess = () => {
        try {
          parseWebDatabaseSnapshotState(request.result, this.ownerUserId);
          transaction.abort();
        } catch {
          nextState = {
            key: ACTIVE_KEY,
            kind: 'state',
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            ownerUserId: this.ownerUserId,
            epoch: randomKey(),
            generation: 0,
            activeSnapshotKey: null,
            previousSnapshotKey: null,
            quarantinedSnapshotKey: null,
            requiresCloudRebuild: true,
          };
          store.put({
            key: QUARANTINED_STATE_KEY,
            kind: 'quarantined_state',
            ownerUserId: this.ownerUserId,
            quarantinedAt: new Date().toISOString(),
            value: request.result,
          });
          store.put(nextState);
          recovered = true;
        }
      };
      request.onerror = () => transaction.abort();
    }).catch((cause) => {
      if (!(cause instanceof Error && cause.name === 'AbortError')) throw cause;
    });
    if (recovered) this.rememberState(nextState);
    return recovered;
  }

  private currentIdentity(): WebDatabaseSnapshotIdentity | null {
    if (!this.epoch) return null;
    return {
      epoch: this.epoch,
      generation: this.generation,
      activeSnapshotKey: this.activeSnapshotKey,
    };
  }

  private rememberState(state: WebDatabaseSnapshotState | null): void {
    this.epoch = state?.epoch ?? null;
    this.generation = state?.generation ?? 0;
    this.activeSnapshotKey = state?.activeSnapshotKey ?? null;
  }

  private runReadWriteTransaction(
    write: (store: IDBObjectStore, transaction: IDBTransaction) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = this.database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
      } catch {
        transaction = this.database.transaction(STORE_NAME, 'readwrite');
      }
      write(transaction.objectStore(STORE_NAME), transaction);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('The local database could not be saved durably.'));
      transaction.onabort = () => reject(transaction.error ?? new DOMException('The local database save was interrupted.', 'AbortError'));
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isStateEpoch(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableKey(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

function sameIdentity(
  state: WebDatabaseSnapshotIdentity,
  expected: WebDatabaseSnapshotIdentity,
): boolean {
  return state.epoch === expected.epoch
    && state.generation === expected.generation
    && state.activeSnapshotKey === expected.activeSnapshotKey;
}

function sameNullableIdentity(
  state: WebDatabaseSnapshotState | null,
  expected: WebDatabaseSnapshotIdentity | null,
): boolean {
  if (!state || !expected) return state === null && expected === null;
  return sameIdentity(state, expected);
}

function staleSnapshotError(): Error {
  return new Error('This tab is stale because the account was updated elsewhere. Refresh before saving again.');
}

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
