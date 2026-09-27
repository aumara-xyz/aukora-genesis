# Launch-downward topology preflight

English | [中文](README.zh.md)

This directory contains a read-only observer for a proposed launch-downward host topology. It compares names from [`topology.example.json`](topology.example.json) with the running operating system. It does not create accounts or groups, load jobs, alter permissions, create sockets, start Aukora, or launch a guest.

Run it from the repository root:

```sh
node aukora/supervisor/bin.mjs ops/launch-downward/topology.example.json
```

The example intentionally names principals and paths that an ordinary development host does not normally yield as complete observations. Such a host exits `1` with named refusals including `supervisor:principal-unobserved`. That reason covers a missing account, command failure, timeout, or incomplete parse without pretending to distinguish them. Missing filesystem objects produce `supervisor:path-absent`; absence never grades as successful deprivation. A configuration with no observed refusal exits `2` as `UNVERIFIED`. This non-activating command has no exit-`0` outcome.

## What it observes

The manifest supplies only account names, job labels, group names, and POSIX absolute paths. POSIX parsing is fixed by the schema on every test host because the supported target platforms are macOS and Linux. Unknown fields are refused, including `uid`, `gid`, `pid`, mode, and observed-state fields. Input and parse failures use `aukora:topology-input-refusal:v1` with `factsSource: "none"`; they do not claim that host observation occurred.

The preflight gets account and group facts from the host identity database, job PIDs from `launchctl` on macOS or `systemctl` on Linux, process UIDs from `ps`, and filesystem ownership, type, and mode from `lstat`. Child processes have a five-second bound. Only `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` are preserved for Linux `systemctl --user`; no other invoking environment reaches an observer subprocess. Route-group reuse and outsider membership compare live numeric GIDs, not manifest names.

Four principals are named at this stage: the `node:os.userInfo()` account that invoked the observer is `human-session`, while `issuer`, `broker`, and `guest` name three service accounts. `invoking-process-user` is deliberately not described as the logged-in or console user because `userInfo()` does not measure either fact. A repeated live UID produces `supervisor:principals-merged`, even when different account names were supplied. The human approval job is sought in the invoking account's GUI or user-service domain. A timeout, manager error, parse failure, inactive job, or PID race all produce `supervisor:principal-job-unobserved`; the observer does not overstate that result as proof of absence.

Each socket route has one fixed owner and peer: human session to issuer, broker to issuer, and guest to broker. Every route directory must be an immediate child of the one required socket root. Route directories must be owner-held `0710` directories and live sockets must be owner-held `0660` sockets in those directories. For every non-guest protected object and route object that exists, the observer walks each parent component, refuses intermediate symlinks, and reports when the live guest UID or GIDs can replace a child pathname under POSIX write and traversal bits. Sticky-directory ownership is included in that replacement calculation.

The protected-path inventory is closed and nonempty: root and receipt keys, nonce state, evidence, active profile, active artifact, implementation closure, guest scratch, and the common socket root must all exist with their fixed leaf owner, type, and mode. This is a root-object observation, not a recursive closure measurement.

## Non-claims

`status: "UNVERIFIED"` and `configurationMatched: true` mean only that the named configuration observations had no refusal. `UNVERIFIED` exits `2`; `REFUSED` exits `1`. Every observation carries `observationClass: "CONFIGURATION_ONLY"`, `activationPerformed: false`, `hostMutationPerformed: false`, and `separationVerified: false`. No output from this command authorizes activation.

Every result names the evidence still missing: active allow and deny probes, recursive closure-member measurement, binding observed PIDs to their executable and actual runtime paths, complete host/NSS membership of route groups, socket peer authentication, extended ACL observation, and a resolved observer privilege model. The last limitation is structural: an ordinary invoking user cannot traverse service-owned `0700` state directories, while running the same command through `sudo` changes the invoking-process identity and therefore no longer measures the human principal. This command does not paper over that dilemma.

Static identity, membership, leaf mode, and ancestor POSIX-mode observations do not prove cross-UID denial, do not cover extended ACLs, and can change after observation. A `0555` profile or implementation directory can still contain an existing guest-writable child; this observer does not recursively enumerate it. A safe manifest tree can also be a decoy unless the observed job is bound to those exact paths. These limits remain permanent `verificationBlockers`, so configuration agreement cannot become a green result.

The current four-principal layout does not claim broker-independent evidence. The broker still owns receipt signing, nonce state, and the evidence file. A separately custodied witness or committer requires another real principal plus runtime behavior that uses it; this observer does not invent a fifth placeholder identity.

This preflight is not enrolled in any court and cannot move a known breach to green. Attended provisioning, runtime binding, recursive closure measurement, and active probes remain separate work.
