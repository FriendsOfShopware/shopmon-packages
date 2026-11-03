import zipChecksumsModule from "./wasm/zip-checksums.wasm";

export interface ChecksumManifest {
  algorithm: "xxh128";
  files: Record<string, string>;
}

interface ZipChecksumsExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  zip_checksums_alloc(size: number): number;
  zip_checksums_free(ptr: number, size: number): void;
  checksums_zip(ptr: number, len: number): bigint;
}

// Instantiated once per isolate. The module is fully synchronous and keeps no
// state between calls besides the buffers the caller allocates and frees, so
// concurrent requests cannot interfere with each other.
let exportsCache: ZipChecksumsExports | undefined;
function exports(): ZipChecksumsExports {
  exportsCache ??= new WebAssembly.Instance(zipChecksumsModule, {}).exports as ZipChecksumsExports;
  return exportsCache;
}

type Envelope = { ok: true; manifest: ChecksumManifest } | { ok: false; error: string };

/**
 * Hashes every file in a complete ZIP held in memory. This replaces the old
 * zip.js reader, which issued several R2 range reads per entry (17k+ reads
 * for SwagCommercial) and never finished inside a queue invocation.
 */
export function checksumZip(zip: Uint8Array): ChecksumManifest {
  const wasm = exports();
  const input = wasm.zip_checksums_alloc(zip.byteLength);
  let output = 0;
  let outputLength = 0;
  try {
    new Uint8Array(wasm.memory.buffer, input, zip.byteLength).set(zip);
    const packed = wasm.checksums_zip(input, zip.byteLength);
    output = Number(packed >> 32n);
    outputLength = Number(packed & 0xffffffffn);
    const text = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, output, outputLength));
    const envelope = JSON.parse(text) as Envelope;
    if (!envelope.ok) {
      throw new Error(envelope.error);
    }
    // Re-sort with the same ordering the previous implementation produced.
    const files = Object.fromEntries(
      Object.entries(envelope.manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    return { algorithm: "xxh128", files };
  } finally {
    wasm.zip_checksums_free(input, zip.byteLength);
    if (output !== 0) {
      wasm.zip_checksums_free(output, outputLength);
    }
  }
}

export async function createChecksumManifest(
  bucket: R2Bucket,
  object: R2Object,
): Promise<ChecksumManifest> {
  // One full read instead of bounded range reads per entry. The pinned ETag
  // keeps the bytes consistent with the object the caller inspected.
  const result = await bucket.get(object.key, {
    onlyIf: { etagMatches: object.etag },
  });
  if (!result || !("body" in result)) {
    throw new Error("ZIP disappeared or changed during checksum generation");
  }
  return checksumZip(new Uint8Array(await result.arrayBuffer()));
}
