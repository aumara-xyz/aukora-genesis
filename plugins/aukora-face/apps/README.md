# Auma Live Start Voice

Use the existing voice orb labeled **Start Voice**. The nearby disclosure says that this action sends spoken text and conversation history to OpenRouter for the selected session. No separate consent setting is needed. Authorization remains in memory for up to one hour; **Stop Voice** revokes it and cancels active turns. A changed session needs another Start Voice action.

Start does not itself send a prompt. Every spoken request carries its session authorization, and every provider dispatch and continuation still checks the shipped disclosure policy. Start authorizes only `turn-text` and `history` to `openrouter.ai`; it does not authorize screen, repository, memory, identity, web or organism-state context, even if another policy allows those classes. An unavailable policy, missing live session, expiry or revocation refuses sending. This requires the browser/action path to be trusted; the local bearer does not prove human attendance or resist a hostile same-UID client.

The existing composition `providerSendConsent` value remains for other engine callers, default false. It cannot substitute for Start Voice on the Voice HTTP route. Browser state and model directives cannot set that configuration. Credentials, native execution permissions and deployed settings are unchanged by Start Voice. Typed submissions do not receive the spoken-session authorization.
