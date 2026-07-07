/**
 * Testing utilities for `@momics/dns-sd-shared`: the in-memory loopback
 * transport (a virtual multicast bus) and the runner-agnostic conformance
 * suite. Runtime packages import these to prove identical behaviour against
 * their own backends.
 *
 * @module
 */

export { LoopbackTransport, VirtualBus } from "./loopback.ts";
export {
  type ConformanceCase,
  conformanceCases,
  type ConformanceHarness,
} from "./conformance.ts";
