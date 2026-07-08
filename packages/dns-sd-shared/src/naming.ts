/**
 * Helpers for building and parsing DNS-SD service names (RFC 6763 §4, §7).
 *
 * A DNS-SD instance name looks like:
 *
 * ```text
 * Instance Name . _type . _proto . domain
 * "My Web Server._http._tcp.local"
 * ```
 *
 * A subtype-scoped service type looks like:
 *
 * ```text
 * _printer._sub._http._tcp.local
 * ```
 *
 * @module
 */

import type { TransportProtocol } from "./types.ts";

/** The meta-query used to enumerate all service types (RFC 6763 §9). */
export const SERVICE_TYPE_ENUMERATION = "_services._dns-sd._udp.local";

/** Default DNS-SD domain. */
export const DEFAULT_DOMAIN = "local";

/** A parsed DNS-SD instance or service name, split into its components. */
export interface ParsedServiceName {
  /** The instance name, or `null` for a bare service type. */
  instance: string | null;
  /** The service type without the leading underscore, e.g. `"http"`. */
  serviceType: string;
  /** The transport protocol from the `_tcp` / `_udp` label. */
  protocol: TransportProtocol;
  /** The trailing DNS-SD domain, e.g. `"local"`. */
  domain: string;
  /** Subtypes (without leading underscores), if the name was subtype-scoped. */
  subtypes: string[];
}

/** Build the service-type name labels, e.g. `["_http", "_tcp", "local"]`. */
export function serviceTypeLabels(
  type: string,
  protocol: TransportProtocol,
  domain = DEFAULT_DOMAIN,
): string[] {
  return [`_${type}`, `_${protocol}`, ...domain.split(".")];
}

/**
 * Build a subtype-scoped service-type name, e.g.
 * `["_printer", "_sub", "_http", "_tcp", "local"]`.
 */
export function subtypeServiceLabels(
  subtype: string,
  type: string,
  protocol: TransportProtocol,
  domain = DEFAULT_DOMAIN,
): string[] {
  return [`_${subtype}`, "_sub", ...serviceTypeLabels(type, protocol, domain)];
}

/** Build a full instance-name label array, e.g. `["My Server", "_http", "_tcp", "local"]`. */
export function instanceNameLabels(
  instance: string,
  type: string,
  protocol: TransportProtocol,
  domain = DEFAULT_DOMAIN,
): string[] {
  return [instance, ...serviceTypeLabels(type, protocol, domain)];
}

/**
 * Parse a DNS-SD name (as an array of labels) into its components.
 *
 * Handles bare service types (`_http._tcp.local`), instance names
 * (`Foo._http._tcp.local`) and subtype-scoped types
 * (`_printer._sub._http._tcp.local`). Returns `null` if the labels do not form
 * a recognisable DNS-SD name.
 */
export function parseServiceName(labels: string[]): ParsedServiceName | null {
  // Locate the `_proto` label (`_tcp` or `_udp`); the type is immediately before.
  let protoIndex = -1;
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if ((l === "_tcp" || l === "_udp") && i > 0) {
      protoIndex = i;
      break;
    }
  }
  if (protoIndex < 1 || protoIndex + 1 >= labels.length) return null;

  const protoLabel = labels[protoIndex] as string;
  const protocol: TransportProtocol = protoLabel === "_udp" ? "udp" : "tcp";
  const typeLabel = labels[protoIndex - 1] as string;
  if (!typeLabel.startsWith("_")) return null;
  const serviceType = typeLabel.slice(1);
  const domain = labels.slice(protoIndex + 1).join(".") || DEFAULT_DOMAIN;

  const prefix = labels.slice(0, protoIndex - 1);

  // Subtype-scoped: `_subtype._sub._type._proto...`
  if (prefix.length >= 2 && prefix[prefix.length - 1] === "_sub") {
    const subtypeLabel = prefix[prefix.length - 2] as string;
    const subtypes = [
      subtypeLabel.startsWith("_") ? subtypeLabel.slice(1) : subtypeLabel,
    ];
    const instanceLabels = prefix.slice(0, prefix.length - 2);
    return {
      instance: instanceLabels.length > 0 ? instanceLabels.join(".") : null,
      serviceType,
      protocol,
      domain,
      subtypes,
    };
  }

  // Otherwise the whole prefix (if any) is the instance name.
  return {
    instance: prefix.length > 0 ? prefix.join(".") : null,
    serviceType,
    protocol,
    domain,
    subtypes: [],
  };
}

/** Compare two names (label arrays) case-insensitively per RFC 6762 §16. */
export function namesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] as string).toLowerCase() !== (b[i] as string).toLowerCase()) {
      return false;
    }
  }
  return true;
}

/** Canonical, lower-cased dotted form of a name, for use as a map key. */
export function nameKey(labels: string[]): string {
  return labels.join(".").toLowerCase();
}
