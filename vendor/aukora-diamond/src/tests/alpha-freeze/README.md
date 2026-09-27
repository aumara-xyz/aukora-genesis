# Alpha signed source statement, consumed cold

```sh
python3 -B tests/alpha-freeze/test_alpha_freeze.py
python3 -B scripts/verify-alpha-freeze.py tests/alpha-freeze/fixtures/freeze.json \
  --pub tests/alpha-freeze/fixtures/issuer-public.jwk \
  --subject eff6deb1f07b69526e20d980482c5611b126ca9a \
  --tree cf98537df6ba0a5f9ff12c63011870d5f3b0298d
```

The consumer requires the public JWK file, expected commit, and expected tree as
separate caller inputs. The example supplies an explicitly historical anchor;
an untrusted bundle cannot establish its own signer identity or expected source.
It reads no Git checkout, private key, Node runtime, network, or live state.

The fixture is the actual committed Alpha `aukora-freeze/v1` statement, not a
locally reminted approximation. `fixtures/PROVENANCE.json` pins the two imported
files, their source commit, and the separately observed subject/tree relation.
The JWK contains only public `kty`, `crv`, `kid`, and `x` members. These two Alpha
assets retain the proprietary notices in [LICENSE](../../profiles/alpha/LICENSE)
and [LICENSING.md](../../profiles/alpha/LICENSING.md); inclusion grants no new license.

The wire is defined by Alpha at `ddb6a9cc9860fce840283b0010e24e7d627fa9db`:
`src/freeze.ts` constructs/removes the signature field;
`src/authority/issuer.mjs:81` signs `stableStringify(body)`; and
`src/evidence/aura.mjs:42` recursively sorts object keys and uses `JSON.stringify`
for primitives. The domain is a signed JSON member, with **no domain prefix**.
This consumer admits a stricter, explicit subset: the exact historical field
set, nonnegative safe integers, an ASCII key identifier, `DARWIN_ONLY`, attended
`PASS`/`UNRUN`, and model `UNRUN`. Decimal/nonfinite numbers, unknown fields,
duplicate keys, and unsupported values refuse by name. Compact sorted ASCII
JSON is byte-identical on this subset; the historical producer signature is
the cross-language integration check.

`issuerKeyDigest` hashes the **exact public-key file bytes**, including layout;
it is not Alpha's separate normalized JWK digest. The JWK `kid` must match the
statement. No rotation hierarchy or root succession is inferred from this one key.

Success is `SIGNED_SOURCE_STATEMENT_VALID`: the named key signed these counts,
source identifiers and labels. It does not rerun courts, inspect the named tree,
establish source execution, human attendance, model execution, or confinement.
Those limits print on success, named refusal, missing arguments, and help.
The tests use the historical signed bytes and ordinary changes to counts,
signatures, key bytes, independent anchors, format, and JSON shape. They mint
nothing and run the real CLI from an empty temporary working directory.
