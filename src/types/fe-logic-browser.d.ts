// Browser APIs the logic modules use that lib.dom does not declare
export {};

declare global {
  /** Chromium's User-Agent Client Hints (platformHints.js) */
  interface NavigatorUAData {
    getHighEntropyValues(hints: string[]): Promise<{ platform?: string; platformVersion?: string; [hint: string]: unknown }>;
  }

  interface Navigator {
    /** Chromium only (not Safari, not Firefox) */
    userAgentData?: NavigatorUAData;
  }
}
