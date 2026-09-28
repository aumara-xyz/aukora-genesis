# docs/research: the AUKORA boundary architecture and two research write-ups
What: the boundary architecture spec and the Skeleton Key II and Golden Boundary measurement papers. Documents, not code.
From: aumara-xyz/aukora-deep@c417f7c5752bf14b8e927986cd995f2e086f4189, under `src/` in its own layout (`src/docs/`, `src/archive/research/`); `LICENSE`, `LICENSE.MIT` and `LICENSING.md` come from that same commit, and `LICENSING.md` says which license covers what.
EXCLUDED: the superseded signer daemon from aumara-xyz/aukora-os@a313d13bcacf2989316f2a5aafaa6aca049e48fb is not distributed here because aukora-os has no applicable licence for it. `PROVENANCE.json` retains its historical source measurements and those of its unimported dependencies under `excludedImport`; none names a local copy.
Tests: none, because these are documents. To check the bytes, run this from this directory:
`node -e 'const p=require("./PROVENANCE.json"),c=require("crypto"),f=require("fs");for(const e of p.files)console.log(c.createHash("sha256").update(f.readFileSync(e.local)).digest("hex")===e.sha256?"ok ":"BAD",e.local)'`
Every retained file's blob id is listed in `PROVENANCE.json`, and `git hash-object <local>` must equal its `gitBlob`.
STATUS: imported byte for byte, not yet wired into Genesis.
