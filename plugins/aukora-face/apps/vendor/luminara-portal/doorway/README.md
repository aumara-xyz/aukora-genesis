# THE DOORWAY

*The portal made legible to an AI coder, and nothing more.*

An MCP server over stdio. Four tools, all of them readings of what already
stands:

- **deck** — the twenty-seven at a glance
- **card** — one card, whole, by number or name
- **sky_at** — the sky read at a moment; weather, never verdict
- **replay_declared_seed** — a committed cast reconstructed from its own
  declared seed: the three, the nine-weave, the whole field

There is no draw tool through this doorway and there never will be. A cast
belongs to the hand at the bench, with its rite, its witness and its
journal; none of those exist here. The pins in
`core/tests/doorway.test.ts` hold this by construction: no entropy, no
storage, no network, no files.

## Registering it

With Claude Code, from the repository root:

```
claude mcp add luminara -- bun doorway/server.mjs
```

Or in any MCP client's configuration, as a stdio server:

```json
{
  "mcpServers": {
    "luminara": {
      "command": "bun",
      "args": ["doorway/server.mjs"],
      "cwd": "<path to luminara-portal>"
    }
  }
}
```

THE VESSEL'S OWN · READS STDIN, WRITES STDOUT, TOUCHES NOTHING ELSE
