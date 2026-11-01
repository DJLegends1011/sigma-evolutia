# Evolutia for Project Σ

Lets a character's definition change as the story unfolds. A card's Description is split into **Fields** that **Triggers** switch on and off, with optional **Entry and Exit Actions** that ask the next reply to narrate the change, and whole **Alter Egos** (a werewolf form, a disguise) that swap the full set of Fields. The same works for your own persona.

Each chat keeps its own state, worked out from its messages every time a prompt is built, so swipes, edits, deletes and branches all just work. Evolutia makes **no AI calls** of its own.

## Credits

Evolutia is a reimagining of **[Aspect: Evolutia](https://github.com/Vectricity/st-aspect-evolutia)** for SillyTavern by **Genisai**, who built the idea of Dynamic Fields, keyword triggers, Trigger Actions and Alter Egos, and passed the project on. This version is a fresh implementation for Project Σ, built on the core of his v1.3.1; the multi-character planner of his later versions is not part of it. Thank you, Genisai.

## Install

Settings › Extensions › Install, with this repository's release zip (`evolutia.zip`), or copy this folder into `extensions/installed/evolutia/`. Restart the server (Evolutia has a server half), then switch it on.

## Use

**A character.** Open a card's details › **Evolutia** tab › *Use Evolutia on this card*. The Description becomes `{{evolutia}}` (its text is kept, and switching off restores it), and every `##` heading of it becomes a Field. Then, per Field:

- **Activating Trigger**: the Field is in the prompt only while one of its keywords is in the recent messages.
- **Enabling / Disabling Trigger**: the newest message switches the Field on or off, and it stays that way.
- **Entry / Exit Action**: an instruction asked of the next reply when the Field switches ("Kael transforms into a werewolf"), confirmed by a reply containing your Confirm keywords, and asked again for a set number of replies.
- Keywords match whole words; write `/regex/` for patterns, one per line.

**Alter Egos** are complete alternative sets of Fields, with their own Entry Trigger, Actions, the name the prompt uses, and the name and avatar shown on messages.

**Your persona.** Settings › Chat › *Evolutia for personas*: the same editor, for you. The persona's description becomes `{{evolutia_persona}}`; Actions are asked of the character's next reply.

**In a chat.** The **Evolutia** window shows both sides' state, lets you switch Fields and Alter Egos by hand, and previews what the next prompt carries. *Switch Alter Ego* in the chat menu does the same for Alter Egos.

## Settings

Settings › Extensions › Evolutia: the **Window** (recent messages Activating Triggers read), **Action Tries**, and the **Action Template**. A card or persona can override each in its own editor.

## Developing

- Design: [`CONTEXT.md`](CONTEXT.md) (the glossary) and [`docs/adr/`](docs/adr) (why it is built this way); open questions in [`docs/revisit.md`](docs/revisit.md).
- Tests run against a real Sigma server through its extension kit: `node --test test/*.test.mjs` (expects Project Σ at `../../../ProjectSigma-main`).
- The throwaway state-model prototype lives on the `prototype/state-model` branch.

## Licence

To be agreed with the original author before any public release.
