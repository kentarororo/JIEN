declare module '@jien/wa-sqlite' {
  const factory: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default factory;
}

declare module '@jien/wa-sqlite-api' {
  export function Factory(module: unknown): any;
}

declare module '@jien/wa-sqlite-constants' {
  export const SQLITE_DONE: number;
  export const SQLITE_OPEN_CREATE: number;
  export const SQLITE_OPEN_READWRITE: number;
  export const SQLITE_ROW: number;
}

declare module '@jien/wa-sqlite-memory-vfs' {
  export class MemoryVFS {
    static create(name: string, module: unknown): Promise<MemoryVFS>;
    close(): void;
  }
}

declare module '@jien/wa-sqlite-wasm' {
  const assetUrl: string;
  export default assetUrl;
}
