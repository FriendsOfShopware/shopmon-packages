// Extract hash-wasm's embedded module at build time: Workers cannot compile WASM at runtime.
import { writeFile } from "node:fs/promises";
import { createXXHash128 } from "hash-wasm";

const compile = WebAssembly.compile;
WebAssembly.compile = async (bytes) => {
  await writeFile(new URL("../src/wasm/xxh128.wasm", import.meta.url), new Uint8Array(bytes));
  return compile(bytes);
};
try {
  await createXXHash128();
} finally {
  WebAssembly.compile = compile;
}
