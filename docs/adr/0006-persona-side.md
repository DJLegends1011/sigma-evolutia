# The Persona Side lives in Evolutia's own table, behind `{{evolutia-persona}}`

Sigma's personas have no field for extension data and no extension slot in their UI. A persona's Field Definitions and Original Description are therefore kept in Evolutia's own table keyed by persona id, and switching Evolutia on for a persona replaces its description with `{{evolutia-persona}}` (the card trick of ADR 0003). The editor is a block Evolutia adds below the Personas list in Settings › Chat, opening the card editor in a dialog, and removed again when Evolutia is switched off.

## Consequences

- A persona's Evolutia data does not travel with Sigma's persona export or LAN Sync; its description shows `{{evolutia-persona}}` wherever else it is read.
- The Settings block depends on Sigma's markup for that panel, so it is placed beside the list (which Sigma redraws wholesale) rather than in each row.

## Considered Options

- **A button on each persona row**: closest to the card tab, but the list is redrawn on every change and the buttons would have to be put back each time.
- **Settings › Extensions › Evolutia**: no markup dependency, but far from where personas are managed.
