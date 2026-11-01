# Evolutia

A Project Sigma extension that lets a character's definition change over the course of a chat: the definition is split into Fields that come and go as the story unfolds. Reimagined from Genisai's SillyTavern extension "Aspect: Evolutia" (v1.3.1 core only; single-character chats).

## Language

**Field**:
A named, ordered piece of a character's definition (e.g. "Appearance", "Werewolf Form") that is either in the prompt or not at a given point in a chat.
_Avoid_: Dynamic Field, aspect, section, chunk

**Field Definition**:
A Field as authored on the character card: its name, content, order, and Triggers. Shared by every chat with that card.
_Avoid_: field config, template

**Field State**:
Whether a Field is on or off in one chat at one point in that chat's history.
_Avoid_: enabled flag, inject flag

**Trigger**:
A keyword rule on a Field that, when it matches chat text, changes or gates the Field's presence. Matching is whole-word by default, with optional `/regex/` entries.
_Avoid_: condition, rule

**Trigger Source**:
Which recent messages a Trigger reads: the user's, the character's, or both, within the Window.

**Window**:
How many of the most recent messages Triggers look back over (1 by default).
_Avoid_: scan depth, lookback

**Activating Trigger**:
A Trigger that admits a Field's content only while it matches.

**Enabling Trigger**:
A Trigger that switches a Field on, and it stays on afterwards. Enabling and Disabling Triggers read only the newest message, never the whole Window, so an old keyword cannot undo a Manual Switch.

**Disabling Trigger**:
A Trigger that switches a Field off, and it stays off afterwards.

**Entry Action**:
An instruction put in the prompt for one turn when a Field or Alter Ego is switched on ("Kael transforms into a werewolf"). Its content enters the prompt only after that turn.
_Avoid_: Trigger Action, transition prompt

**Exit Action**:
An instruction put in the prompt for one turn when a Field or Alter Ego is switched off ("Kael reverts to human"). Its content leaves the prompt after that turn.

**Confirm Keywords**:
Keywords on an Entry or Exit Action that a character reply must contain for the Action to count as done. Without them, any reply counts.

**Action Tries**:
How many replies an unconfirmed Action is asked for before Evolutia gives up; giving up leaves the Field (or Alter Ego) as it was before the switch.

**Action Template**:
The wording that wraps an Entry or Exit Action when it is put in the prompt, near the reply.

**In the Prompt**:
A Field is In the Prompt when it is on and either has no Activating Triggers or one of them matches the Window. If an Enabling and a Disabling Trigger match at the same message, the Disabling Trigger wins.

**Alter Ego**:
A complete alternative set of Field Definitions for the same character. Exactly one Alter Ego is active in a chat at a time.
_Avoid_: form, variant, persona (a persona is the user's character)

**Entry Trigger**:
A Trigger on an Alter Ego that makes it the active one; like a Field's Triggers it has its own Trigger Source. If several Alter Egos' Entry Triggers match at once, the one listed first wins. An Alter Ego's Field State is kept while another is active.

**Manual Switch**:
The user turning a Field or Alter Ego on or off from the chat; it counts as a Trigger firing at the newest message, Entry or Exit Action included unless skipped.

**Prompt Name**:
The name an Alter Ego gives the character in the prompt, in place of the card's name.

**Display Identity**:
The name and avatar an Alter Ego shows on the messages written while it was active. The reply that carries a change to another Alter Ego still shows the old one. The card's own name and avatar are never changed.

**Legacy Data**:
Evolutia data from the SillyTavern original, found on imported cards under `st-description-swap-fields`, which Evolutia can convert.

**Original Description**:
The card's Description text from before Evolutia was turned on, kept so that turning Evolutia off restores it.

**Branch**:
A chat created from another chat at a message. It inherits the parent's Field State and active Alter Ego as of that message.
