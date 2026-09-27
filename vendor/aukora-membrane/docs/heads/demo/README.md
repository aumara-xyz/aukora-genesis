# docs/heads/demo/ — real bytes, and a command for every claim

Every statement in this file is a command you can run. If a line does not come with one, it should
not be here.

You need `python3` and nothing else. No membrane, no server, no chain, no `bun`.

```bash
python3 minimal/verify.py docs/heads/demo/append-only/retained.json \
                          docs/heads/demo/append-only/presented.json
```

Two files per case: `retained.json` is a head someone kept, `presented.json` is the head they were
shown later — and it carries the consistency proof between them, in `proofFromPrevious`, exactly
the way the real published head at `../latest.json` does.

---

## Read this first, and check it

**These are not a witness.** The retained heads are retrospective: generated from prefixes of the
real chain. True statements, and **nobody kept them.**

Check that they are true statements:

```bash
bun run scripts/head-emit.ts --check      # folds every case against the live chain
```

The value of the real mechanism is that a retained head sits on someone else's disk, out of our
reach. These demonstrate arithmetic. They demonstrate **nothing** about the witness property — and
that is not an admission you have to take on trust either:

```bash
python3 -c "
import json,subprocess,os
revs=subprocess.run(['git','log','--format=%H','--','docs/heads/latest.json'],
                    capture_output=True,text=True).stdout.split()
pub=set()
for r in revs:
    o=subprocess.run(['git','show',r+':docs/heads/latest.json'],capture_output=True,text=True)
    if o.returncode: continue
    try: j=json.loads(o.stdout)
    except Exception: continue
    pub.add((j.get('treeSize'),j.get('root')))
print('heads ever published:',len(pub))
for d in sorted(os.listdir('docs/heads/demo')):
    p='docs/heads/demo/'+d+'/retained.json'
    if not os.path.exists(p): continue
    j=json.load(open(p))
    print(' ',d.ljust(20),'ever published:',(j['treeSize'],j['root']) in pub)"
```

**Every one of them comes back `False`.** Not one of these retained heads was ever published, so
nobody could have kept one. The command reads the git history of `../latest.json` — the only place
a real retained head could have come from — and finds none of these in it.

That is the gap, executable. **The witness property is the one claim in this project with no
runnable proof behind it**, and there is no command that could supply one, because what it asserts
is that a stranger kept a copy. Only the stranger can demonstrate that, and only by producing the
copy. If you came here looking for the seam, this is it, and we would rather hand it to you than
have you find it.

**The forgeries are ours.** In `rewrite-2047/` and `rewrite-2048/` the presented head is a
deliberate forgery — leaf 500 replaced, the log extended. See it:

```bash
python3 -c "import json;print(json.load(open('docs/heads/demo/rewrite-2047/presented.json'))['root'])"
python3 -c "import json;print(json.load(open('docs/heads/demo/append-only/presented.json'))['root'])"
```

Same chain, same size, different roots. One of those two trees is not this chain's.

---

## Ten cases, and the partition they sample

| case | retained → presented | growth | size class | integrity | correct verdict |
| --- | --- | --- | --- | --- | --- |
| `append-only` | 1000 → 2500 | extended | non-pow-2 | intact | `APPEND_ONLY` |
| `append-only-1024` | 1024 → 2500 | extended | pow-2 | intact | `APPEND_ONLY` |
| `damaged-proof` | 1000 → 2500 | extended | non-pow-2 | damaged | `UNDETERMINED` |
| `damaged-proof-1024` | 1024 → 2500 | extended | pow-2 | damaged | `UNDETERMINED` |
| `malformed-root` | 1000 → 2500 | extended | non-pow-2 | **malformed** | `UNDETERMINED` |
| `zero-growth-malformed` | 1200 → 1200 | **zero-growth** | non-pow-2 | **malformed** | `UNDETERMINED` |
| `zero-growth-conflict` | 1200 → 1200 | **zero-growth** | non-pow-2 | forged | `OBSERVATION_CONFLICT` |
| `zero-growth-conflict-1024` | 1024 → 1024 | **zero-growth** | pow-2 | forged | `OBSERVATION_CONFLICT` |
| `rewrite-2047` | 2047 → 2500 | extended | non-pow-2 | forged | `OBSERVATION_CONFLICT` |
| `rewrite-2048` | 2048 → 2500 | extended | pow-2 | forged | `UNDETERMINED` |

Three axes, sixteen cells. Ten sampled, six carrying a stated reason for not being. `--demo`
refuses to write anything if a cell is neither.

