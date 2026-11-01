# Field State is derived from the messages, never stored

The original evaluated Triggers inside the generation interceptor and changed stored state there, which broke because a prompt is built several times per reply (swipes, regenerations, the prompt inspector). Here Field State is a pure function of the chat's messages: each time a prompt is built, `{{evolutia}}` replays the history up to the prompt's newest message, applying Triggers, Manual Switches and Action confirmations in order. Manual Switches are stored on the message they attach to (`extra.evolutia`).

Nothing else is stored, so there is no state table, no listener keeping it in step with message changes, and no code copying it into Branches: edits, deletes, swipes and Branches change the messages, and the state follows. A swipe or regeneration reads the history up to the message before the replaced reply, so it sees the state from before that reply.

## Considered Options

- **A per-message state table updated on every message change** (the pattern Sigma's trackers use): needed when state comes from a model's answer and cannot be recomputed, which Evolutia's (ADR 0001) never does. Rejected as storage that could drift from the chat.

## Consequences

Every prompt build re-checks the whole history. Keyword matching costs microseconds a message; if very long chats make it slow, cache by chat and history digest rather than storing state.
