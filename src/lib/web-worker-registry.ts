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

  install(scope: WorkerScope<TWorker>): void {
    if (this.installedScope === scope) return;
    if (this.installedScope) {
      throw new Error('Web worker tracking was already installed on another scope.');
    }

    const NativeWorker = scope.Worker;
    const workers = this.workers;
    const TrackingWorker = function (
      this: TWorker,
      scriptURL: string | URL,
      options?: WorkerOptions,
    ) {
      const worker = new NativeWorker(scriptURL, options);
      workers.add(worker);
      return worker;
    } as unknown as WorkerConstructor<TWorker>;

    Object.setPrototypeOf(TrackingWorker, NativeWorker);
    TrackingWorker.prototype = NativeWorker.prototype;
    scope.Worker = TrackingWorker;
    this.installedScope = scope;
  }

  terminateAll(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.clear();
  }

  get size(): number {
    return this.workers.size;
  }
}

export const webSQLiteWorkerRegistry = new WebWorkerRegistry();
