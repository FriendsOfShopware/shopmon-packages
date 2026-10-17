import module from "./wasm/xxh128.wasm";

interface HashExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  Hash_GetBuffer(): number;
  Hash_Init(): void;
  Hash_Update(length: number): void;
  Hash_Final(): void;
}

// Each instance owns its state, so concurrent package downloads cannot interfere.
export function createXXH128() {
  const wasm = new WebAssembly.Instance(module).exports as HashExports;
  const buffer = new Uint8Array(wasm.memory.buffer, wasm.Hash_GetBuffer(), 16 * 1024);
  return {
    init() {
      buffer.fill(0, 0, 8); // XXH3's 64-bit seed, little endian.
      wasm.Hash_Init();
    },
    update(data: Uint8Array) {
      for (let offset = 0; offset < data.length; offset += buffer.length) {
        const chunk = data.subarray(offset, offset + buffer.length);
        buffer.set(chunk);
        wasm.Hash_Update(chunk.length);
      }
    },
    digest() {
      wasm.Hash_Final();
      return Array.from(buffer.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
  };
}
