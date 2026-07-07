/**
 * Helpers for discovering this host's local IP addresses, used both to build
 * the advertised A/AAAA records and to let the shared engine ignore our own
 * multicast echoes.
 *
 * @module
 */

import type { IpFamily } from "@momics/dns-sd-shared";

/**
 * Return this host's non-internal IP addresses for the given family, as
 * reported by {@linkcode Deno.networkInterfaces}. Loopback / internal
 * interfaces are excluded so advertised records point at addresses peers can
 * actually reach.
 *
 * Requires the `sys` permission (`--allow-sys`). If that permission is denied
 * the function returns an empty array rather than throwing.
 */
export function localInterfaceAddresses(family: IpFamily): string[] {
  let interfaces: Deno.NetworkInterfaceInfo[];
  try {
    interfaces = Deno.networkInterfaces();
  } catch {
    return [];
  }

  const addresses: string[] = [];
  for (const iface of interfaces) {
    if (iface.family !== family) continue;
    if (isInternalAddress(iface.address)) continue;
    if (!addresses.includes(iface.address)) addresses.push(iface.address);
  }
  return addresses;
}

/** Whether an address is a loopback / unspecified address we shouldn't advertise. */
function isInternalAddress(address: string): boolean {
  if (address === "0.0.0.0" || address === "::") return true;
  if (address === "::1") return true;
  if (address.startsWith("127.")) return true;
  // Strip a zone id (e.g. "fe80::1%en0") before checking link-local.
  const bare = address.split("%")[0] ?? address;
  // Link-local IPv6 (fe80::/10) is not useful for cross-host advertising.
  if (bare.toLowerCase().startsWith("fe80:")) return true;
  return false;
}

/**
 * A best-effort stable host name for this machine, used to derive the advertise
 * host when the caller doesn't specify one. Falls back to a generic name if the
 * `sys` permission is denied.
 */
export function localHostname(): string {
  try {
    return Deno.hostname();
  } catch {
    return "deno";
  }
}
