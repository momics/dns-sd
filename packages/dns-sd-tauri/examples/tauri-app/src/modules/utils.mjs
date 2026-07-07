/**
 * Utility functions for the demo app
 */

export function getDnsSdApi() {
  const api = window.__TAURI_PLUGIN_DNS_SD__;
  if (!api) {
    throw new Error('dns-sd plugin not loaded. Please rebuild the app.');
  }
  return api;
}

export function formatAddresses(addresses) {
  if (!addresses || addresses.length === 0) return 'N/A';
  return addresses.join(', ');
}

export function formatTxtRecords(txt) {
  if (!txt || Object.keys(txt).length === 0) return 'None';
  return Object.entries(txt)
    .map(([key, value]) => {
      if (value === null) return `${key}=null`;
      if (value === true) return `${key}`;
      if (value instanceof Uint8Array) {
        return `${key}=[${value.length} bytes]`;
      }
      return `${key}=${value}`;
    })
    .join(', ');
}

export function formatTime(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
