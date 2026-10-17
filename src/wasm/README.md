# XXH128 module

`xxh128.wasm` is the unmodified XXH3-128 module embedded in `hash-wasm@4.12.0`
(MIT license in `LICENSE`, including the upstream xxHash BSD notice).
It is imported statically because Cloudflare Workers do not allow runtime WASM compilation.

Regenerate after installing dependencies:

```sh
node scripts/generate-xxh128-wasm.mjs
```

`../xxh128.ts` uses the module's `Hash_GetBuffer`, `Hash_Init`, `Hash_Update`,
and `Hash_Final` ABI with a 16 KiB input buffer, matching hash-wasm's wrapper.
The seed is zero; output is the canonical 32-character lowercase hexadecimal digest.
