# THE LOCAL PROGRAMME

*The full plan for Luminara as its own local application: what stands, what is
built in which order, what each stage costs, and the laws that bind every
stage. Prepared 20 July 2026 at the architect's word.*

---

## 0 · WHAT ALREADY STANDS

The measurements this plan is built on, taken on the architect's machine on
20 July 2026, not estimated:

- This repository is the complete portal: five rooms, every module they
  import, the Map Room's full catalogue and charts, eight test files
  (102 tests, 26,014 assertions, passing standalone), and a 70-line door
  (`spatial/serve.ts`: GET and HEAD only, two static directories, one
  traversal guard).
- The portal payload is about **2 MB**: 692 KB of rooms and modules, 644 KB
  of charts, three served PDFs of about 1 MB.
- The Bun runtime, compiled to a single executable, is **94 MB** before any
  of our code enters. A Tauri wrapper using the operating system's own
  webview is roughly **10 MB**. A zipped folder is 2 MB but requires Bun on
  the receiving machine.
- The portal touches the network in exactly **one place**: the Living Cube
  asks the drand beacon for a round, with a 2.5 second timeout and a null
  fallback already in place. Everything else is local by construction. Every
  cast, journal, and draft lives in the visiting browser's own storage.

The distance from "fully local programme" is therefore short, and most of
this plan is packaging rather than construction.

## 1 · THE BALLAST (an hour)

Two artifacts sit in `docs/` that the catalogue does not serve: the deck
reveal reference PDF (12 MB) and the first book pressing's HTML (1.5 MB).
They are legitimate reference artifacts and stay in the repository, but they
move to `docs/archive/`, and every bundle in this plan excludes that
directory. The shipped programme carries the 2 MB it serves and nothing it
does not.

**Done when:** the two files live under `docs/archive/`, the catalogue still
resolves every path, and the pins stay green.

## 2 · THE WINDOW, IN THREE TIERS

The programme needs a window of its own rather than a browser tab. Three
tiers, built in order, each usable the day it lands; later tiers never
retire earlier ones.

**Tier A — the launcher (ten minutes, works today).** A `luminara.cmd` at
the repository root: start the door on its port, then open the system's
Edge in `--app` mode pointed at the Wayfinder, which gives a clean window
with no browser chrome. Requires Bun on the machine and nothing else. This
is the architect's own daily door, and it is enough for any machine we
control.

**Done when:** double-clicking the file opens the portal in its own window
and closing the window is the whole shutdown.

**Tier B — the travelling build (about a day).** A Tauri v2 wrapper: the
same rooms, served to the OS webview through a custom protocol handler
that maps `/app/*` and `/docs/*` to bundled resources, read-only by
construction, so the constitution survives packaging without a server
existing at all. Produces a Windows installer of roughly 10 MB. Requires
the Rust toolchain at build time only; recipients need nothing. This is
the build that goes to a friend.

**Done when:** the installer runs on a machine with no Bun, no Rust, and no
network, and all five rooms stand; the unsigned-installer warning is
documented plainly in the README rather than worked around.

**Tier C — the single file (half a day, optional).** `bun build --compile`
with the assets embedded: one 96 MB executable, no installer, no
dependencies, for the case where one file matters more than its size.
Built only if a real recipient needs it.

## 3 · THE OFFLINE SEAL (an hour)

The one network touch gets its law made explicit. When the drand beacon is
unreachable, the cube's cast falls to the next rung of the Aleatory Law's
own ladder (cryptographic randomness, declared as such), and the
declaration line says which rung answered. Offline is not a degraded mode;
it is a lower rung on a ladder the law already ranks, named honestly at
cast time.

**Done when:** the machine's network is disabled, every room loads, a cube
cast completes, and its declaration names the rung that actually served.

## 4 · THE DOORWAY (two to three hours)

A small MCP server, `mcp/` in this repository, run over stdio by any AI
host (Claude Desktop, Claude Code, an agent on the partner node). The canon
is already pure, so the server is thin wiring over existing exports.

**Tools exposed, all read-only:** the card (name, essence, code, interval,
counter, becoming), the catalogue, a chart's text through the same door the
room uses, the standing cell of a given moment, and the astrolabe's sky
state. **Tools refused, by the Caster's Law:** anything that draws. An
agent that can call a draw can call it eleven times and keep the pretty
one, which is composition wearing chance's clothes. The cast happens in
the vessel, where it is journaled and replayable; the portable seed block
in the law already instructs any conforming reader accordingly.

**Done when:** an AI host with the server configured can name a card's
essence, walk the catalogue, and read a chart, and a grep of the server
source finds no draw call.

## 5 · THE VESSEL'S KEEPING (an hour, mostly words)

Everything personal lives in the browser profile's local storage: casts,
journals, desk drafts. In the local programme that profile IS the vessel,
and the plan's obligation is honesty about it: a line on the reading bench
naming where the journal lives, and the desk's existing download door
noted as the way anything is carried out. No sync, no accounts, no
telemetry, nothing leaves the machine. Tier B's webview keeps its own
profile storage, which the README states plainly so nobody expects casts
to follow them between the browser and the app.

**Done when:** the README carries the vessel section and nothing in any
tier phones anywhere.

## 6 · UPDATES AND FRIENDS

The update channel is `git pull`, and for Tier B recipients, a fresh
installer built from a tagged release. Releases are tagged in the manner
of the room: a version line moved only at the architect's word. Friends
receive either a collaborator invitation to this private repository or an
installer file, at the architect's choice per person; nothing here is
public until he says so.

## 7 · WHAT IS DELIBERATELY NOT BUILT

No auto-updater (a standing write lane into the machine, refused). No
telemetry or crash reporting of any kind. No accounts. No code signing for
now: the honest cost is one Defender warning on Tier B/C installs,
documented rather than purchased away. No AI inside the programme: the
coding agent stays beside the portal with the repository, and the portal
stays a lens; the doorway of stage 4 is how any AI reads the work.

## 8 · THE ORDER, AND THE WHOLE COST

| stage | what | cost |
|---|---|---|
| 1 | the ballast to `docs/archive/` | an hour |
| 2A | the launcher window | ten minutes |
| 3 | the offline seal | an hour |
| 4 | the doorway (MCP) | two to three hours |
| 5 | the vessel section | an hour |
| 2B | the Tauri travelling build | a day |
| 2C | the single file | half a day, if ever |

Stages 1 through 5 are one working day in total and give the architect a
complete local programme with an AI doorway. Stage 2B is the second day,
taken when the programme first needs to travel to a machine we do not
control.

## 9 · THE LAWS THAT BIND EVERY STAGE

The door serves GET and HEAD and nothing else, in every tier, including
the Tauri protocol handler, which cannot write by construction. The room
proposes files as downloads and never writes one. No draw tool crosses the
doorway, ever. The null is never lit, the register holds, and nothing in
the programme predicts or prescribes. EMPTINESS holds at the operating
system too: no startup entries, no background process after the window
closes, no notification ever.

## PROVENANCE

*Prepared 20 July 2026 at the architect's word ("prepare the full plan for
the implementation of the fully local Luminara programme"), in the
portal's own repository, from measurements taken the same day on the
machine that will run it. The sizes are measured, not estimated; the
single network touch was found by audit and its existing fallback read in
the source. The plan packages what stands and builds one new thing only,
the doorway, whose one refusal is the Caster's Law applied to a new kind
of reader. Nothing here predicts, and nothing here prescribes.*
