# Rust admission — rebuilt (post false-green court)

## Was

Minimal string-split JSON. Empty proof elements dropped → 8× APPEND_ONLY on
transparency-dev `preceding-garbage` / `trailing-garbage` probes.

## Now

Independent wire admission:

1. UTF-8 check  
2. Top-level **duplicate key** refuse (raw member-name spelling)  
3. **One** `serde_json` structural parse (Rust stack — not CPython)  
4. `treeSize` as JSON number only (string sizes refused)  
5. `root` / each proof element: **exactly 64 hex digits** → 32 bytes; **empty string refuses**  
6. Metadata fields (`schema`, `epoch`, …) ignored; not a second parse of digests  

## Oracle result after rebuild

| | before | after |
| --- | ---: | ---: |
| rust vs oracle | 89/98 | **97/98** |
| four-way agreement | 90 | **98** |
| false greens on garbage | 8 | **0** |

## Remaining named divergence (all four)

Non-32-byte roots refused — stricter than transparency-dev equal-size fixture using ASCII roots.

## Still not claimed

Permissions cell STRUCK (ENVIRONMENT_BLOCKED single-uid host) — not claimed measured.  
Demo-wire encoding corpus still mostly self-authored.
