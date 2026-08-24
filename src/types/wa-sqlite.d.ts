declare module '@jien/wa-sqlite' {
  const factory: (options?: {
    locateFile?: (path: string) => string;
    wasmBinary?: Uint8Array;
  }) => Promise<unknown>;
  export default factory;
}

declare module '@jien/wa-sqlite-api' {
  export function Factory(module: unknown): any;
}

declare module '@jien/wa-sqlite-constants' {
  export const SQLITE_DONE: number;
  export const SQLITE_OPEN_CREATE: number;
  export const SQLITE_OPEN_READWRITE: number;
  export const SQLITE_OK: number;
  export const SQLITE_ROW: number;
}

declare module '@jien/wa-sqlite-memory-vfs' {
  export class MemoryVFS {
    name: string;
    mapNameToFile: Map<string, unknown>;
    constructor();
    close(): void;
  }
}

declare module '@jien/wa-sqlite-wasm' {
  const assetUrl: string;
  export default assetUrl;
}

declare module 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  export class IDBBatchAtomicVFS {
    readonly name: string;
    constructor(
      databaseName?: string,
      options?: { durability?: 'default' | 'strict' | 'relaxed'; purge?: 'deferred' | 'manual'; purgeAtLeast?: number },
    );
    close(): Promise<void>;
    purge(path: string): Promise<void>;
  }
}
