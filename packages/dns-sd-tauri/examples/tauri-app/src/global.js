"use strict";
var __TAURI_PLUGIN_DNS_SD__ = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // guest-js/index.ts
  var index_exports = {};
  __export(index_exports, {
    TauriDnsSdAdapter: () => TauriDnsSdAdapter,
    advertise: () => advertise,
    browse: () => browse,
    close: () => close
  });

  // ../../node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
  function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  }
  function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  }

  // ../../node_modules/@tauri-apps/api/core.js
  var _Channel_onmessage;
  var _Channel_nextMessageIndex;
  var _Channel_pendingMessages;
  var _Channel_messageEndIndex;
  var _Resource_rid;
  var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
  function transformCallback(callback, once = false) {
    return window.__TAURI_INTERNALS__.transformCallback(callback, once);
  }
  var Channel = class {
    constructor(onmessage) {
      _Channel_onmessage.set(this, void 0);
      _Channel_nextMessageIndex.set(this, 0);
      _Channel_pendingMessages.set(this, []);
      _Channel_messageEndIndex.set(this, void 0);
      __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
      }), "f");
      this.id = transformCallback((rawMessage) => {
        const index = rawMessage.index;
        if ("end" in rawMessage) {
          if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
            this.cleanupCallback();
          } else {
            __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
          }
          return;
        }
        const message = rawMessage.message;
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
            const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
            delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          }
          if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
            this.cleanupCallback();
          }
        } else {
          __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
        }
      });
    }
    cleanupCallback() {
      window.__TAURI_INTERNALS__.unregisterCallback(this.id);
    }
    set onmessage(handler) {
      __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
    }
    get onmessage() {
      return __classPrivateFieldGet(this, _Channel_onmessage, "f");
    }
    [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
      return `__CHANNEL__:${this.id}`;
    }
    toJSON() {
      return this[SERIALIZE_TO_IPC_FN]();
    }
  };
  async function invoke(cmd, args = {}, options) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
  }
  _Resource_rid = /* @__PURE__ */ new WeakMap();

  // ../dns-sd-shared/dist/src/wire/reader.js
  var WireError = class extends Error {
    name = "WireError";
    constructor(message) {
      super(message);
    }
  };
  var MAX_POINTER_JUMPS = 128;
  var MAX_NAME_LENGTH = 255;
  var MAX_LABEL_LENGTH = 63;
  var Reader = class {
    bytes;
    view;
    /** Current absolute read offset. */
    offset;
    constructor(bytes, offset = 0) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.offset = offset;
    }
    get length() {
      return this.bytes.byteLength;
    }
    get remaining() {
      return this.bytes.byteLength - this.offset;
    }
    ensure(count) {
      if (count < 0) {
        throw new WireError(`negative read length ${count}`);
      }
      if (this.offset + count > this.bytes.byteLength) {
        throw new WireError(`unexpected end of message: need ${count} byte(s) at offset ${this.offset}, only ${this.remaining} remaining`);
      }
    }
    u8() {
      this.ensure(1);
      const value = this.view.getUint8(this.offset);
      this.offset += 1;
      return value;
    }
    u16() {
      this.ensure(2);
      const value = this.view.getUint16(this.offset, false);
      this.offset += 2;
      return value;
    }
    u32() {
      this.ensure(4);
      const value = this.view.getUint32(this.offset, false);
      this.offset += 4;
      return value;
    }
    /** Read `count` raw bytes as a copy (never a view into the message). */
    take(count) {
      this.ensure(count);
      const slice = this.bytes.slice(this.offset, this.offset + count);
      this.offset += count;
      return slice;
    }
    /** Peek an unsigned byte at an absolute offset without moving the cursor. */
    peekU8(at) {
      if (at < 0 || at >= this.bytes.byteLength) {
        throw new WireError(`peek out of range at offset ${at}`);
      }
      return this.view.getUint8(at);
    }
    /**
     * Decode a domain name starting at the current offset, following
     * RFC 1035 §4.1.4 compression pointers. The cursor is advanced past the name
     * as it appears at the current position (i.e. past the first pointer, if
     * any); pointer targets are read out-of-band and do not move the cursor.
     *
     * Labels are decoded as Latin-1 (one byte per char) to preserve arbitrary
     * bytes losslessly, matching the reference implementation.
     */
    name() {
      const labels = [];
      let jumps = 0;
      let totalLength = 0;
      let cursor = this.offset;
      let advancedCursor = false;
      let minJumpTarget = this.bytes.byteLength;
      let pos = this.offset;
      for (; ; ) {
        if (pos < 0 || pos >= this.bytes.byteLength) {
          throw new WireError(`name label out of range at offset ${pos}`);
        }
        const len = this.view.getUint8(pos);
        if ((len & 192) === 192) {
          if (pos + 1 >= this.bytes.byteLength) {
            throw new WireError("truncated compression pointer");
          }
          const pointer = (len & 63) << 8 | this.view.getUint8(pos + 1);
          if (!advancedCursor) {
            cursor = pos + 2;
            advancedCursor = true;
          }
          if (++jumps > MAX_POINTER_JUMPS) {
            throw new WireError("too many compression-pointer jumps");
          }
          if (pointer >= minJumpTarget) {
            throw new WireError("compression pointer does not point backwards");
          }
          minJumpTarget = pointer;
          pos = pointer;
          continue;
        }
        if ((len & 192) !== 0) {
          throw new WireError(`reserved label length prefix at offset ${pos}`);
        }
        if (len === 0) {
          if (!advancedCursor) {
            cursor = pos + 1;
          }
          break;
        }
        if (len > MAX_LABEL_LENGTH) {
          throw new WireError(`label length ${len} exceeds ${MAX_LABEL_LENGTH}`);
        }
        if (pos + 1 + len > this.bytes.byteLength) {
          throw new WireError("label extends past end of message");
        }
        totalLength += len + 1;
        if (totalLength > MAX_NAME_LENGTH) {
          throw new WireError(`name exceeds ${MAX_NAME_LENGTH} bytes`);
        }
        let label = "";
        for (let i = 0; i < len; i++) {
          label += String.fromCharCode(this.view.getUint8(pos + 1 + i));
        }
        labels.push(label);
        pos += 1 + len;
      }
      this.offset = cursor;
      return labels;
    }
    /**
     * Decode a domain name that begins at an absolute offset (used for RDATA
     * that embeds names, when reading from a scoped sub-reader is inconvenient).
     */
    nameAt(at) {
      const saved = this.offset;
      this.offset = at;
      try {
        return this.name();
      } finally {
        this.offset = saved;
      }
    }
  };

  // ../dns-sd-shared/dist/src/wire/types.js
  var DnsClass;
  (function(DnsClass2) {
    DnsClass2[DnsClass2["IN"] = 1] = "IN";
    DnsClass2[DnsClass2["CS"] = 2] = "CS";
    DnsClass2[DnsClass2["CH"] = 3] = "CH";
    DnsClass2[DnsClass2["HS"] = 4] = "HS";
    DnsClass2[DnsClass2["ANY"] = 255] = "ANY";
  })(DnsClass || (DnsClass = {}));
  var Opcode;
  (function(Opcode2) {
    Opcode2[Opcode2["Query"] = 0] = "Query";
    Opcode2[Opcode2["IQuery"] = 1] = "IQuery";
    Opcode2[Opcode2["Status"] = 2] = "Status";
  })(Opcode || (Opcode = {}));
  var Rcode;
  (function(Rcode2) {
    Rcode2[Rcode2["NoError"] = 0] = "NoError";
    Rcode2[Rcode2["FormatError"] = 1] = "FormatError";
    Rcode2[Rcode2["ServerFailure"] = 2] = "ServerFailure";
    Rcode2[Rcode2["NameError"] = 3] = "NameError";
    Rcode2[Rcode2["NotImplemented"] = 4] = "NotImplemented";
    Rcode2[Rcode2["Refused"] = 5] = "Refused";
  })(Rcode || (Rcode = {}));
  var ResourceType;
  (function(ResourceType2) {
    ResourceType2[ResourceType2["A"] = 1] = "A";
    ResourceType2[ResourceType2["PTR"] = 12] = "PTR";
    ResourceType2[ResourceType2["TXT"] = 16] = "TXT";
    ResourceType2[ResourceType2["AAAA"] = 28] = "AAAA";
    ResourceType2[ResourceType2["SRV"] = 33] = "SRV";
    ResourceType2[ResourceType2["NSEC"] = 47] = "NSEC";
    ResourceType2[ResourceType2["ANY"] = 255] = "ANY";
  })(ResourceType || (ResourceType = {}));
  function isA(rr) {
    return rr.type === ResourceType.A;
  }
  function isAAAA(rr) {
    return rr.type === ResourceType.AAAA;
  }
  function isPTR(rr) {
    return rr.type === ResourceType.PTR;
  }
  function isTXT(rr) {
    return rr.type === ResourceType.TXT;
  }
  function isSRV(rr) {
    return rr.type === ResourceType.SRV;
  }
  function isNSEC(rr) {
    return rr.type === ResourceType.NSEC;
  }

  // ../dns-sd-shared/dist/src/wire/decode.js
  var HEADER_LENGTH = 12;
  function decodeMessage(bytes) {
    if (bytes.byteLength < HEADER_LENGTH) {
      throw new WireError(`message too short: ${bytes.byteLength} bytes (need at least ${HEADER_LENGTH})`);
    }
    const reader = new Reader(bytes);
    const id = reader.u16();
    const flags = reader.u16();
    const qdCount = reader.u16();
    const anCount = reader.u16();
    const nsCount = reader.u16();
    const arCount = reader.u16();
    const header = {
      id,
      isResponse: (flags & 32768) !== 0,
      opcode: flags >> 11 & 15,
      authoritative: (flags & 1024) !== 0,
      truncated: (flags & 512) !== 0,
      recursionDesired: (flags & 256) !== 0,
      recursionAvailable: (flags & 128) !== 0,
      rcode: flags & 15
    };
    const questions = [];
    for (let i = 0; i < qdCount; i++) {
      questions.push(decodeQuestion(reader));
    }
    const answers = decodeRecords(reader, anCount);
    const authorities = decodeRecords(reader, nsCount);
    const additionals = decodeRecords(reader, arCount);
    return { header, questions, answers, authorities, additionals };
  }
  function decodeQuestion(reader) {
    const name = reader.name();
    const type = reader.u16();
    const rawClass = reader.u16();
    return {
      name,
      type,
      // The top bit of QCLASS is the mDNS unicast-response (QU) bit.
      class: rawClass & 32767,
      unicastResponse: (rawClass & 32768) !== 0
    };
  }
  function decodeRecords(reader, count) {
    const records = [];
    for (let i = 0; i < count; i++) {
      records.push(decodeRecord(reader));
    }
    return records;
  }
  function decodeRecord(reader) {
    const name = reader.name();
    const type = reader.u16();
    const rawClass = reader.u16();
    const ttl = reader.u32();
    const rdLength = reader.u16();
    const rdataStart = reader.offset;
    const rdataEnd = rdataStart + rdLength;
    if (rdataEnd > reader.length) {
      throw new WireError(`RDATA of length ${rdLength} at offset ${rdataStart} extends past end of message`);
    }
    const base = {
      name,
      class: rawClass & 32767,
      ttl,
      // The top bit of the RR CLASS is the mDNS cache-flush bit.
      flush: (rawClass & 32768) !== 0
    };
    let record;
    switch (type) {
      case ResourceType.A: {
        if (rdLength !== 4) {
          throw new WireError(`A record RDATA must be 4 bytes, got ${rdLength}`);
        }
        const address = [reader.u8(), reader.u8(), reader.u8(), reader.u8()];
        record = { ...base, type: ResourceType.A, data: { kind: "A", address } };
        break;
      }
      case ResourceType.AAAA: {
        if (rdLength !== 16) {
          throw new WireError(`AAAA record RDATA must be 16 bytes, got ${rdLength}`);
        }
        const parts = [];
        for (let i = 0; i < 8; i++)
          parts.push(reader.u16().toString(16));
        record = {
          ...base,
          type: ResourceType.AAAA,
          data: { kind: "AAAA", address: compressIpv6(parts) }
        };
        break;
      }
      case ResourceType.PTR: {
        record = {
          ...base,
          type: ResourceType.PTR,
          data: { kind: "PTR", name: reader.name() }
        };
        break;
      }
      case ResourceType.TXT: {
        record = {
          ...base,
          type: ResourceType.TXT,
          data: { kind: "TXT", attributes: decodeTxt(reader, rdataEnd) }
        };
        break;
      }
      case ResourceType.SRV: {
        const priority = reader.u16();
        const weight = reader.u16();
        const port = reader.u16();
        const target = reader.name();
        record = {
          ...base,
          type: ResourceType.SRV,
          data: { kind: "SRV", priority, weight, port, target }
        };
        break;
      }
      case ResourceType.NSEC: {
        const nextDomainName = reader.name();
        const types = decodeNsecBitmap(reader, rdataEnd);
        record = {
          ...base,
          type: ResourceType.NSEC,
          data: { kind: "NSEC", nextDomainName, types }
        };
        break;
      }
      default: {
        record = {
          ...base,
          type,
          data: { kind: "RAW", bytes: reader.take(rdLength) }
        };
        break;
      }
    }
    reader.offset = rdataEnd;
    return record;
  }
  function decodeTxt(reader, rdataEnd) {
    const attributes = {};
    while (reader.offset < rdataEnd) {
      const len = reader.u8();
      if (len === 0) {
        continue;
      }
      if (reader.offset + len > rdataEnd) {
        throw new WireError("TXT attribute extends past RDATA");
      }
      const raw = reader.take(len);
      let eq = -1;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === 61) {
          eq = i;
          break;
        }
      }
      if (eq === -1) {
        attributes[latin1(raw)] = true;
      } else {
        const key = latin1(raw.subarray(0, eq));
        const value = raw.subarray(eq + 1);
        attributes[key] = value.length === 0 ? null : value.slice();
      }
    }
    return attributes;
  }
  function decodeNsecBitmap(reader, rdataEnd) {
    const types = [];
    while (reader.offset < rdataEnd) {
      const windowBlock = reader.u8();
      const bitmapLength = reader.u8();
      if (bitmapLength < 1 || bitmapLength > 32) {
        throw new WireError(`invalid NSEC bitmap length ${bitmapLength}`);
      }
      if (reader.offset + bitmapLength > rdataEnd) {
        throw new WireError("NSEC bitmap extends past RDATA");
      }
      const bitmap = reader.take(bitmapLength);
      for (let i = 0; i < bitmap.length; i++) {
        const octet = bitmap[i];
        if (octet === 0)
          continue;
        for (let bit = 0; bit < 8; bit++) {
          if (octet & 1 << 7 - bit) {
            types.push(windowBlock * 256 + i * 8 + bit);
          }
        }
      }
    }
    return types;
  }
  function latin1(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }
  function compressIpv6(groups) {
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i] === "0") {
        if (curStart === -1)
          curStart = i;
        curLen++;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    }
    if (bestLen < 2)
      return groups.join(":");
    const head = groups.slice(0, bestStart).join(":");
    const tail = groups.slice(bestStart + bestLen).join(":");
    return `${head}::${tail}`;
  }

  // ../dns-sd-shared/dist/src/wire/encode.js
  var MAX_POINTER_OFFSET = 16383;
  var Writer = class {
    buf;
    len = 0;
    /** Map of `labels.join('\x00')` suffix → absolute byte offset. */
    names = /* @__PURE__ */ new Map();
    constructor(initial = 512) {
      this.buf = new Uint8Array(initial);
    }
    ensure(extra) {
      const needed = this.len + extra;
      if (needed <= this.buf.byteLength)
        return;
      let size = this.buf.byteLength * 2;
      while (size < needed)
        size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    get offset() {
      return this.len;
    }
    u8(value) {
      this.ensure(1);
      this.buf[this.len++] = value & 255;
    }
    u16(value) {
      this.ensure(2);
      this.buf[this.len++] = value >> 8 & 255;
      this.buf[this.len++] = value & 255;
    }
    u32(value) {
      this.ensure(4);
      this.buf[this.len++] = value >>> 24 & 255;
      this.buf[this.len++] = value >>> 16 & 255;
      this.buf[this.len++] = value >>> 8 & 255;
      this.buf[this.len++] = value & 255;
    }
    bytes(data) {
      this.ensure(data.byteLength);
      this.buf.set(data, this.len);
      this.len += data.byteLength;
    }
    /** Reserve a 16-bit length placeholder; returns a setter for the final value. */
    reserveU16() {
      const at = this.len;
      this.u16(0);
      return (value) => {
        this.buf[at] = value >> 8 & 255;
        this.buf[at + 1] = value & 255;
      };
    }
    /** Write a domain name, compressing against previously written suffixes. */
    name(labels) {
      for (let i = 0; i < labels.length; i++) {
        const suffix = labels.slice(i);
        const key = suffix.join("\0");
        const pointer = this.names.get(key);
        if (pointer !== void 0) {
          this.u16(49152 | pointer);
          return;
        }
        if (this.len <= MAX_POINTER_OFFSET) {
          this.names.set(key, this.len);
        }
        const label = labels[i];
        const bytes = latin1Bytes(label);
        if (bytes.byteLength > 63) {
          throw new RangeError(`label "${label}" exceeds 63 bytes`);
        }
        this.u8(bytes.byteLength);
        this.bytes(bytes);
      }
      this.u8(0);
    }
    finish() {
      return this.buf.slice(0, this.len);
    }
  };
  function encodeMessage(message) {
    const writer = new Writer();
    const h = message.header;
    let flags = 0;
    if (h.isResponse)
      flags |= 32768;
    flags |= (h.opcode & 15) << 11;
    if (h.authoritative)
      flags |= 1024;
    if (h.truncated)
      flags |= 512;
    if (h.recursionDesired)
      flags |= 256;
    if (h.recursionAvailable)
      flags |= 128;
    flags |= h.rcode & 15;
    writer.u16(h.id);
    writer.u16(flags);
    writer.u16(message.questions.length);
    writer.u16(message.answers.length);
    writer.u16(message.authorities.length);
    writer.u16(message.additionals.length);
    for (const q of message.questions)
      encodeQuestion(writer, q);
    for (const rr of message.answers)
      encodeRecord(writer, rr);
    for (const rr of message.authorities)
      encodeRecord(writer, rr);
    for (const rr of message.additionals)
      encodeRecord(writer, rr);
    return writer.finish();
  }
  function encodeQuestion(writer, q) {
    writer.name(q.name);
    writer.u16(q.type);
    writer.u16(q.class & 32767 | (q.unicastResponse ? 32768 : 0));
  }
  function encodeRecord(writer, rr) {
    writer.name(rr.name);
    writer.u16(rr.type);
    writer.u16(rr.class & 32767 | (rr.flush ? 32768 : 0));
    writer.u32(rr.ttl >>> 0);
    const setLength = writer.reserveU16();
    const start = writer.offset;
    if (isA(rr)) {
      for (let i = 0; i < 4; i++)
        writer.u8(rr.data.address[i] ?? 0);
    } else if (isAAAA(rr)) {
      writer.bytes(encodeIpv6(rr.data.address));
    } else if (isPTR(rr)) {
      writer.name(rr.data.name);
    } else if (isTXT(rr)) {
      encodeTxt(writer, rr.data.attributes);
    } else if (isSRV(rr)) {
      writer.u16(rr.data.priority);
      writer.u16(rr.data.weight);
      writer.u16(rr.data.port);
      writer.name(rr.data.target);
    } else if (isNSEC(rr)) {
      writer.name(rr.data.nextDomainName);
      encodeNsecBitmap(writer, rr.data.types);
    } else {
      writer.bytes(rr.data.bytes);
    }
    setLength(writer.offset - start);
  }
  function encodeTxt(writer, attributes) {
    const keys = Object.keys(attributes);
    if (keys.length === 0) {
      writer.u8(0);
      return;
    }
    for (const key of keys) {
      const value = attributes[key];
      const keyBytes = latin1Bytes(key);
      let entry;
      if (value === true) {
        entry = keyBytes;
      } else if (value === null || value === void 0) {
        entry = concat(keyBytes, EQUALS);
      } else {
        entry = concat(keyBytes, EQUALS, value);
      }
      if (entry.byteLength > 255) {
        throw new RangeError(`TXT attribute "${key}" exceeds 255 bytes`);
      }
      writer.u8(entry.byteLength);
      writer.bytes(entry);
    }
  }
  function encodeNsecBitmap(writer, types) {
    const inWindow = types.filter((t) => t >= 0 && t <= 255);
    if (inWindow.length === 0) {
      writer.u8(0);
      writer.u8(0);
      return;
    }
    const maxType = Math.max(...inWindow);
    const bitmapLength = Math.floor(maxType / 8) + 1;
    const bitmap = new Uint8Array(bitmapLength);
    for (const t of inWindow) {
      const idx = Math.floor(t / 8);
      bitmap[idx] = bitmap[idx] | 1 << 7 - t % 8;
    }
    writer.u8(0);
    writer.u8(bitmapLength);
    writer.bytes(bitmap);
  }
  var EQUALS = new Uint8Array([61]);
  function concat(...parts) {
    let total = 0;
    for (const p of parts)
      total += p.byteLength;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.byteLength;
    }
    return out;
  }
  function latin1Bytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      out[i] = str.charCodeAt(i) & 255;
    }
    return out;
  }
  function encodeIpv6(address) {
    const bytes = new Uint8Array(16);
    const halves = address.split("::");
    if (halves.length > 2) {
      throw new RangeError(`invalid IPv6 address "${address}"`);
    }
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const groups = [];
    for (const g of head)
      groups.push(parseGroup(g, address));
    if (halves.length === 2) {
      const zeros = 8 - head.length - tail.length;
      if (zeros < 0)
        throw new RangeError(`invalid IPv6 address "${address}"`);
      for (let i = 0; i < zeros; i++)
        groups.push(0);
      for (const g of tail)
        groups.push(parseGroup(g, address));
    }
    if (groups.length !== 8) {
      throw new RangeError(`invalid IPv6 address "${address}"`);
    }
    for (let i = 0; i < 8; i++) {
      const value = groups[i];
      bytes[i * 2] = value >> 8 & 255;
      bytes[i * 2 + 1] = value & 255;
    }
    return bytes;
  }
  function parseGroup(group, address) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      throw new RangeError(`invalid IPv6 group "${group}" in "${address}"`);
    }
    return parseInt(group, 16);
  }

  // ../dns-sd-shared/dist/src/engine/constants.js
  var DEFAULT_TIMING = {
    initialQueryMinMs: 20,
    initialQueryMaxMs: 120,
    queryIntervalStartMs: 1e3,
    queryIntervalMaxMs: 60 * 60 * 1e3,
    probeDelayMaxMs: 250,
    probeIntervalMs: 250,
    probeCount: 3,
    announceIntervalMs: 1e3,
    announceCount: 2,
    goodbyeGraceMs: 1e3,
    responseAggregationMinMs: 20,
    responseAggregationMaxMs: 120
  };
  var TTL_SHARED = 4500;
  var TTL_HOST = 120;

  // ../dns-sd-shared/dist/src/naming.js
  var SERVICE_TYPE_ENUMERATION = "_services._dns-sd._udp.local";
  var DEFAULT_DOMAIN = "local";
  function serviceTypeLabels(type, protocol, domain = DEFAULT_DOMAIN) {
    return [`_${type}`, `_${protocol}`, ...domain.split(".")];
  }
  function subtypeServiceLabels(subtype, type, protocol, domain = DEFAULT_DOMAIN) {
    return [`_${subtype}`, "_sub", ...serviceTypeLabels(type, protocol, domain)];
  }
  function instanceNameLabels(instance, type, protocol, domain = DEFAULT_DOMAIN) {
    return [instance, ...serviceTypeLabels(type, protocol, domain)];
  }
  function parseServiceName(labels) {
    let protoIndex = -1;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if ((l === "_tcp" || l === "_udp") && i > 0) {
        protoIndex = i;
        break;
      }
    }
    if (protoIndex < 1 || protoIndex + 1 >= labels.length)
      return null;
    const protoLabel = labels[protoIndex];
    const protocol = protoLabel === "_udp" ? "udp" : "tcp";
    const typeLabel = labels[protoIndex - 1];
    if (!typeLabel.startsWith("_"))
      return null;
    const serviceType = typeLabel.slice(1);
    const domain = labels.slice(protoIndex + 1).join(".") || DEFAULT_DOMAIN;
    const prefix = labels.slice(0, protoIndex - 1);
    if (prefix.length >= 2 && prefix[prefix.length - 1] === "_sub") {
      const subtypeLabel = prefix[prefix.length - 2];
      const subtypes = [
        subtypeLabel.startsWith("_") ? subtypeLabel.slice(1) : subtypeLabel
      ];
      const instanceLabels = prefix.slice(0, prefix.length - 2);
      return {
        instance: instanceLabels.length > 0 ? instanceLabels.join(".") : null,
        serviceType,
        protocol,
        domain,
        subtypes
      };
    }
    return {
      instance: prefix.length > 0 ? prefix.join(".") : null,
      serviceType,
      protocol,
      domain,
      subtypes: []
    };
  }
  function namesEqual(a, b) {
    if (a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].toLowerCase() !== b[i].toLowerCase()) {
        return false;
      }
    }
    return true;
  }
  function nameKey(labels) {
    return labels.join(".").toLowerCase();
  }

  // ../dns-sd-shared/dist/src/txt.js
  var utf8 = new TextEncoder();
  function encodeTxtInput(input) {
    const attributes = {};
    if (!input)
      return attributes;
    for (const key of Object.keys(input)) {
      attributes[key] = normalizeTxtValue(key, input[key]);
    }
    return attributes;
  }
  function normalizeTxtValue(key, value) {
    if (value === true)
      return true;
    if (value === null || value === void 0)
      return null;
    if (value instanceof Uint8Array)
      return value;
    if (typeof value === "string")
      return utf8.encode(value);
    throw new TypeError(`TXT record "${key}" must be a string, Uint8Array, true, or null`);
  }
  function txtFromAttributes(attributes) {
    const out = {};
    for (const key of Object.keys(attributes)) {
      out[key] = attributes[key];
    }
    return out;
  }

  // ../dns-sd-shared/dist/src/fast_fifo.js
  var END = Symbol("fifo.end");
  var FixedFIFO = class {
    buffer;
    mask;
    top = 0;
    btm = 0;
    next = null;
    constructor(hwm) {
      if (!(hwm > 0) || (hwm - 1 & hwm) !== 0) {
        throw new Error("FixedFIFO size must be a power of two");
      }
      this.buffer = new Array(hwm);
      this.mask = hwm - 1;
    }
    push(data) {
      if (this.buffer[this.top] !== void 0)
        return false;
      this.buffer[this.top] = data;
      this.top = this.top + 1 & this.mask;
      return true;
    }
    shift() {
      const last = this.buffer[this.btm];
      if (last === void 0)
        return void 0;
      this.buffer[this.btm] = void 0;
      this.btm = this.btm + 1 & this.mask;
      return last;
    }
    isEmpty() {
      return this.buffer[this.btm] === void 0;
    }
  };
  var FastFIFO = class {
    head;
    tail;
    resolve = null;
    closed = false;
    constructor(hwm = 16) {
      this.head = new FixedFIFO(hwm);
      this.tail = this.head;
    }
    push(value) {
      if (this.closed)
        return;
      this.enqueue(value);
    }
    enqueue(value) {
      if (this.resolve) {
        const resolve = this.resolve;
        this.resolve = null;
        resolve(value);
        return;
      }
      if (!this.head.push(value)) {
        const prev = this.head;
        this.head = prev.next = new FixedFIFO(prev.buffer.length * 2);
        this.head.push(value);
      }
    }
    shift() {
      let value = this.tail.shift();
      if (value === void 0 && this.tail.next) {
        const next = this.tail.next;
        this.tail.next = null;
        this.tail = next;
        value = this.tail.shift();
      }
      return value;
    }
    /** Close the queue; iterators drain any buffered items and then finish. */
    close() {
      if (this.closed)
        return;
      this.closed = true;
      this.enqueue(END);
    }
    async *[Symbol.asyncIterator]() {
      for (; ; ) {
        const shifted = this.shift();
        const value = shifted !== void 0 ? shifted : await new Promise((res) => {
          this.resolve = res;
        });
        if (value === END)
          return;
        yield value;
      }
    }
  };

  // ../dns-sd-shared/dist/src/engine/records.js
  function recordKey(rr) {
    return `${nameKey(rr.name)}|${rr.type}|${bytesToHex(canonicalRdata(rr))}`;
  }
  function recordNameTypeKey(rr) {
    return `${nameKey(rr.name)}|${rr.type}`;
  }
  function canonicalRdata(rr) {
    if (isA(rr))
      return Uint8Array.from(rr.data.address.slice(0, 4));
    if (isAAAA(rr))
      return encodeIpv6(rr.data.address);
    if (isPTR(rr))
      return canonicalName(rr.data.name);
    if (isSRV(rr)) {
      const head = new Uint8Array(6);
      const dv = new DataView(head.buffer);
      dv.setUint16(0, rr.data.priority);
      dv.setUint16(2, rr.data.weight);
      dv.setUint16(4, rr.data.port);
      return concat2(head, canonicalName(rr.data.target));
    }
    if (isTXT(rr)) {
      const parts = [];
      for (const key of Object.keys(rr.data.attributes)) {
        const value = rr.data.attributes[key];
        const keyBytes = latin12(key);
        let entry;
        if (value === true)
          entry = keyBytes;
        else if (value === null || value === void 0) {
          entry = concat2(keyBytes, EQUALS2);
        } else
          entry = concat2(keyBytes, EQUALS2, value);
        parts.push(Uint8Array.from([entry.byteLength]), entry);
      }
      return concat2(...parts);
    }
    if (isNSEC(rr))
      return canonicalName(rr.data.nextDomainName);
    return rr.data.bytes;
  }
  function compareRdata(a, b) {
    const ab = canonicalRdata(a);
    const bb = canonicalRdata(b);
    const len = Math.max(ab.byteLength, bb.byteLength);
    for (let i = 0; i < len; i++) {
      const av = i < ab.byteLength ? ab[i] : -1;
      const bv = i < bb.byteLength ? bb[i] : -1;
      if (av < bv)
        return -1;
      if (av > bv)
        return 1;
    }
    return 0;
  }
  function recordSort(a, b) {
    if (a.class !== b.class)
      return a.class < b.class ? -1 : 1;
    if (a.type !== b.type)
      return a.type < b.type ? -1 : 1;
    return compareRdata(a, b);
  }
  function canonicalName(labels) {
    const parts = [];
    for (const label of labels) {
      const bytes = latin12(label.toLowerCase());
      parts.push(Uint8Array.from([bytes.byteLength]), bytes);
    }
    parts.push(Uint8Array.from([0]));
    return concat2(...parts);
  }
  var EQUALS2 = new Uint8Array([61]);
  function latin12(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++)
      out[i] = str.charCodeAt(i) & 255;
    return out;
  }
  function concat2(...parts) {
    let total = 0;
    for (const p of parts)
      total += p.byteLength;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.byteLength;
    }
    return out;
  }
  function bytesToHex(bytes) {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  // ../dns-sd-shared/dist/src/engine/cache.js
  var RecordCache = class {
    entries = /* @__PURE__ */ new Map();
    timing;
    onRequery;
    emit;
    closed = false;
    constructor(opts) {
      this.timing = opts.timing;
      this.onRequery = opts.onRequery;
      this.emit = opts.emit;
    }
    /** All currently cached records. */
    records() {
      return Array.from(this.entries.values(), (e) => e.record);
    }
    /** Cached records answering a (name, type) question, for known-answer suppression. */
    knownAnswers(nameTypeKey) {
      const out = [];
      for (const entry of this.entries.values()) {
        if (recordNameTypeKey(entry.record) === nameTypeKey) {
          out.push(entry.record);
        }
      }
      return out;
    }
    /** Add or refresh a record received from the network. */
    add(record) {
      if (this.closed)
        return;
      if (record.ttl === 0) {
        this.scheduleGoodbye(record);
        return;
      }
      if (record.flush) {
        this.flushSiblings(record);
      }
      const key = recordKey(record);
      const existing = this.entries.get(key);
      if (existing) {
        this.clearTimers(existing);
        existing.record = record;
        existing.timers = this.scheduleLifetime(record);
        return;
      }
      const entry = {
        record,
        timers: this.scheduleLifetime(record)
      };
      this.entries.set(key, entry);
      this.emit({ kind: "added", record });
    }
    flushSiblings(record) {
      const group = recordNameTypeKey(record);
      for (const [key, entry] of this.entries) {
        if (recordNameTypeKey(entry.record) === group && compareRdata(entry.record, record) !== 0) {
          this.clearTimers(entry);
          this.entries.delete(key);
          this.emit({ kind: "removed", record: entry.record });
        }
      }
    }
    scheduleGoodbye(record) {
      const key = recordKey(record);
      const existing = this.entries.get(key);
      if (!existing)
        return;
      this.clearTimers(existing);
      existing.timers = [
        setTimeout(() => this.expire(key), this.timing.goodbyeGraceMs)
      ];
    }
    scheduleLifetime(record) {
      const key = recordKey(record);
      const lifetimeMs = record.ttl * 1e3;
      const timers = [setTimeout(() => this.expire(key), lifetimeMs)];
      for (const pct of [80, 85, 90, 95]) {
        const jitter = pct + Math.random() * 2;
        timers.push(setTimeout(() => {
          if (this.entries.has(key))
            this.onRequery(record);
        }, jitter / 100 * lifetimeMs));
      }
      return timers;
    }
    expire(key) {
      const entry = this.entries.get(key);
      if (!entry)
        return;
      this.clearTimers(entry);
      this.entries.delete(key);
      this.emit({ kind: "removed", record: entry.record });
    }
    clearTimers(entry) {
      for (const timer of entry.timers)
        clearTimeout(timer);
      entry.timers = [];
    }
    /** Remove all records and stop all timers. */
    close() {
      this.closed = true;
      for (const entry of this.entries.values())
        this.clearTimers(entry);
      this.entries.clear();
    }
  };

  // ../dns-sd-shared/dist/src/engine/query.js
  var Browser = class {
    ctx;
    serviceLabels;
    serviceKey;
    output = new FastFIFO();
    cache;
    instances = /* @__PURE__ */ new Map();
    targets = /* @__PURE__ */ new Map();
    timers = /* @__PURE__ */ new Set();
    suppressNextQuery = false;
    closed = false;
    constructor(ctx, spec) {
      this.ctx = ctx;
      const subtype = spec.subtypes?.[0];
      this.serviceLabels = subtype ? subtypeServiceLabels(subtype, spec.type, spec.protocol, spec.domain) : serviceTypeLabels(spec.type, spec.protocol, spec.domain);
      this.serviceKey = nameKey(this.serviceLabels);
      this.cache = new RecordCache({
        timing: ctx.timing,
        onRequery: (record) => this.sendQuery([{ name: record.name, type: record.type }]),
        emit: (event) => this.onCacheEvent(event.kind, event.record)
      });
      ctx.register(this);
      this.scheduleInitialQuery();
    }
    /** The async stream of discovery events. */
    events() {
      return this.output;
    }
    // ── Query scheduling ───────────────────────────────────────────────────────
    schedule(delayMs, fn) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.closed)
          fn();
      }, delayMs);
      this.timers.add(timer);
    }
    scheduleInitialQuery() {
      const t = this.ctx.timing;
      const delay = t.initialQueryMinMs + Math.random() * (t.initialQueryMaxMs - t.initialQueryMinMs);
      this.schedule(delay, () => {
        this.sendPtrQuery();
        this.scheduleNextQuery(t.queryIntervalStartMs);
      });
    }
    scheduleNextQuery(intervalMs) {
      this.schedule(intervalMs, () => {
        this.sendPtrQuery();
        this.scheduleNextQuery(Math.min(intervalMs * 2, this.ctx.timing.queryIntervalMaxMs));
      });
    }
    sendPtrQuery() {
      if (this.suppressNextQuery) {
        this.suppressNextQuery = false;
        return;
      }
      this.sendQuery([{ name: this.serviceLabels, type: ResourceType.PTR }]);
    }
    sendQuery(questions) {
      if (this.closed || questions.length === 0)
        return;
      const knownAnswers = [];
      for (const q of questions) {
        if (q.type === ResourceType.PTR) {
          for (const rec of this.cache.knownAnswers(nameKey(q.name) + "|" + q.type)) {
            knownAnswers.push(rec);
          }
        }
      }
      this.ctx.send({
        header: emptyQueryHeader(),
        questions: questions.map((q) => ({
          name: q.name,
          type: q.type,
          class: DnsClass.IN,
          unicastResponse: false
        })),
        answers: knownAnswers,
        authorities: [],
        additionals: []
      });
    }
    // ── Incoming messages ────────────────────────────────────────────────────────
    /** Called by the engine for every decoded response. */
    onResponse(message) {
      if (this.closed)
        return;
      const all = [...message.answers, ...message.additionals];
      for (const rec of all) {
        if (isPTR(rec) && nameKey(rec.name) === this.serviceKey) {
          this.cache.add(rec);
        }
      }
      for (const rec of all) {
        if ((isSRV(rec) || isTXT(rec)) && this.instances.has(nameKey(rec.name))) {
          this.cache.add(rec);
        }
      }
      for (const rec of all) {
        if ((isA(rec) || isAAAA(rec)) && this.targets.has(nameKey(rec.name))) {
          this.cache.add(rec);
        }
      }
    }
    /** Called by the engine for every decoded query (for question suppression). */
    onQuery(message) {
      if (this.closed)
        return;
      if (message.answers.length > 0)
        return;
      for (const q of message.questions) {
        if (q.type === ResourceType.PTR && nameKey(q.name) === this.serviceKey) {
          this.suppressNextQuery = true;
        }
      }
    }
    // ── Cache-driven resolution ──────────────────────────────────────────────────
    onCacheEvent(kind, record) {
      if (isPTR(record) && nameKey(record.name) === this.serviceKey) {
        if (kind === "removed")
          this.removeInstance(nameKey(record.data.name));
        else
          this.discoverInstance(record.data.name);
      } else if (isSRV(record)) {
        this.onSrv(record, kind);
      } else if (isTXT(record)) {
        this.onTxt(record, kind);
      } else if (isA(record) || isAAAA(record)) {
        this.onAddress(record, kind);
      }
    }
    discoverInstance(labels) {
      const key = nameKey(labels);
      if (this.instances.has(key))
        return;
      const parsed = parseServiceName(labels);
      const instance = {
        fullName: labels.join("."),
        labels,
        serviceType: parsed?.serviceType ?? "",
        protocol: parsed?.protocol ?? "tcp",
        domain: parsed?.domain ?? "local",
        subtypes: parsed?.subtypes ?? [],
        port: null,
        targetKey: null,
        txt: {},
        resolved: false
      };
      this.instances.set(key, instance);
      this.emit(instance, "found");
      this.sendQuery([
        { name: labels, type: ResourceType.SRV },
        { name: labels, type: ResourceType.TXT }
      ]);
    }
    removeInstance(key) {
      const instance = this.instances.get(key);
      if (!instance)
        return;
      this.instances.delete(key);
      if (instance.targetKey) {
        this.targets.get(instance.targetKey)?.instances.delete(key);
      }
      this.emit(instance, "removed");
    }
    onSrv(record, kind) {
      if (!isSRV(record))
        return;
      const key = nameKey(record.name);
      const instance = this.instances.get(key);
      if (!instance)
        return;
      if (kind === "removed") {
        instance.port = null;
        if (instance.targetKey) {
          this.targets.get(instance.targetKey)?.instances.delete(key);
          instance.targetKey = null;
        }
        return;
      }
      instance.port = record.data.port;
      const targetKey = nameKey(record.data.target);
      if (instance.targetKey !== targetKey) {
        if (instance.targetKey) {
          this.targets.get(instance.targetKey)?.instances.delete(key);
        }
        instance.targetKey = targetKey;
        let target = this.targets.get(targetKey);
        if (!target) {
          target = {
            labels: record.data.target,
            addresses: /* @__PURE__ */ new Set(),
            instances: /* @__PURE__ */ new Set()
          };
          this.targets.set(targetKey, target);
        }
        target.instances.add(key);
        this.sendQuery([
          { name: record.data.target, type: ResourceType.A },
          { name: record.data.target, type: ResourceType.AAAA }
        ]);
      }
      this.markResolved(instance);
    }
    onTxt(record, kind) {
      if (!isTXT(record))
        return;
      const instance = this.instances.get(nameKey(record.name));
      if (!instance)
        return;
      instance.txt = kind === "removed" ? {} : txtFromAttributes(record.data.attributes);
      if (instance.resolved)
        this.emit(instance, "updated");
    }
    onAddress(record, kind) {
      const key = nameKey(record.name);
      const target = this.targets.get(key);
      if (!target)
        return;
      const address = isA(record) ? record.data.address.join(".") : isAAAA(record) ? record.data.address : null;
      if (address === null)
        return;
      if (kind === "removed")
        target.addresses.delete(address);
      else
        target.addresses.add(address);
      for (const instKey of target.instances) {
        const instance = this.instances.get(instKey);
        if (!instance)
          continue;
        if (instance.resolved)
          this.emit(instance, "updated");
        else
          this.markResolved(instance);
      }
    }
    markResolved(instance) {
      const target = instance.targetKey ? this.targets.get(instance.targetKey) : void 0;
      const hasAddress = target !== void 0 && target.addresses.size > 0;
      if (instance.port !== null && instance.targetKey !== null && hasAddress) {
        const firstTime = !instance.resolved;
        instance.resolved = true;
        this.emit(instance, firstTime ? "resolved" : "updated");
      }
    }
    emit(instance, kind) {
      const target = instance.targetKey ? this.targets.get(instance.targetKey) : void 0;
      const host = target ? target.labels.join(".") : null;
      const addresses = target ? Array.from(target.addresses) : [];
      this.output.push({
        kind,
        name: instance.labels[0] ?? instance.fullName,
        fullName: instance.fullName,
        serviceType: instance.serviceType,
        protocol: instance.protocol,
        domain: instance.domain,
        subtypes: instance.subtypes,
        host: kind === "found" ? null : host,
        port: kind === "found" ? null : instance.port,
        addresses: kind === "found" ? [] : addresses,
        txt: instance.txt,
        isActive: kind !== "removed",
        lastSeenMs: Date.now()
      });
    }
    /** Stop the browser and release resources. */
    close() {
      if (this.closed)
        return;
      this.closed = true;
      for (const timer of this.timers)
        clearTimeout(timer);
      this.timers.clear();
      this.cache.close();
      this.ctx.unregister(this);
      this.output.close();
    }
  };
  function emptyQueryHeader() {
    return {
      id: 0,
      isResponse: false,
      opcode: 0,
      authoritative: false,
      truncated: false,
      recursionDesired: false,
      recursionAvailable: false,
      rcode: 0
    };
  }

  // ../dns-sd-shared/dist/src/engine/responder.js
  var MAX_RENAME_ATTEMPTS = 20;
  var Responder = class {
    ctx;
    spec;
    domain;
    baseName;
    hostLabels;
    addressRecords;
    instanceName;
    records = [];
    timers = /* @__PURE__ */ new Set();
    renameAttempt = 0;
    probeConflict = false;
    started = false;
    closed = false;
    ready;
    resolveReady;
    rejectReady;
    constructor(ctx, spec) {
      this.ctx = ctx;
      this.spec = spec;
      this.domain = spec.domain ?? "local";
      this.baseName = spec.name;
      this.instanceName = spec.name;
      const host = spec.host ?? defaultHostLabel(ctx.hostname, this.domain);
      this.hostLabels = host.split(".");
      this.addressRecords = this.buildAddressRecords();
      this.ready = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
    }
    /** The final instance name currently claimed. */
    get name() {
      return this.instanceName;
    }
    /** The final fully-qualified instance name. */
    get fullName() {
      return [this.instanceName, ...this.serviceLabels()].join(".");
    }
    /** Start the probe→announce lifecycle; resolves once the name is claimed. */
    start() {
      if (!this.started) {
        this.started = true;
        this.ctx.register(this);
        this.rebuildRecords();
        this.beginProbe();
      }
      return this.ready;
    }
    serviceLabels() {
      return serviceTypeLabels(this.spec.type, this.spec.protocol, this.domain);
    }
    instanceLabels() {
      return instanceNameLabels(this.instanceName, this.spec.type, this.spec.protocol, this.domain);
    }
    buildAddressRecords() {
      const addresses = this.spec.host ? [] : this.ctx.localAddresses();
      const records = [];
      if (this.ctx.family === "IPv4") {
        const v4 = addresses.filter((a) => a.includes(".") && !a.includes(":"));
        const chosen = v4.length > 0 ? v4 : ["127.0.0.1"];
        for (const addr of chosen) {
          records.push({
            name: this.hostLabels,
            type: ResourceType.A,
            class: DnsClass.IN,
            ttl: TTL_HOST,
            flush: true,
            data: {
              kind: "A",
              address: addr.split(".").map((n) => parseInt(n, 10))
            }
          });
        }
      } else {
        const v6 = addresses.filter((a) => a.includes(":"));
        const chosen = v6.length > 0 ? v6 : ["::1"];
        for (const addr of chosen) {
          records.push({
            name: this.hostLabels,
            type: ResourceType.AAAA,
            class: DnsClass.IN,
            ttl: TTL_HOST,
            flush: true,
            data: { kind: "AAAA", address: addr }
          });
        }
      }
      return records;
    }
    rebuildRecords() {
      const instance = this.instanceLabels();
      const service = this.serviceLabels();
      const ptr = {
        name: service,
        type: ResourceType.PTR,
        class: DnsClass.IN,
        ttl: TTL_SHARED,
        flush: false,
        data: { kind: "PTR", name: instance }
      };
      const srv = {
        name: instance,
        type: ResourceType.SRV,
        class: DnsClass.IN,
        ttl: TTL_HOST,
        flush: true,
        data: {
          kind: "SRV",
          priority: 0,
          weight: 0,
          port: this.spec.port,
          target: this.hostLabels
        }
      };
      const txt = {
        name: instance,
        type: ResourceType.TXT,
        class: DnsClass.IN,
        ttl: TTL_HOST,
        flush: true,
        data: { kind: "TXT", attributes: encodeTxtInput(this.spec.txt) }
      };
      const enumeration = {
        name: SERVICE_TYPE_ENUMERATION.split("."),
        type: ResourceType.PTR,
        class: DnsClass.IN,
        ttl: TTL_SHARED,
        flush: false,
        data: { kind: "PTR", name: service }
      };
      const subtypePtrs = (this.spec.subtypes ?? []).map((subtype) => ({
        name: subtypeServiceLabels(subtype, this.spec.type, this.spec.protocol, this.domain),
        type: ResourceType.PTR,
        class: DnsClass.IN,
        ttl: TTL_SHARED,
        flush: false,
        data: { kind: "PTR", name: instance }
      }));
      this.records = [
        ptr,
        srv,
        txt,
        ...this.addressRecords,
        enumeration,
        ...subtypePtrs
      ];
    }
    /** Records that must be unique on the network (the ones we probe/defend). */
    uniqueRecords() {
      return this.records.filter((r) => r.flush);
    }
    // ── Probing ──────────────────────────────────────────────────────────────────
    beginProbe() {
      this.probeConflict = false;
      const delay = Math.random() * this.ctx.timing.probeDelayMaxMs;
      let sent = 0;
      const sendProbe = () => {
        if (this.closed)
          return;
        this.ctx.send(this.buildProbeMessage());
        sent++;
        if (sent >= this.ctx.timing.probeCount) {
          this.schedule(this.ctx.timing.probeIntervalMs, () => this.onProbeDone());
          return;
        }
        this.schedule(this.ctx.timing.probeIntervalMs, sendProbe);
      };
      this.schedule(delay, sendProbe);
    }
    onProbeDone() {
      if (this.closed)
        return;
      if (this.probeConflict) {
        this.rename();
        return;
      }
      this.announce();
      this.resolveReady();
    }
    buildProbeMessage() {
      const names = this.uniqueNames();
      return {
        header: queryHeader(),
        questions: names.map((name) => ({
          name,
          type: ResourceType.ANY,
          class: DnsClass.IN,
          // Probe queries request unicast responses (RFC 6762 §8.1).
          unicastResponse: true
        })),
        answers: [],
        // Proposed records go in the authority section for tie-breaking.
        authorities: this.uniqueRecords(),
        additionals: []
      };
    }
    uniqueNames() {
      const seen = /* @__PURE__ */ new Set();
      const names = [];
      for (const r of this.uniqueRecords()) {
        const key = nameKey(r.name);
        if (!seen.has(key)) {
          seen.add(key);
          names.push(r.name);
        }
      }
      return names;
    }
    rename() {
      this.renameAttempt++;
      if (this.renameAttempt > MAX_RENAME_ATTEMPTS) {
        this.rejectReady(new Error(`could not claim a unique name for "${this.baseName}" after ${MAX_RENAME_ATTEMPTS} attempts`));
        this.close();
        return;
      }
      this.instanceName = `${this.baseName} (${this.renameAttempt + 1})`;
      this.rebuildRecords();
      this.beginProbe();
    }
    // ── Announcing ───────────────────────────────────────────────────────────────
    announce() {
      this.announcing = true;
      let sent = 0;
      const send = () => {
        if (this.closed)
          return;
        this.ctx.send(this.buildAnnounceMessage());
        sent++;
        if (sent < this.ctx.timing.announceCount) {
          this.schedule(this.ctx.timing.announceIntervalMs, send);
        }
      };
      send();
    }
    buildAnnounceMessage() {
      return {
        header: responseHeader(),
        questions: [],
        answers: this.records,
        authorities: [],
        additionals: []
      };
    }
    // ── Incoming messages ─────────────────────────────────────────────────────────
    /** Called by the engine for every decoded query. */
    onQuery(message) {
      if (this.closed || !this.ready)
        return;
      if (message.authorities.length > 0 && !this.resolvedReady()) {
        if (this.losesTieBreak(message.authorities)) {
          this.probeConflict = true;
        }
        return;
      }
      if (!this.resolvedReady())
        return;
      const answers = this.answersFor(message);
      if (answers.length === 0)
        return;
      this.ctx.send({
        header: responseHeader(),
        questions: [],
        answers,
        authorities: [],
        additionals: this.additionalsFor(answers)
      });
    }
    /** Called by the engine for every decoded response. */
    onResponse(message) {
      if (this.closed)
        return;
      for (const answer of message.answers) {
        for (const ours of this.uniqueRecords()) {
          if (nameKey(answer.name) === nameKey(ours.name) && answer.type === ours.type) {
            if (compareRdata(answer, ours) !== 0) {
              if (!this.resolvedReady()) {
                this.probeConflict = true;
              } else {
                this.reprobe();
              }
              return;
            }
          }
        }
      }
    }
    answersFor(message) {
      const answers = [];
      for (const q of message.questions) {
        for (const rec of this.records) {
          const typeMatch = q.type === ResourceType.ANY || q.type === rec.type;
          if (!typeMatch || !namesEqual(q.name, rec.name))
            continue;
          const suppressed = message.answers.some((known) => known.type === rec.type && namesEqual(known.name, rec.name) && compareRdata(known, rec) === 0 && known.ttl >= rec.ttl / 2);
          if (!suppressed && !answers.includes(rec))
            answers.push(rec);
        }
      }
      return answers;
    }
    additionalsFor(answers) {
      const additionals = [];
      const wantInstance = answers.some((a) => a.type === ResourceType.PTR);
      if (wantInstance) {
        for (const rec of this.records) {
          if (rec.type === ResourceType.SRV || rec.type === ResourceType.TXT || isA(rec) || isAAAA(rec)) {
            if (!answers.includes(rec))
              additionals.push(rec);
          }
        }
      }
      return additionals;
    }
    losesTieBreak(theirRecords) {
      const ours = [...this.uniqueRecords()].sort(recordSort);
      const theirs = [...theirRecords].filter((r) => this.uniqueRecords().some((o) => nameKey(o.name) === nameKey(r.name) && o.type === r.type)).sort(recordSort);
      for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
        if (i >= ours.length)
          return true;
        if (i >= theirs.length)
          return false;
        const cmp = recordSort(ours[i], theirs[i]);
        if (cmp !== 0)
          return cmp === -1;
      }
      return false;
    }
    reprobe() {
      for (const t of this.timers)
        clearTimeout(t);
      this.timers.clear();
      this.rename();
    }
    resolvedReady() {
      return this.announcing;
    }
    announcing = false;
    // ── Goodbye / teardown ────────────────────────────────────────────────────────
    buildGoodbyeMessage() {
      return {
        header: responseHeader(),
        questions: [],
        answers: this.records.map((r) => ({ ...r, ttl: 0 })),
        authorities: [],
        additionals: []
      };
    }
    /** Stop advertising, sending a goodbye packet (RFC 6762 §10.1). */
    stop() {
      if (this.closed)
        return Promise.resolve();
      if (this.announcing) {
        this.ctx.send(this.buildGoodbyeMessage());
      }
      this.close();
      return Promise.resolve();
    }
    close() {
      if (this.closed)
        return;
      this.closed = true;
      for (const t of this.timers)
        clearTimeout(t);
      this.timers.clear();
      this.ctx.unregister(this);
    }
    schedule(delayMs, fn) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.closed)
          fn();
      }, delayMs);
      this.timers.add(timer);
    }
  };
  function defaultHostLabel(hostname, domain) {
    const sanitized = hostname.replace(/\.local$/i, "").replace(/[^\w-]/g, "-") || "host";
    return `${sanitized}.${domain}`;
  }
  function queryHeader() {
    return {
      id: 0,
      isResponse: false,
      opcode: 0,
      authoritative: false,
      truncated: false,
      recursionDesired: false,
      recursionAvailable: false,
      rcode: 0
    };
  }
  function responseHeader() {
    return {
      id: 0,
      isResponse: true,
      opcode: 0,
      authoritative: true,
      truncated: false,
      recursionDesired: false,
      recursionAvailable: false,
      rcode: 0
    };
  }

  // ../dns-sd-shared/dist/src/engine/engine.js
  var MdnsEngine = class {
    transport;
    timing;
    browsers = /* @__PURE__ */ new Set();
    responders = /* @__PURE__ */ new Set();
    ownAddresses;
    closed = false;
    loop;
    constructor(transport, options = {}) {
      this.transport = transport;
      this.timing = options.timing ?? DEFAULT_TIMING;
      this.ownAddresses = new Set(transport.localAddresses());
      this.loop = this.runReceiveLoop();
    }
    async runReceiveLoop() {
      for (; ; ) {
        let datagram;
        try {
          datagram = await this.transport.receive();
        } catch {
          break;
        }
        if (this.closed || datagram === null)
          break;
        if (this.ownAddresses.has(datagram.source.address))
          continue;
        let message;
        try {
          message = decodeMessage(datagram.data);
        } catch {
          continue;
        }
        if (message.header.isResponse) {
          for (const browser of this.browsers)
            browser.onResponse(message);
          for (const responder of this.responders)
            responder.onResponse(message);
        } else {
          for (const browser of this.browsers)
            browser.onQuery(message);
          for (const responder of this.responders)
            responder.onQuery(message);
        }
      }
    }
    send = (message) => {
      if (this.closed)
        return;
      void this.transport.send(encodeMessage(message));
    };
    /** Start browsing for a service type. */
    browse(spec) {
      const browser = new Browser({
        timing: this.timing,
        send: this.send,
        register: (b) => this.browsers.add(b),
        unregister: (b) => this.browsers.delete(b)
      }, {
        type: spec.type,
        protocol: spec.protocol,
        domain: spec.domain ?? "local",
        subtypes: spec.subtypes
      });
      return browser;
    }
    /** Advertise a service; resolves once the name is claimed and announced. */
    async advertise(spec) {
      const responder = new Responder({
        timing: this.timing,
        family: this.transport.family,
        hostname: this.transport.hostname,
        localAddresses: () => this.transport.localAddresses(),
        send: this.send,
        register: (r) => this.responders.add(r),
        unregister: (r) => this.responders.delete(r)
      }, spec);
      await responder.start();
      return responder;
    }
    /** Close the engine, all browsers/responders and the transport. */
    async close() {
      if (this.closed)
        return;
      this.closed = true;
      for (const browser of this.browsers)
        browser.close();
      for (const responder of this.responders)
        await responder.stop();
      await this.transport.close();
      await this.loop.catch(() => {
      });
    }
  };

  // ../dns-sd-shared/dist/src/api.js
  function createDnsSd(backend) {
    if ("transport" in backend) {
      const { transport, ...options } = backend;
      return dnsSdOverTransport(transport, options);
    }
    return dnsSdOverAdapter(backend.adapter);
  }
  function dnsSdOverTransport(transport, options = {}) {
    const engine = new MdnsEngine(transport, options);
    return {
      browse(opts) {
        const browser = engine.browse(opts.service);
        return withStop(browser.events(), () => browser.close(), opts.timeoutMs, opts.signal);
      },
      async advertise(opts) {
        const responder = await engine.advertise(opts.service);
        return makeAdvertiseHandle(() => responder.name, () => responder.fullName, () => responder.stop(), opts.signal);
      },
      close() {
        return engine.close();
      }
    };
  }
  function dnsSdOverAdapter(adapter) {
    return {
      browse(opts) {
        const queue = new FastFIFO();
        const handlePromise = adapter.browseStart(opts.service, (event) => queue.push(event));
        let started = null;
        handlePromise.then((h) => {
          started = h;
        }, () => {
        });
        return withStop(queue, () => {
          queue.close();
          void handlePromise.then((h) => h.stop(), () => {
          });
          if (started)
            void started.stop();
        }, opts.timeoutMs, opts.signal);
      },
      async advertise(opts) {
        const handle = await adapter.advertiseStart(opts.service);
        return makeAdvertiseHandle(() => handle.name, () => handle.name, () => handle.stop(), opts.signal);
      },
      close() {
        return adapter.close();
      }
    };
  }
  async function* withStop(source, stop, timeoutMs, signal) {
    let timer;
    const onAbort = () => stop();
    if (signal) {
      if (signal.aborted)
        stop();
      else
        signal.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs !== void 0 && timeoutMs > 0) {
      timer = setTimeout(stop, timeoutMs);
    }
    try {
      for await (const item of source) {
        yield item;
      }
    } finally {
      stop();
      if (timer !== void 0)
        clearTimeout(timer);
      if (signal)
        signal.removeEventListener("abort", onAbort);
    }
  }
  function makeAdvertiseHandle(name, fullName, stop, signal) {
    let stopped = null;
    const doStop = () => {
      if (!stopped)
        stopped = stop();
      return stopped;
    };
    if (signal) {
      if (signal.aborted)
        void doStop();
      else
        signal.addEventListener("abort", () => void doStop(), { once: true });
    }
    return {
      get name() {
        return name();
      },
      get fullName() {
        return fullName();
      },
      stop: doStop,
      [Symbol.asyncDispose]: doStop
    };
  }

  // guest-js/adapter-core.ts
  function decodeTxt2(txt) {
    const out = {};
    if (!txt) return out;
    for (const [key, value] of Object.entries(txt)) {
      if (value === true) {
        out[key] = true;
      } else if (value === null) {
        out[key] = null;
      } else {
        out[key] = new Uint8Array(value);
      }
    }
    return out;
  }
  function encodeTxt2(txt) {
    if (!txt) return void 0;
    const out = {};
    const encoder = new TextEncoder();
    for (const [key, value] of Object.entries(txt)) {
      if (value === true) {
        out[key] = true;
      } else if (value === null) {
        out[key] = null;
      } else if (value instanceof Uint8Array) {
        out[key] = Array.from(value);
      } else {
        out[key] = Array.from(encoder.encode(value));
      }
    }
    return out;
  }
  function toAnnouncement(record, kind) {
    return {
      kind,
      name: record.name,
      fullName: record.fullName,
      serviceType: record.serviceType,
      protocol: record.protocol,
      domain: record.domain,
      subtypes: record.subtypes ?? [],
      host: record.host,
      port: record.port,
      addresses: record.addresses ?? [],
      txt: decodeTxt2(record.txt),
      isActive: record.isActive,
      lastSeenMs: record.lastSeenMs
    };
  }
  function createBrowseMessageHandler(sink) {
    const resolvedByName = /* @__PURE__ */ new Map();
    return (message) => {
      if (!("service" in message)) return;
      const record = message.service;
      const key = record.fullName;
      if (!record.isActive) {
        resolvedByName.delete(key);
        sink(toAnnouncement(record, "removed"));
        return;
      }
      const isResolved = record.host !== null && record.port !== null;
      if (!resolvedByName.has(key)) {
        resolvedByName.set(key, isResolved);
        sink(toAnnouncement(record, "found"));
        if (isResolved) sink(toAnnouncement(record, "resolved"));
        return;
      }
      if (isResolved && resolvedByName.get(key) === false) {
        resolvedByName.set(key, true);
        sink(toAnnouncement(record, "resolved"));
        return;
      }
      sink(toAnnouncement(record, "updated"));
    };
  }

  // guest-js/index.ts
  var TauriDnsSdAdapter = class {
    browseStart(spec, sink) {
      const channel = new Channel();
      channel.onmessage = createBrowseMessageHandler(sink);
      const options = {
        service: {
          type: spec.type,
          protocol: spec.protocol,
          domain: spec.domain,
          subtypes: spec.subtypes ?? []
        },
        timeoutMs: 0
      };
      return invoke("plugin:dns-sd|browse_start", {
        options,
        channel
      }).then(({ browseId }) => ({
        async stop() {
          await invoke("plugin:dns-sd|browse_stop", { browseId });
        }
      }));
    }
    advertiseStart(spec) {
      const service = {
        name: spec.name,
        type: spec.type,
        protocol: spec.protocol,
        port: spec.port,
        host: spec.host,
        domain: spec.domain,
        subtypes: spec.subtypes ?? [],
        txt: encodeTxt2(spec.txt) ?? {}
      };
      return invoke("plugin:dns-sd|advertise_start", {
        options: { service }
      }).then(({ advertiseId, name }) => ({
        name: name ?? spec.name,
        async stop() {
          await invoke("plugin:dns-sd|advertise_stop", { advertiseId });
        }
      }));
    }
    close() {
      return Promise.resolve();
    }
  };
  var dnsSd = createDnsSd({ adapter: new TauriDnsSdAdapter() });
  var browse = (opts) => dnsSd.browse(opts);
  var advertise = (opts) => dnsSd.advertise(opts);
  var close = () => dnsSd.close();
  return __toCommonJS(index_exports);
})();
