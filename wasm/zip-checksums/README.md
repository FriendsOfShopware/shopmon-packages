# ZIP checksums WASM

Rust module that takes a complete ZIP as one buffer and returns the XXH128
checksum manifest (`{"algorithm":"xxh128","files":{path: digest}}`) that
`src/checksums.ts` stores next to each package.

It replaces the previous zip.js reader, which performed several R2 range
reads per ZIP entry. Large packages such as SwagCommercial (5,738 entries,
~17k range reads) never finished checksum generation inside a queue
invocation, so their ZIP landed in R2 but the version was never published.

Validation mirrors the old implementation: at most 10,000 entries and
512 MiB uncompressed, duplicate/unsafe paths and encrypted entries are
rejected, declared sizes are verified while streaming each entry through
XXH3-128 in 64 KiB chunks, and CRC errors from the `zip` crate abort the
manifest.

## Rebuild

```sh
rustup target add wasm32-unknown-unknown
node scripts/build-zip-checksums-wasm.mjs
cargo test --manifest-path wasm/zip-checksums/Cargo.toml
```

The ABI is three exports: `zip_checksums_alloc`, `zip_checksums_free`, and
`checksums_zip(ptr, len)`, which returns a packed `(ptr << 32) | len` u64
pointing at a JSON envelope: `{"ok":true,"manifest":...}` or
`{"ok":false,"error":"..."}`.
