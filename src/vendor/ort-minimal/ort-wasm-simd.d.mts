// Types for ort-wasm-simd.mjs, the Emscripten glue of our minimal ONNX Runtime build
// (tools/ort-minimal): the module's runtime helpers and the C functions of
// onnxruntime/wasm/api.h that ortMinimal.js calls. Pointers and handles are numbers
// (wasm32); the functions return 0 for success unless they hand back a handle.

/** What the module factory takes (Emscripten's Module object) */
export interface OrtWasmModuleArg {
  /** where to fetch the .wasm from */
  locateFile?: (path: string, prefix: string) => string;
  /** the .wasm's bytes, instead of fetching it */
  wasmBinary?: ArrayBuffer | Uint8Array;
}

/** The instantiated runtime */
export interface OrtWasmModule {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;

  stackSave(): number;
  stackRestore(sp: number): void;
  stackAlloc(size: number): number;
  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
  stringToUTF8(str: string, ptr: number, maxBytesToWrite: number): number;
  lengthBytesUTF8(str: string): number;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _OrtInit(numThreads: number, loggingLevel: number): number;
  _OrtGetLastError(errorCodeOffset: number, errorMessageOffset: number): void;
  _OrtCreateSessionOptions(graphOptimizationLevel: number, enableCpuMemArena: boolean, enableMemPattern: boolean,
    executionMode: number, enableProfiling: boolean, profileFilePrefix: number, logId: number,
    logSeverityLevel: number, logVerbosityLevel: number, optimizedModelFilePath: number): number;
  _OrtAddSessionConfigEntry(sessionOptionsHandle: number, configKey: number, configValue: number): number;
  _OrtReleaseSessionOptions(sessionOptionsHandle: number): number;
  _OrtCreateSession(dataOffset: number, dataLength: number, sessionOptionsHandle: number): number;
  _OrtReleaseSession(sessionHandle: number): number;
  _OrtGetInputOutputCount(sessionHandle: number, inputCountOffset: number, outputCountOffset: number): number;
  _OrtGetInputOutputMetadata(sessionHandle: number, index: number, namePtrOffset: number, metadataOffset: number): number;
  _OrtFree(ptr: number): number;
  _OrtCreateTensor(dataType: number, dataOffset: number, dataLength: number, dimsOffset: number, dimsLength: number,
    dataLocation: number): number;
  _OrtGetTensorData(tensorHandle: number, dataTypeOffset: number, dataOffset: number, dimsOffset: number,
    dimsLengthOffset: number): number;
  _OrtReleaseTensor(tensorHandle: number): number;
  _OrtRun(sessionHandle: number, inputNamesOffset: number, inputsOffset: number, inputCount: number,
    outputNamesOffset: number, outputCount: number, outputsOffset: number, runOptionsHandle: number): number;
}

/** Loads and instantiates the runtime */
declare function ortWasm(moduleArg?: OrtWasmModuleArg): Promise<OrtWasmModule>;
export default ortWasm;