```bash
python3 -c "
import json,itertools
j=json.load(open('docs/heads/demo/cases.json'))
cells={(x['growth'],x['sizeClass'],x['integrity']) for x in j['cases']}
want=set(itertools.product(['extended','zero-growth'],['power-of-two','non-power-of-two'],
                           ['intact','damaged','forged','malformed']))
print('sampled',len(cells),'of',len(want),'| unsampled:',len(want-cells))"
```

**The partition found the last bug's empty cell — and then a bug walked in through an axis the
partition did not have.**

The first version had two axes. Every case was `m < n`. GPT then broke the demonstrator with a
63-character root at `m == n`, and this partition could not report that as an empty cell, because
*growth was not an axis*. An empty cell is red. A missing axis is invisible.

```bash
python3 -c "
import json
j=json.load(open('docs/heads/demo/cases.json'))
print('growth relations now sampled:',sorted({x['growth'] for x in j['cases']}))
print('integrity classes now sampled:',sorted({x['integrity'] for x in j['cases']}))"
```

Same shape as the 546-vector attack that found nothing: that generator built proofs, and the
`m == n` branch takes an *empty* proof, so it could not construct a single case there. **A
generator defines its own reachable universe, and so does a partition.**

---

## `encoding-exponent` — the same file, two answers, and neither reader is wrong

The retained `treeSize` is written **`1e3`**. That is one thousand. It is also, to Python, a
float — and Python refuses floats. To JavaScript it is the integer 1000, and everything proceeds.

```bash
python3 -c "print(open('docs/heads/demo/encoding-exponent/retained.json').read()[:90])"
python3 minimal/verify.py docs/heads/demo/encoding-exponent/retained.json \
                          docs/heads/demo/encoding-exponent/presented.json
```

`UNDETERMINED / invalid_tree_sizes` from the demonstrator. `APPEND_ONLY` from the membrane's
TypeScript, on the same bytes:

```bash
bun run scripts/head-emit.ts --check 2>&1 | grep "SPLIT (by design)"
```

**This is real chain data and nothing about it is forged, damaged or rewritten.** The two readers
disagree about what the digits denoted. A differential comparing implementations cannot see it,
because the disagreement is underneath both of them — in the JSON number type, which nobody here
wrote and nobody owns.

`encoding-bignum` is the same class in the dangerous direction, and it is **closed**: retained
`9007199254740993`, presented `9007199254740992`. JavaScript used to round the first down, see two
differing roots at one size, and **accuse**. `Number.isSafeInteger` now refuses both. The case
stays as a regression, because a class that closed is a class that can reopen.

```bash
python3 -c "
import json
j=json.load(open('docs/heads/demo/cases.json'))
for c in j['cases']:
    if c['encoding']=='non-canonical':
        print(c['name'].ljust(20), 'membrane:', c['measuredVerdict'])"
```

### Why the fix has to be lexical

After `JSON.parse`, JavaScript cannot tell `7` from `7.0` from `7e0` — one value, and the token is
gone. No guard over parsed values can recover it. The rule has to be over the **bytes**:

```bash
bun run scripts/head-emit.ts --check 2>&1 | grep "canonical integer literal"
```

Every number token in every published file is read as **text** and matched against
`^(0|[1-9][0-9]*)$`, bounded to 2^53−1. The two encoding cases are the declared exceptions, and
the gate checks that they really are exceptions rather than quietly conforming.

---

## `malformed-root` and `zero-growth-malformed` — the class that walked past everything

An honest log whose presented root lost one character in transit. 63 hex, not 64. The most likely
real failure a stranger will ever hit.

```bash
python3 minimal/verify.py docs/heads/demo/zero-growth-malformed/retained.json \
                          docs/heads/demo/zero-growth-malformed/presented.json
```

`UNDETERMINED / root_is_not_a_digest`. Before it was fixed, this returned `OBSERVATION_CONFLICT` —
an innocent log accused because an envelope was torn. See that the root really is short:

```bash
python3 -c "
import json
r=json.load(open('docs/heads/demo/zero-growth-malformed/presented.json'))['root']
print(len(r),'characters:',r)"
```

**These two cases are unreadable by the strict reader, on purpose.** A demo that can only contain
inputs it already accepts is the closed loop that hid this class from every harness here.

---

## `zero-growth-conflict-1024` — a power of two that CAN accuse

The blind spot is a property of the **fold seed**, not of the size. At `m == n` there is no fold
and no seed: the roots compare directly, and the conflict is derivable at every size.

