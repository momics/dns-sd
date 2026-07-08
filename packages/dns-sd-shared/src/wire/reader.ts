/**
 * A strictly bounds-checked cursor over a DNS message buffer.
 *
 * Every read validates that the requested bytes lie within the message, so a
 * malformed or hostile packet can never cause an out-of-range read. On any
 * violation a {@link WireError} is thrown, which the decoder turns into a
 * clean rejection rather than a panic.
 *
 * @module
 */

/** Thrown when a DNS message cannot be decoded because it is malformed. */
export class WireError extends Error {
  /** Stable error name for malformed DNS wire data. */
  override readonly name = "WireError";
  /** Create a wire-format decode error. */
  constructor(message: string) {
    super(message);
  }
}

/**
 * Maximum number of compression-pointer jumps permitted while decoding a
 * single name. RFC 1035 names are at most 255 bytes, so no legitimate name
 * requires anywhere near this many jumps. A firm cap defeats pointer loops and
 * pointer chains crafted to force quadratic work.
 */
const MAX_POINTER_JUMPS = 128;

/** Maximum total decoded length of a single name, in bytes (RFC 1035 §3.1). */
const MAX_NAME_LENGTH = 255;

/** Maximum length of a single label, in bytes (RFC 1035 §3.1). */
const MAX_LABEL_LENGTH = 63;

/** Shared UTF-8 decoder for label bytes (RFC 6763 §4.1.1). */
const UTF8_DECODER = new TextDecoder();

/** Bounds-checked reader for DNS wire-format fields. */
export class Reader {
  /** Message bytes being read. */
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  /** Current absolute read offset. */
  offset: number;

  /** Create a reader at an optional absolute offset. */
  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    // Scope the DataView to the array's own region — `bytes.buffer` may be a
    // larger pooled ArrayBuffer, so always use byteOffset/byteLength.
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  /** Total message length in bytes. */
  get length(): number {
    return this.bytes.byteLength;
  }

  /** Bytes remaining from the current offset. */
  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  /** Ensure `count` bytes can be read from the current offset. */
  private ensure(count: number): void {
    if (count < 0) {
      throw new WireError(`negative read length ${count}`);
    }
    if (this.offset + count > this.bytes.byteLength) {
      throw new WireError(
        `unexpected end of message: need ${count} byte(s) at offset ${this.offset}, ` +
          `only ${this.remaining} remaining`,
      );
    }
  }

  /** Read an unsigned 8-bit integer. */
  u8(): number {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  /** Read an unsigned 16-bit integer in network byte order. */
  u16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  /** Read an unsigned 32-bit integer in network byte order. */
  u32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  /** Read `count` raw bytes as a copy (never a view into the message). */
  take(count: number): Uint8Array {
    this.ensure(count);
    const slice = this.bytes.slice(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  /** Peek an unsigned byte at an absolute offset without moving the cursor. */
  peekU8(at: number): number {
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
  name(): string[] {
    const labels: string[] = [];
    let jumps = 0;
    let totalLength = 0;
    // Cursor to advance for the caller (frozen after the first pointer jump).
    let cursor = this.offset;
    let advancedCursor = false;
    // Track the smallest pointer target we've followed; a valid pointer must
    // always point strictly backwards, which also prevents forward loops.
    let minJumpTarget = this.bytes.byteLength;

    let pos = this.offset;

    for (;;) {
      if (pos < 0 || pos >= this.bytes.byteLength) {
        throw new WireError(`name label out of range at offset ${pos}`);
      }
      const len = this.view.getUint8(pos);

      // A length byte with the top two bits set (0b11) is a compression pointer.
      if ((len & 0xc0) === 0xc0) {
        if (pos + 1 >= this.bytes.byteLength) {
          throw new WireError("truncated compression pointer");
        }
        const pointer = ((len & 0x3f) << 8) | this.view.getUint8(pos + 1);

        if (!advancedCursor) {
          cursor = pos + 2;
          advancedCursor = true;
        }

        if (++jumps > MAX_POINTER_JUMPS) {
          throw new WireError("too many compression-pointer jumps");
        }
        if (pointer >= minJumpTarget) {
          // Pointers must always jump strictly backwards; anything else is a
          // loop or a forward reference and is rejected.
          throw new WireError("compression pointer does not point backwards");
        }
        minJumpTarget = pointer;
        pos = pointer;
        continue;
      }

      // The 0b10 and 0b01 length prefixes are reserved and never valid.
      if ((len & 0xc0) !== 0) {
        throw new WireError(`reserved label length prefix at offset ${pos}`);
      }

      // A zero-length label terminates the name.
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

      // RFC 6763 §4.1.1 requires DNS-SD names to be UTF-8, so decode the label
      // bytes as UTF-8 in one shot rather than byte-by-byte (which would be
      // Latin-1 and would corrupt any non-ASCII name).
      labels.push(
        UTF8_DECODER.decode(this.bytes.subarray(pos + 1, pos + 1 + len)),
      );
      pos += 1 + len;
    }

    this.offset = cursor;
    return labels;
  }

  /**
   * Decode a domain name that begins at an absolute offset (used for RDATA
   * that embeds names, when reading from a scoped sub-reader is inconvenient).
   */
  nameAt(at: number): string[] {
    const saved = this.offset;
    this.offset = at;
    try {
      return this.name();
    } finally {
      this.offset = saved;
    }
  }
}
