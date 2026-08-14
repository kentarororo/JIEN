type WorkerLike = {
  terminate: () => void;
};

type WorkerConstructor<TWorker extends WorkerLike = Worker> = new (
  scriptURL: string | URL,
  options?: WorkerOptions,
) => TWorker;

type WorkerScope<TWorker extends WorkerLike = Worker> = {
  Worker: WorkerConstructor<TWorker>;
};

/**
 * Tracks workers created after installation so a leaving web document can
 * terminate Expo SQLite's OPFS worker. Expo's VFS keeps its access-handle pool
 * open for the worker lifetime even after the SQLite connection is closed.
 */
export class WebWorkerRegistry<TWorker extends WorkerLike = Worker> {
  private installedScope: WorkerScope<TWorker> | null = null;
  private readonly workers = new Set<TWorker>();
  private shutDown = false;

  install(scope: WorkerScope<TWorker>): void {
    if (this.installedScope === scope) {
      // A deliberate gate remount (for example React's development effect
      // replay) begins a fresh ownership cycle in the same document.
      this.shutDown = false;
      return;
    }
    if (this.installedScope) {
      throw new Error('Web worker tracking was already installed on another scope.');
    }

    const NativeWorker = scope.Worker;
    const workers = this.workers;
    const thisRegistry = this;
    const TrackingWorker = function (
      this: TWorker,
      scriptURL: string | URL,
      options?: WorkerOptions,
    ) {
      const worker = new NativeWorker(scriptURL, options);
      if (thisRegistry.shutDown) {
        worker.terminate();
        return worker;
      }
      workers.add(worker);
      return worker;
    } as unknown as WorkerConstructor<TWorker>;

    Object.setPrototypeOf(TrackingWorker, NativeWorker);
    TrackingWorker.prototype = NativeWorker.prototype;
    scope.Worker = TrackingWorker;
    this.installedScope = scope;
    this.shutDown = false;
  }

  terminateAll(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.clear();
  }

  /**
   * Permanently relinquishes worker ownership for this document. Any worker
   * Expo creates after a handoff has begun is terminated immediately, closing
   * the final race between the broadcast event and React unmounting the
   * SQLiteProvider.
   */
  shutdown(): void {
    this.shutDown = true;
    this.terminateAll();
  }

  get size(): number {
    return this.workers.size;
  }
}

export const webSQLiteWorkerRegistry = new WebWorkerRegistry();
