---
id: ca1351
type: Document
created: '2026-02-26T16:59:31+01:00'
updated: '2026-03-20T11:04:01+01:00'
author: Willem Horsten
updated_by: Willem Horsten
---
# mDNS-SD Plugin Example

Minimal Tauri application demonstrating the mdns-sd plugin capabilities.

## Features

- **Browse Services**: Discover mDNS/DNS-SD services on the local network by type (HTTP, custom services, etc.)
- **Advertise Services**: Publish your own service to the network with custom port and TXT records
- **Real-time Updates**: Live service discovery with automatic UI refresh
- **Cross-platform**: Works on Desktop (macOS, Windows, Linux) and Mobile (iOS, Android)

## Running

```bash
# Development mode
npm install
npm run tauri dev

# Build for production
npm run tauri build
```

## Usage

### Browsing for Services

1. Enter a service type (e.g., `http`, `ssh`, `airplay`)
2. Select protocol (TCP or UDP)
3. Click "Start Browse"
4. Watch discovered services appear in real-time
5. Click "Stop Browse" to end discovery

### Advertising a Service

1. Enter service name (e.g., `MyApp`)
2. Enter service type (e.g., `http`)
3. Select protocol
4. Enter port number
5. Click "Start Advertise"
6. Service is now visible to other devices on the network
7. Click "Stop Advertise" to unpublish

## Implementation Notes

- Uses the plugin's `browse()` async iterator for streaming service updates
- AbortSignal integration for clean cancellation
- TXT records support binary data and boolean flags
- Services automatically marked active/inactive based on network presence

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
