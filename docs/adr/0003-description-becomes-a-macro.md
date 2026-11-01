# The card Description becomes `{{evolutia}}`

Sigma merges the card Description into one system message, so an extension cannot remove or replace it in the prompt. When Evolutia is turned on for a card, the Description is replaced by the `{{evolutia}}` macro and the Original Description is kept on the card (and imported into Fields by heading). The Fields therefore land exactly where the user's preset puts the Description, per card, without touching the preset. Turning Evolutia off restores the Original Description.

## Consequences

A card exported to another app while Evolutia is on shows `{{evolutia}}` as its Description unless that app has Evolutia.

## Considered Options

- **A separate prompt block alongside the Description**: the Description would still be sent, duplicating or contradicting the Fields.
- **Disabling the Description in the preset**: affects every card.
