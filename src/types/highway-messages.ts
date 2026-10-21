/**
 * The note highway worker's messages (HighwayWorker.ts; highwayRenderer.ts is
 * the page's side). Here rather than in the worker's file: the page imports
 * them, and the worker's file is checked for a worker's global scope only.
 */
import type { RecordedFrame, RecordedLayer } from '../logic/canvasRecorder';
import type { GLSceneFrame, SceneBuffers } from '../logic/glScene';

/** A recorded frame for the worker; `attached.layer`: the line's picture, when it changed. */
export interface HighwayFrame extends RecordedFrame {
  attached: { layer?: RecordedLayer };
}

/** Messages to the worker. */
export type HighwayWorkerRequest =
  | { type: 'init'; canvas: OffscreenCanvas; gl: boolean }
  | { type: 'frame'; width: number; height: number; frame: HighwayFrame }
  | { type: 'scene'; scene: GLSceneFrame };

/** Messages from the worker. */
export type HighwayWorkerReply =
  | { type: 'ready'; mode: 'gl' | '2d' }
  | { type: 'done'; ops: Float64Array<ArrayBuffer>; buffers?: undefined }
  | { type: 'done'; buffers: SceneBuffers; ops?: undefined }
  | { type: 'error'; message: string };
