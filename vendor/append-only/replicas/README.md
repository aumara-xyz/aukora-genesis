# Third-runtime replica (substrate axis)

Fable's ruling: two TypeScript verifiers agreeing carries **no information** about
substrate-class defects — shared number/JSON semantics force agreement.

This directory holds an independently authored verifier in **Rust**, built from
`specs/0060-retained-head-demonstrator.md` and the published demo wire shape —
**not** by porting `minimal/verify.py`.

```bash
cd minimal/replicas/rust-verifier
cargo build --release
./target/release/aukora-verify-rs \
  ../../docs/heads/demo/append-only/retained.json \
  ../../docs/heads/demo/append-only/presented.json
```

Compare verdicts to:

```bash
python3 minimal/verify.py <retained> <presented>
```

**Known LIMIT of this replica:** JSON extraction is intentionally minimal (not a full
parser). Duplicate keys and exotic encodings may disagree with Python's
`object_pairs_hook` path — that disagreement is a *finding about the replica*, not a
vote on the record.
