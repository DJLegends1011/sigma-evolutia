# 8. Non-Destructive Trigger Stripping, Disguise Mode, and Assistant Integration

Date: 2026-11-01

## Context

In `v0.3.0`, three capabilities were added on top of the message-derived state engine (ADR 0004) and macro-based description swap (ADR 0003 & ADR 0006):

1. **Trigger Keyword Stripping (`stripTriggers`):** Users sometimes include a dedicated command word or phrase in a message to trigger a Field or Alter Ego without wanting that literal keyword to remain visible in the conversation or sent to the roleplay LLM.
2. **Disguise Mode (`disguise: true`) & Message Badges:** When a character or persona assumes an in-scene disguise (e.g., Demetri disguised as Bambi), both the roleplay model and the out-of-character Chat Assistant need explicit framing that the character is presenting as that identity in-scene, and each message header should indicate the active Alter Ego / Disguise / non-default Fields.
3. **Chat Assistant & Creator Studio Integration:** Because Evolutia replaces `card.data.description` with `{{evolutia}}` and `persona.description` with `{{evolutia_persona}}`, Project Σ's Chat Assistant (`purpose: 'assistant'`) and Creator Studio (`purpose: 'creator'`) would otherwise see the literal unexpanded macro string `{{evolutia}}` and no Persona Alter Ego state. Furthermore, instead of Evolutia making its own standalone LLM calls (ADR 0001), Sigma's own Assistant and Creator Studio can serve as interactive partners for distilling and authoring Evolutia Fields and Alter Egos.

## Decision

1. **Non-Destructive Pipeline Stripping (`prompt.final` + `message.render`/`message.enhance`):**
   `stripTriggers` never writes to `chat_messages` in SQLite and never mutates data inside a `store.before.*` guard. Instead:
   - Stored messages remain untouched as written, so `deriveTimeline` (ADR 0004) always sees the trigger keyword on every turn, swipe, branch, and reload.
   - On the server, `prompt.final` strips matched trigger keywords from outgoing prompt messages (including the Prompt Inspector), and `GET /chats/:chatId/state` returns a `stripped` map (`{ [seq]: strippedText }`).
   - On the client, `client/identity.js` uses `message.render` and `message.enhance` to display the stripped text in the chat bubble while preserving the original HTML to restore if `stripTriggers` is turned off.

2. **Disguise Framing & Message Badges:**
   - When an Alter Ego has `disguise: true`, `promptFor` emits an explicit in-scene disguise line at the top of `{{evolutia}}` / `{{evolutia_persona}}`, and `badgeFor` returns `{ text: 'Disguise · ...', disguise: true }` rendered by `client/identity.js` as `.evo-msg-badge.is-disguise`.

3. **Assistant & Creator Studio Blueprint Expansion + `cl-evolutia-edits`:**
   - Core Evolutia still makes no hidden LLM calls of its own (ADR 0001).
   - When the user talks to Sigma's Chat Assistant (`purpose === 'assistant'`) or Creator Studio (`purpose === 'creator'`), Evolutia's `llm.request` hook expands `{{evolutia}}` and `{{evolutia_persona}}` inside the reference material into a complete blueprint (active Alter Ego, Disguise state, and all active and gated/off Fields with their triggers and actions) and appends the `cl-evolutia-edits` directive to the system prompt.
   - Evolutia seeds starter Saved Prompts (`Distill Alter Ego`, `Distill to Lorebook`, `Suggest Triggers & Fields`, `Split into Evolutia Fields`) into `assistant-prompts` and `creator-studio-prompts`.
   - On the client, `client/assistant-bridge.js` upgrades any `cl-evolutia-edits` block in `#casBody` or `#ccsBody` into an interactive Evolutia Review Card that applies changes via `POST /api/ext/evolutia/assistant-apply`.

## Consequences

- `chat_messages` rows are never rewritten by `stripTriggers`, keeping store guards read-only and timeline derivation 100% deterministic across turns and reloads.
- The Chat Assistant and Creator Studio have full visibility into both active and inactive Evolutia Fields and Alter Egos, and can propose 1-click Evolutia or Lorebook edits using Sigma's native review workflow.
