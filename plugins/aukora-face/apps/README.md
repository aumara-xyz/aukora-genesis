# Auma Live provider consent

Provider requests are off by default. Open Auma Live's existing mind-and-voice panel to see consent, the release policy recipient/classes, and native SDK provider refusals. The panel is read-only: browser state, a model directive, or a request field cannot enable consent.

The consent value currently belongs to the `aukora-face-apps` composition config. It is not a registered writable settings namespace. The general Settings document is therefore not an enable switch for it.

The operator can enable it through the existing owner-managed composition override, normally `auma-live.patch.yml` already named in the deployment's patch list after the release composition:

```yaml
- id: aukora-face-apps
  config:
    providerSendConsent: true
```

Add only `providerSendConsent` inside that row's **existing** `config` block. Preserve homeSession, offeredMinds and every other field: replacing the whole block can discard them. Do not add a second competing row or edit the release's generated composition. Apply the override through the deployment's normal owner-approved configuration/reload procedure. This repository change does not write deployment configuration or perform a reload.

To disable sending, set `providerSendConsent: false` in the same block and apply it through the same procedure. Until the new configuration is loaded, the running backend retains its previous setting; closing or muting the channel stops new spoken turns while arranging the reload. There is no environment-variable or HTTP override for consent.

Enabling consent permits consideration of provider requests carrying prompts, typed/spoken turn text and conversation history. The release policy independently restricts recipient and data classes on every request and continuation. The shipped policy allows only turn-text/history to openrouter.ai. Identity, memory, repository, web, screen and organism-state context require their own release policy authorisation. Consent does not provide credentials, change that policy, or authorise native execution.

Codex and Claude Code native SDK subagent launches remain unavailable in this release with `AUKORA_NATIVE_CONFINEMENT_UNWIRED`. The existing authenticated minds availability response reports the exact startup refusals. Binary presence on PATH and direct presence model selection do not establish native SDK availability.
