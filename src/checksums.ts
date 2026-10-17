import { Reader, ZipReader } from "@zip.js/zip.js/index-native.js";
import { createXXH128 } from "./xxh128";

const MAX_READ_SIZE = 8 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_SIZE = 512 * 1024 * 1024;

export interface ChecksumManifest {
  algorithm: "xxh128";
  files: Record<string, string>;
}

// Read bounded ranges instead of buffering the ZIP or its uncompressed files.
class R2Reader extends Reader<R2Object> {
  constructor(
    private bucket: R2Bucket,
    private object: R2Object,
  ) {
    super(object);
    this.size = object.size;
  }

  async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
    length = Math.min(length, this.size - offset);
    if (length === 0) return new Uint8Array();
    if (offset < 0 || length < 0 || length > MAX_READ_SIZE) {
      throw new Error("ZIP read exceeds checksum generation limits");
    }
    const result = await this.bucket.get(this.object.key, {
      range: { offset, length },
      onlyIf: { etagMatches: this.object.etag },
    });
    if (!result || !("body" in result)) {
      throw new Error("ZIP disappeared or changed during checksum generation");
    }
    return new Uint8Array(await result.arrayBuffer());
  }
}

export async function createChecksumManifest(
  bucket: R2Bucket,
  object: R2Object,
): Promise<ChecksumManifest> {
  const reader = new ZipReader(new R2Reader(bucket, object), {
    useWebWorkers: false,
    useCompressionStream: true,
    checkSignature: true,
    strictness: "strict",
  });
  const files = new Map<string, string>();
  const paths = new Set<string>();
  const hash = createXXH128();
  let totalSize = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      const path = entry.filename;
      if (
        paths.size >= MAX_ENTRIES ||
        paths.has(path) ||
        !path ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.includes("\0") ||
        /^[a-z]:/i.test(path) ||
        path
          .replace(/\/$/, "")
          .split("/")
          .some((part) => !part || part === "." || part === "..")
      ) {
        throw new Error(`Unsafe, duplicate, or excessive ZIP entries: ${path}`);
      }
      paths.add(path);
      if (entry.directory) continue;
      if (entry.encrypted) throw new Error(`Cannot checksum encrypted ZIP entry: ${path}`);
      if (totalSize + entry.uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new Error("ZIP exceeds uncompressed checksum generation limit");
      }
      hash.init();
      let size = 0;
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.length;
            totalSize += chunk.length;
            if (totalSize > MAX_UNCOMPRESSED_SIZE || size > entry.uncompressedSize) {
              throw new Error("ZIP exceeds uncompressed checksum generation limit");
            }
            hash.update(chunk);
          },
        }),
      );
      if (size !== entry.uncompressedSize) throw new Error(`Truncated ZIP entry: ${path}`);
      files.set(path, hash.digest());
    }
  } finally {
    await reader.close();
  }
  return {
    algorithm: "xxh128",
    files: Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}
