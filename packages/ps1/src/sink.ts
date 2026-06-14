// A random-access byte sink for the patched-disc writer: write(offset, data) places bytes at an
// absolute image offset. This lets buildPatchedTo stream the output straight to a File System Access
// handle (the patched image is never held in RAM), while an in-memory BufferSink backs the
// download fallback and the tests.

export interface DiscSink {
  write(offset: number, data: Uint8Array): Promise<void> | void;
}

/**
 * In-memory sink, ArrayBuffer-backed so bytes() is a valid BlobPart. Pass the final image size as
 * `initial` to avoid any reallocation; if it has to grow it does so by *doubling* (amortised O(n)) —
 * never by the exact amount, which would be O(n²) when sectors are appended one at a time.
 */
export class BufferSink implements DiscSink {
  private buf: Uint8Array<ArrayBuffer>;
  private len = 0;
  constructor(initial = 0) {
    this.buf = new Uint8Array(initial);
  }

  write(offset: number, data: Uint8Array): void {
    const end = offset + data.length;
    if (end > this.buf.length) {
      const grown = new Uint8Array(Math.max(end, this.buf.length * 2));
      grown.set(this.buf, 0);
      this.buf = grown;
    }
    this.buf.set(data, offset);
    if (end > this.len) this.len = end;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return this.buf.subarray(0, this.len);
  }
}
