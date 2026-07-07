/**
 * A fast, dynamically growing FIFO queue usable as an async iterable. Adapted
 * from https://github.com/mafintosh/fast-fifo.
 *
 * @module
 */

const END = Symbol("fifo.end");

type Slot<T> = T | typeof END;

class FixedFIFO<T> {
  buffer: Array<Slot<T> | undefined>;
  private readonly mask: number;
  private top = 0;
  private btm = 0;
  next: FixedFIFO<T> | null = null;

  constructor(hwm: number) {
    if (!(hwm > 0) || ((hwm - 1) & hwm) !== 0) {
      throw new Error("FixedFIFO size must be a power of two");
    }
    this.buffer = new Array(hwm);
    this.mask = hwm - 1;
  }

  push(data: Slot<T>): boolean {
    if (this.buffer[this.top] !== undefined) return false;
    this.buffer[this.top] = data;
    this.top = (this.top + 1) & this.mask;
    return true;
  }

  shift(): Slot<T> | undefined {
    const last = this.buffer[this.btm];
    if (last === undefined) return undefined;
    this.buffer[this.btm] = undefined;
    this.btm = (this.btm + 1) & this.mask;
    return last;
  }

  isEmpty(): boolean {
    return this.buffer[this.btm] === undefined;
  }
}

/** A push/pull queue that can be consumed with `for await`. */
export class FastFIFO<T> {
  private head: FixedFIFO<T>;
  private tail: FixedFIFO<T>;
  private resolve: ((value: Slot<T>) => void) | null = null;
  private closed = false;

  constructor(hwm = 16) {
    this.head = new FixedFIFO<T>(hwm);
    this.tail = this.head;
  }

  push(value: T): void {
    if (this.closed) return;
    this.enqueue(value);
  }

  private enqueue(value: Slot<T>): void {
    if (this.resolve) {
      const resolve = this.resolve;
      this.resolve = null;
      resolve(value);
      return;
    }
    if (!this.head.push(value)) {
      const prev = this.head;
      this.head = prev.next = new FixedFIFO<T>(prev.buffer.length * 2);
      this.head.push(value);
    }
  }

  private shift(): Slot<T> | undefined {
    let value = this.tail.shift();
    if (value === undefined && this.tail.next) {
      const next = this.tail.next;
      this.tail.next = null;
      this.tail = next;
      value = this.tail.shift();
    }
    return value;
  }

  /** Close the queue; iterators drain any buffered items and then finish. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.enqueue(END);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const shifted = this.shift();
      const value = shifted !== undefined
        ? shifted
        : await new Promise<Slot<T>>((res) => {
          this.resolve = res;
        });
      if (value === END) return;
      yield value as T;
    }
  }
}
