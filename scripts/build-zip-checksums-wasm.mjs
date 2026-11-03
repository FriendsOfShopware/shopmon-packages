// Rebuilds src/wasm/zip-checksums.wasm from wasm/zip-checksums (Rust).
// Requires a Rust toolchain with the wasm32-unknown-unknown target:
//   rustup target add wasm32-unknown-unknown
import { execFileSync } from "node:child_process";
import { copyFile } from "node:fs/promises";

execFileSync(
  "cargo",
  [
    "build",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--manifest-path",
    new URL("../wasm/zip-checksums/Cargo.toml", import.meta.url).pathname,
  ],
  { stdio: "inherit" },
);

await copyFile(
  new URL(
    "../wasm/zip-checksums/target/wasm32-unknown-unknown/release/zip_checksums.wasm",
    import.meta.url,
  ),
  new URL("../src/wasm/zip-checksums.wasm", import.meta.url),
);
console.log("Wrote src/wasm/zip-checksums.wasm");
