/**
 * A tiny, pure self-echo suppressor shared by the UDP transports.
 *
 * Multicast loopback delivers our own outgoing datagrams straight back to us.
 * Both the Node and Deno transports need to drop those echoes exactly once
 * without re-processing them, while still letting genuine peer traffic through.
 *
 * This helper captures that logic in one runtime-agnostic place: each outgoing
 * datagram is reduced to a cheap fixed-size {@link fingerprint} (length +
 * FNV-1a hash) and counted in a `Map`. An inbound datagram whose fingerprint
 * matches a remembered send consumes one credit and is reported as an echo.
 * Entries are bounded both by a TTL window and by a maximum entry count, so a
 * flood of sends whose echoes never arrive (e.g. loopback disabled) can't grow
 * memory without bound.
 *
 * It performs no I/O and reads the clock only through an injectable `now()`,
 * which keeps it trivially unit-testable.
 *
 * @module
 */

/** How long a remembered send stays eligible for echo suppression (ms). */
export const DEFAULT_ECHO_TTL_MS = 5000;
/** Default cap on tracked sends, in case echoes never arrive to consume them. */
export const DEFAULT_ECHO_MAX_ENTRIES = 256;

/** Options for constructing an {@link EchoSuppressor}. */
export interface EchoSuppressorOptions {
  /** TTL window for a remembered send. Defaults to {@link DEFAULT_ECHO_TTL_MS}. */
  ttlMs?: number;
  /**
   * Maximum number of distinct fingerprints to track. When exceeded, the
   * oldest entry is evicted. Defaults to {@link DEFAULT_ECHO_MAX_ENTRIES}.
   */
  maxEntries?: number;
  /** Clock source (ms). Defaults to {@link Date.now}. Injectable for tests. */
  now?: () => number;
}

/** Bookkeeping for a remembered send: how many echoes to swallow and when it expires. */
interface RememberedSend {
  count: number;
  expiresAt: number;
}

/**
 * A cheap content fingerprint (length + FNV-1a hash) used to recognise our own
 * looped-back datagrams. The key is fixed-size regardless of datagram length,
 * so it never allocates a datagram-sized string. Collisions only risk dropping
 * a peer packet that is byte-identical to one we just sent, which does not
 * occur for the distinct records each node advertises.
 */
export function fingerprint(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] as number;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Pure, bounded self-echo suppressor. Call {@link remember} for every datagram
 * you send and {@link consume} for every datagram you receive: `consume`
 * returns `true` (and swallows one credit) when the datagram is one of our own
 * looped-back echoes.
 */
export class EchoSuppressor {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly sends = new Map<string, RememberedSend>();

  /** Create a bounded suppressor for recently sent datagrams. */
  constructor(options: EchoSuppressorOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_ECHO_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_ECHO_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /** Record a datagram we're about to send so its loopback echo can be dropped. */
  remember(data: Uint8Array): void {
    const now = this.now();
    this.prune(now);
    const key = fingerprint(data);
    const expiresAt = now + this.ttlMs;
    const existing = this.sends.get(key);
    if (existing) {
      existing.count++;
      existing.expiresAt = expiresAt;
    } else {
      this.sends.set(key, { count: 1, expiresAt });
    }
    // Bound memory if echoes never come back (e.g. loopback disabled). Map
    // preserves insertion order, so the first key is the oldest.
    while (this.sends.size > this.maxEntries) {
      const oldest = this.sends.keys().next().value;
      if (oldest === undefined) break;
      this.sends.delete(oldest);
    }
  }

  /**
   * Whether `data` matches a datagram we recently sent (our own echo). A match
   * consumes one credit, so N identical sends suppress exactly N echoes.
   */
  consume(data: Uint8Array): boolean {
    const now = this.now();
    const key = fingerprint(data);
    const entry = this.sends.get(key);
    if (!entry || entry.expiresAt < now) {
      if (entry) this.sends.delete(key);
      return false;
    }
    entry.count--;
    if (entry.count <= 0) this.sends.delete(key);
    return true;
  }

  /** Forget every remembered send. */
  clear(): void {
    this.sends.clear();
  }

  /** Drop remembered sends whose suppression window has expired. */
  private prune(now: number): void {
    for (const [key, entry] of this.sends) {
      if (entry.expiresAt < now) this.sends.delete(key);
    }
  }
}