```bash
python3 minimal/verify.py docs/heads/demo/zero-growth-conflict-1024/retained.json \
                          docs/heads/demo/zero-growth-conflict-1024/presented.json
python3 minimal/verify.py docs/heads/demo/rewrite-2048/retained.json \
                          docs/heads/demo/rewrite-2048/presented.json
```

Both retained at 1024/2048 — powers of two. The first accuses. The second cannot. If you read
"power of two means it can never accuse" anywhere, including in this repository, that is the
correction.

---

## `append-only-1024` — the blind spot costs the accusation, never the verification

At a power-of-two retained size the retained root **is** the consistency fold's seed. That makes
`OBSERVATION_CONFLICT` underivable. It does **not** make verification underivable — an honest pair
folds cleanly and the answer is `APPEND_ONLY`.

```bash
python3 minimal/verify.py docs/heads/demo/append-only-1024/retained.json \
                          docs/heads/demo/append-only-1024/presented.json
```

"Cannot accuse here" and "cannot answer here" are different sentences. Only the first is true.

---

## `damaged-proof` — the only acceptance test that matters

An honest log. Nothing rewritten. One node of a valid proof zeroed, the way a flipped byte in
transport arrives.

```bash
python3 minimal/verify.py docs/heads/demo/damaged-proof/retained.json \
                          docs/heads/demo/damaged-proof/presented.json
```

A verifier answering `OBSERVATION_CONFLICT` there has accused an innocent party because an envelope
got wet. Seven of these twelve cases are honest logs. Count the convictions:

```bash
python3 -c "
import json
j=json.load(open('docs/heads/demo/cases.json'))
h=[x for x in j['cases'] if x['integrity']!='forged']
print(f\"{len(h)} honest, {len([x for x in h if x['measuredVerdict']=='OBSERVATION_CONFLICT'])} convicted\")"
```

---

## `rewrite-2047` vs `rewrite-2048` — the blind spot as a diff

Identical forgery. Identical presented tree. Retained sizes differing by **one**.

```bash
python3 minimal/verify.py docs/heads/demo/rewrite-2047/retained.json \
                          docs/heads/demo/rewrite-2047/presented.json
python3 minimal/verify.py docs/heads/demo/rewrite-2048/retained.json \
                          docs/heads/demo/rewrite-2048/presented.json
```

```bash
diff docs/heads/demo/rewrite-2047/retained.json docs/heads/demo/rewrite-2048/retained.json
```

One number and one root apart. Opposite answers. That is not a bug and it is not ours to fix: the
information needed to separate "your proof does not describe the head you showed me" from "your
proof describes a different history" does not exist in the proof at those sizes.

### And the pair that shows exactly how much is lost

```bash
python3 -c "
import json
c={x['name']:x for x in json.load(open('docs/heads/demo/cases.json'))['cases']}
for n in ('damaged-proof-1024','rewrite-2048'):
    print(f\"{n:20} {c[n]['measuredVerdict']:14} {c[n]['measuredReason']}\")"
```

A transport fault and a real forgery, at the same retained size, returning the **same verdict and
the same reason**. That is correct — at 1024 those two worlds are genuinely indistinguishable —
and the reason names the ceiling rather than implying a broken transfer.

---

## The contract

`CONTRACT.json` declares what is in this directory, which fields each file carries, and who
consumes it. It is enforced, not described — an undeclared file, a missing field, or a listed
consumer that stopped reading takes `--check` red.

```bash
python3 -c "
import json
c=json.load(open('docs/heads/demo/CONTRACT.json'))
print('cases     :',len(c['cases']))
print('per case  :',c['perCaseFiles'])
for x in c['consumers']: print(f\"  {x['path']:34} bound by {x['boundBy']}\")"
```

`minimal/verify.py` is bound **by argument** — it takes paths and names no directory. That
distinction exists because the contract gate's first run reported it as no longer reading the
directory. Grep cannot see an argument-bound consumer; only running it can, which is what the
stranger run does.

---

## Regenerating, and what refuses

```bash
bun run scripts/head-emit.ts --demo      # rebuild from the live chain
bun run scripts/head-emit.ts --check     # re-run every case, plus the stranger's python3 run
```

`--demo` refuses to write a case that does not measure the verdict it was built to show, and
refuses entirely if a declared partition cell has no fixture. `--check` re-runs all six from their
committed bytes, runs `minimal/verify.py` against them and counts the agreement — and fails when an
agreement is *hollow*, meaning the verdict matched for a reason unrelated to the case.

Nothing here is hand-edited. Edit it and `--check` says so.
