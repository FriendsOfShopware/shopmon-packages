// Whole-ZIP XXH128 manifest generator.
// The Worker hands this module the complete ZIP in one buffer, so a package
// costs a single R2 read instead of several range reads per ZIP entry.
// ABI: zip_checksums_alloc/zip_checksums_free manage buffers; checksums_zip returns a packed
// (pointer << 32) | length u64 pointing at a UTF-8 JSON envelope:
// {"ok":true,"manifest":{...}} or {"ok":false,"error":"..."}.

use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read};
use xxhash_rust::xxh3::Xxh3;
use zip::ZipArchive;

const MAX_ENTRIES: usize = 10_000;
const MAX_UNCOMPRESSED_SIZE: u64 = 512 * 1024 * 1024;
const READ_CHUNK: usize = 64 * 1024;

#[no_mangle]
pub extern "C" fn zip_checksums_alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn zip_checksums_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr, 0, size));
    }
}

fn pack(mut bytes: Vec<u8>) -> u64 {
    // zip_checksums_free reconstructs the Vec with capacity == length, so
    // shrink the allocation to fit exactly before leaking it.
    bytes.shrink_to_fit();
    debug_assert_eq!(bytes.capacity(), bytes.len());
    let ptr = bytes.as_ptr() as u64;
    let len = bytes.len() as u64;
    std::mem::forget(bytes);
    (ptr << 32) | len
}

#[no_mangle]
pub extern "C" fn checksums_zip(ptr: *const u8, len: usize) -> u64 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let envelope = match manifest(bytes) {
        Ok(manifest) => format!("{{\"ok\":true,\"manifest\":{manifest}}}"),
        Err(error) => format!(
            "{{\"ok\":false,\"error\":{}}}",
            serde_json::to_string(&error).unwrap_or_else(|_| "\"checksum failed\"".to_string())
        ),
    };
    pack(envelope.into_bytes())
}

fn validate_path(path: &str, paths: &HashSet<String>) -> Result<(), String> {
    let trimmed = path.strip_suffix('/').unwrap_or(path);
    let bad_part = trimmed
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..");
    let drive = {
        let b = path.as_bytes();
        b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
    };
    if paths.len() >= MAX_ENTRIES
        || paths.contains(path)
        || path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || drive
        || bad_part
    {
        return Err(format!("Unsafe, duplicate, or excessive ZIP entries: {path}"));
    }
    Ok(())
}

/// Total entries recorded in the end-of-central-directory record. The zip
/// crate keys entries by name, so duplicate names would otherwise collapse
/// into one entry and escape the duplicate check in the loop below.
fn central_entry_count(bytes: &[u8]) -> Option<u64> {
    fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
        bytes
            .get(offset..offset + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
    }
    fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
        bytes
            .get(offset..offset + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u64_at(bytes: &[u8], offset: usize) -> Option<u64> {
        bytes
            .get(offset..offset + 8)
            .map(|b| u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]))
    }

    let window = bytes.len().min(65_536 + 22);
    let start = bytes.len() - window;
    let mut position = bytes.len().checked_sub(22)?;
    loop {
        if u32_at(bytes, position) == Some(0x0605_4b50) {
            let comment_len = u16_at(bytes, position + 20)? as usize;
            if position + 22 + comment_len == bytes.len() {
                let total = u16_at(bytes, position + 10)?;
                if total != u16::MAX {
                    return Some(total as u64);
                }
                // ZIP64: the locator sits directly in front of the EOCD and
                // points at the ZIP64 record, which holds the real count.
                let locator = position.checked_sub(20)?;
                if u32_at(bytes, locator) == Some(0x0706_4b50) {
                    let record = usize::try_from(u64_at(bytes, locator + 8)?).ok()?;
                    if u32_at(bytes, record) == Some(0x0606_4b50) {
                        return u64_at(bytes, record + 32);
                    }
                }
                return None;
            }
        }
        if position == start {
            return None;
        }
        position -= 1;
    }
}

fn manifest(bytes: &[u8]) -> Result<String, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    if let Some(count) = central_entry_count(bytes) {
        if count != archive.len() as u64 {
            return Err(format!(
                "Unsafe, duplicate, or excessive ZIP entries: {count} central directory entries"
            ));
        }
    }
    let mut files = BTreeMap::<String, String>::new();
    let mut paths = HashSet::<String>::new();
    let mut total_size: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| error.to_string())?;
        let path = entry.name().to_string();
        validate_path(&path, &paths)?;
        paths.insert(path.clone());
        if entry.is_dir() || path.ends_with('/') {
            continue;
        }
        if entry.encrypted() {
            return Err(format!("Cannot checksum encrypted ZIP entry: {path}"));
        }
        let declared = entry.size();
        if total_size + declared > MAX_UNCOMPRESSED_SIZE {
            return Err("ZIP exceeds uncompressed checksum generation limit".to_string());
        }

        let mut hash = Xxh3::new();
        // Heap buffer: the Worker WASM stack is too small for 64 KiB on it.
        let mut buffer = vec![0u8; READ_CHUNK];
        let mut size: u64 = 0;
        loop {
            let read = entry.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            size += read as u64;
            total_size += read as u64;
            if total_size > MAX_UNCOMPRESSED_SIZE || size > declared {
                return Err("ZIP exceeds uncompressed checksum generation limit".to_string());
            }
            hash.update(&buffer[..read]);
        }
        if size != declared {
            return Err(format!("Truncated ZIP entry: {path}"));
        }
        files.insert(path, format!("{:032x}", hash.digest128()));
    }

    let mut out = String::from("{\"algorithm\":\"xxh128\",\"files\":{");
    for (index, (path, digest)) in files.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(&serde_json::to_string(path).map_err(|error| error.to_string())?);
        out.push(':');
        out.push_str(&serde_json::to_string(digest).map_err(|error| error.to_string())?);
    }
    out.push_str("}}");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::manifest;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let options = SimpleFileOptions::default();
        let mut cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut cursor);
        for (name, contents) in entries {
            if name.ends_with('/') {
                writer.add_directory(*name, options).unwrap();
            } else {
                writer.start_file(*name, options).unwrap();
                writer.write_all(contents).unwrap();
            }
        }
        writer.finish().unwrap();
        cursor.into_inner()
    }

    #[test]
    fn hashes_known_vectors() {
        let zip = zip_bytes(&[("a.txt", b""), ("b.txt", b"abc"), ("dir/", b"")]);
        let json = manifest(&zip).unwrap();
        assert_eq!(
            json,
            "{\"algorithm\":\"xxh128\",\"files\":{\"a.txt\":\"99aa06d3014798d86001c324468d497f\",\"b.txt\":\"06b05ab6733a618578af5f94892f3950\"}}"
        );
    }

    #[test]
    fn rejects_unsafe_and_duplicate_paths() {
        assert!(manifest(&zip_bytes(&[("../a.txt", b"x")])).is_err());
        assert!(manifest(b"not a zip").is_err());
    }
}
