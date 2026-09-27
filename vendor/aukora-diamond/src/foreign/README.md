# foreign/ — second implementation smoke

Tiny verifier that **does not import `toy.*`**. Checks the sealed
`aukora-receipt/v3-toy` format (closed fields + Ed25519) and a minimal
Phase 0 pair shape.

**Not a standard.** Call it “second implementation smoke.”

```bash
PYTHONPATH=. python3 -m foreign.verify_receipt out/receipt-load.json --pub out/issuer.pk
PYTHONPATH=. python3 -m foreign.verify_phase0 --retained out/retained.json --presented out/presented.json
```
