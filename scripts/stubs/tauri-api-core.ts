/**
 * Minimal local stand-in for `@tauri-apps/api/core`, used **only** by the
 * executable-docs checker (`scripts/check-docs-examples.ts`).
 *
 * The Tauri README examples import `@momics/dns-sd-tauri`, whose guest-js
 * binding depends on `@tauri-apps/api` — a third-party npm package. Resolving it
 * would force the otherwise-hermetic docs check to link npm packages into a
 * `node_modules` directory, which the zero-dependency CI verify job
 * (`nodeModulesDir: "none"`) deliberately does not provide. Redirecting the
 * specifier to this stub keeps the check fully offline and reproducible from a
 * clean checkout, while still type-checking every example against the **real**
 * `@momics/dns-sd` public API (which comes from the shared package, not Tauri).
 *
 * It reproduces only the surface the guest-js binding actually uses: the
 * generic {@link Channel} with a settable `onmessage`, and {@link invoke}.
 *
 * @module
 */

/** Stub of Tauri's `Channel<T>` — a one-way message sink from the Rust side. */
export class Channel<T> {
  /** Handler invoked for each message the plugin sends over this channel. */
  onmessage: (message: T) => void = () => {};
}

/** Stub of Tauri's `invoke` — dispatches a command to the Rust backend. */
export function invoke<T>(
  _cmd: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  return Promise.resolve(undefined as T);
}
