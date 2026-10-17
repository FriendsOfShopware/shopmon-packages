import { Uint8ArrayWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js/index-native.js";

export async function zipFiles(files: Record<string, Uint8Array>, level: 0 | 6 = 6) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    useCompressionStream: true,
  });
  for (const [name, bytes] of Object.entries(files)) {
    await writer.add(name, new Uint8ArrayReader(bytes), { level });
  }
  return writer.close();
}
