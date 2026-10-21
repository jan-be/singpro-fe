/**
 * The server serves a song's chart and stems only to the browsers in a party
 * that sings it (singspree-be contentGate.ts: a cookie, joined to the party by
 * the page's socket). So this page asks for a chart once it is in its party:
 * the host's page once it made the party, a joiner's once its socket joined.
 * A request that comes too early anyway (a slow socket, a first visit whose
 * cookie arrived with the handshake) is refused with 403 and tried again.
 */

/** Whether the page is in its party yet (createPartyAccess) */
export interface PartyAccess {
  readonly ready: boolean;
  open(): void;
  wait(timeoutMs?: number): Promise<boolean>;
}

/** fetchInParty's tries, and what tests replace */
export interface FetchInPartyOptions {
  tries?: number;
  delayMs?: number;
  fetchImpl?: (url: string) => Promise<Response>;
  sleep?: (ms: number) => Promise<unknown>;
}

/** open() once the page is in its party; wait(ms) resolves true then, or false after ms */
export function createPartyAccess(): PartyAccess {
  let ready = false;
  const waiters: ((v: boolean) => void)[] = [];
  return {
    get ready() { return ready; },
    open() {
      if (ready) return;
      ready = true;
      for (const done of waiters.splice(0)) done(true);
    },
    wait(timeoutMs = 5000) {
      if (ready) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const done = (v: boolean) => { clearTimeout(timer); resolve(v); };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(done);
          if (i >= 0) waiters.splice(i, 1);
          resolve(false);
        }, timeoutMs);
        waiters.push(done);
      });
    },
  };
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** fetch(url), tried again while the server refuses it for want of a party (403): the page may be joining just now */
export async function fetchInParty(url: string, { tries = 4, delayMs = 800, fetchImpl = (u) => fetch(u), sleep = pause }: FetchInPartyOptions = {}): Promise<Response> {
  for (let i = 0; ; i++) {
    const resp = await fetchImpl(url);
    if (resp.status !== 403 || i >= tries - 1) return resp;
    await sleep(delayMs * (i + 1));
  }
}
