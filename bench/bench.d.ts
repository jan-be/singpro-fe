// What the bench/ scripts share that no module declares: the hooks the pages put on window (run.ts and placement.ts
// drive them through Playwright), WebGPU's flag constants and Bun's transpiler. A script, not a module: everything
// here is global (tsconfig.bench.json only).

/** WebGPU's flag constants: lib.dom has the API but not these (@webgpu/types would replace them) */
declare var GPUBufferUsage: {
  readonly MAP_READ: number; readonly MAP_WRITE: number; readonly COPY_SRC: number; readonly COPY_DST: number;
  readonly INDEX: number; readonly VERTEX: number; readonly UNIFORM: number; readonly STORAGE: number;
  readonly INDIRECT: number; readonly QUERY_RESOLVE: number;
};
declare var GPUMapMode: { readonly READ: number; readonly WRITE: number };

/** Bun's transpiler, which the serve scripts (run with Bun) hand the pages' TypeScript through; @types/bun would replace this */
declare var Bun: {
  Transpiler: new (options: { loader: 'js' | 'jsx' | 'ts' | 'tsx' }) => { transformSync(code: string): string };
};

/** A worker's answer in ort-webgpu/bench-worker.ts: runLoop's numbers without the sample, or what went wrong */
type BenchWorkerResult =
  | ({ ep: string; hasGpu: boolean; createMs: number; warmupMs: number; error?: undefined } & Omit<import('./ort-webgpu/bench').LoopResult, 'sample'>)
  | { error: string; hasGpu: boolean };

/** ort-minimal/index.html's __run: one runtime's timings and its raw outputs (base64 float32), or its error */
type MinimalRun =
  | { rt: string; error: string }
  | {
    rt: string; error?: undefined; n: number; frames: number; initMs: number; importMs: number; sessionMs: number;
    firstRunMs: number; meanMs: number; medianMs: number; p90Ms: number; pitch: string; conf: string;
  };

interface Window {
  /** the page is set up */
  __ready?: boolean;
  /** ort-webgpu/index.html */
  __api: {
    build: string;
    hasGpu: boolean;
    gpu(): Promise<{ vendor?: string; architecture?: string; device?: string; description?: string; isFallback?: boolean } | { adapter: null } | null>;
    create(name: string, ep: string, opts?: import('./ort-webgpu/bench').BenchOptions, slots?: number):
      Promise<Pick<import('./ort-webgpu/bench').BenchSession, 'createMs' | 'warmupMs' | 'first'>>;
    run(name: string, runs: number): Promise<import('./ort-webgpu/bench').LoopResult>;
    realtime(name: string, seconds: number): Promise<import('./ort-webgpu/bench').RealtimeResult>;
    release(name: string): Promise<void>;
    readbackFloor(runs: number): Promise<import('./ort-webgpu/bench').Summary>;
    worker(ep: string, opts: import('./ort-webgpu/bench').BenchOptions | undefined, runs: number): Promise<BenchWorkerResult>;
  };
  /** ort-minimal/index.html */
  __info: { maxWindows: number; ua: string; variants: string[] };
  __run(args: { rt: string; n?: number }): Promise<MinimalRun>;
}
