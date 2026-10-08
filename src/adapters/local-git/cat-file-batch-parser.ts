const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MISSING_FRAME_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64}) missing$/u;
const OBJECT_FRAME_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z][a-z0-9-]*) (0|[1-9][0-9]*)$/u;
const MAX_HEADER_BYTES = 128;
const OBJECT_TYPES = new Set(["blob", "tree", "commit", "tag"]);

export const MAX_GIT_BLOB_BATCH_OBJECTS = 128;

export type CatFileBatchFrame =
  | { readonly kind: "blob"; readonly objectId: string; readonly bytes: Uint8Array }
  | { readonly kind: "missing"; readonly objectId: string }
  | { readonly kind: "wrong-type"; readonly objectId: string; readonly type: string; readonly size: number }
  | { readonly kind: "too-large"; readonly objectId: string; readonly size: number };

interface PendingObjectFrame {
  readonly objectId: string;
  readonly type: string;
  readonly size: number;
  readonly bytes?: Buffer;
  bytesRead: number;
}

/** Incrementally parses raw `git cat-file --batch` stdout without joining response chunks. */
export class CatFileBatchResponseParser {
  private readonly objectIds: readonly string[];
  private readonly maxBlobBytes: number;
  private readonly headerBytes = Buffer.alloc(MAX_HEADER_BYTES);
  private headerLength = 0;
  private nextObjectIndex = 0;
  private pendingObject: PendingObjectFrame | undefined;
  private state: "open" | "finished" | "poisoned" = "open";
  private failure: Error | undefined;

  public constructor(objectIds: readonly string[], maxBlobBytes: number) {
    if (objectIds.length > MAX_GIT_BLOB_BATCH_OBJECTS) {
      throw new RangeError(`A cat-file batch can contain at most ${MAX_GIT_BLOB_BATCH_OBJECTS} object IDs`);
    }
    if (!Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 0) {
      throw new RangeError("maxBlobBytes must be a non-negative safe integer");
    }
    for (const [index, objectId] of objectIds.entries()) {
      if (!OBJECT_ID_PATTERN.test(objectId)) {
        throw new TypeError(`objectIds[${index}] must be a lowercase full SHA-1 or SHA-256 object ID`);
      }
    }
    this.objectIds = [...objectIds];
    this.maxBlobBytes = maxBlobBytes;
  }

  /** Consumes one arbitrary stdout chunk and returns only complete response frames. */
  public push(chunk: Uint8Array): readonly CatFileBatchFrame[] {
    this.assertUsable();
    try {
      return this.pushChunk(chunk);
    } catch (error) {
      throw this.poison(error);
    }
  }

  private pushChunk(chunk: Uint8Array): readonly CatFileBatchFrame[] {
    const frames: CatFileBatchFrame[] = [];
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (this.pendingObject === undefined) {
        this.assertResponseExpected();
        const lineFeed = chunk.indexOf(0x0a, offset);
        if (lineFeed < 0) {
          this.appendHeader(chunk.subarray(offset));
          break;
        }
        this.appendHeader(chunk.subarray(offset, lineFeed));
        offset = lineFeed + 1;
        const line = this.takeHeaderLine();
        const missing = MISSING_FRAME_PATTERN.exec(line);
        if (missing !== null) {
          const objectId = missing[1]!;
          this.assertExpectedObjectId(objectId);
          frames.push({ kind: "missing", objectId });
          this.nextObjectIndex += 1;
          continue;
        }
        const header = OBJECT_FRAME_PATTERN.exec(line);
        if (header === null) throw new Error("Malformed cat-file batch object header");
        const objectId = header[1]!;
        this.assertExpectedObjectId(objectId);
        const type = header[2]!;
        if (!OBJECT_TYPES.has(type)) throw new Error("Cat-file batch response has an unknown object type");
        const size = Number(header[3]);
        if (!Number.isSafeInteger(size) || size < 0) {
          throw new Error("Cat-file batch object size is outside the safe integer range");
        }
        this.pendingObject = {
          objectId,
          type,
          size,
          ...(type === "blob" && size <= this.maxBlobBytes ? { bytes: Buffer.alloc(size) } : {}),
          bytesRead: 0,
        };
        continue;
      }

      const pending = this.pendingObject;
      if (pending.bytesRead < pending.size) {
        const count = Math.min(pending.size - pending.bytesRead, chunk.byteLength - offset);
        pending.bytes?.set(chunk.subarray(offset, offset + count), pending.bytesRead);
        pending.bytesRead += count;
        offset += count;
        continue;
      }

      if (chunk[offset] !== 0x0a) throw new Error("Cat-file batch object payload is missing its LF terminator");
      offset += 1;
      if (pending.type !== "blob") {
        frames.push({ kind: "wrong-type", objectId: pending.objectId, type: pending.type, size: pending.size });
      } else if (pending.size > this.maxBlobBytes) {
        frames.push({ kind: "too-large", objectId: pending.objectId, size: pending.size });
      } else {
        frames.push({ kind: "blob", objectId: pending.objectId, bytes: pending.bytes! });
      }
      this.nextObjectIndex += 1;
      this.pendingObject = undefined;
    }
    return frames;
  }

  /** Verifies EOF landed exactly after the final requested response frame. */
  public finish(): void {
    this.assertUsable();
    try {
      if (this.pendingObject !== undefined || this.headerLength !== 0) {
        throw new Error("Truncated cat-file batch response frame");
      }
      if (this.nextObjectIndex !== this.objectIds.length) {
        throw new Error(`Cat-file batch response expected ${this.objectIds.length} response frames, received ${this.nextObjectIndex}`);
      }
      this.state = "finished";
    } catch (error) {
      throw this.poison(error);
    }
  }

  private assertUsable(): void {
    if (this.state === "poisoned") {
      throw new Error("Cat-file batch parser is poisoned after a previous protocol error", { cause: this.failure });
    }
    if (this.state === "finished") throw new Error("Cat-file batch parser is already finished");
  }

  private poison(error: unknown): Error {
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.pendingObject = undefined;
    this.headerLength = 0;
    this.state = "poisoned";
    return this.failure;
  }

  private appendHeader(bytes: Uint8Array): void {
    if (bytes.byteLength > MAX_HEADER_BYTES - this.headerLength) {
      throw new Error("Cat-file batch object header exceeds its byte limit");
    }
    for (const byte of bytes) {
      if (byte < 0x20 || byte > 0x7e) throw new Error("Cat-file batch object header is not printable ASCII");
    }
    this.headerBytes.set(bytes, this.headerLength);
    this.headerLength += bytes.byteLength;
  }

  private takeHeaderLine(): string {
    const line = this.headerBytes.toString("ascii", 0, this.headerLength);
    this.headerLength = 0;
    return line;
  }

  private assertResponseExpected(): void {
    if (this.nextObjectIndex >= this.objectIds.length) {
      throw new Error("Cat-file batch response contains an extra frame");
    }
  }

  private assertExpectedObjectId(actual: string): void {
    const expected = this.objectIds[this.nextObjectIndex];
    if (actual !== expected) {
      throw new Error(`Cat-file batch object ID mismatch at response ${this.nextObjectIndex}`);
    }
  }
}
