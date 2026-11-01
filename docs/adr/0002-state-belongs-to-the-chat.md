# Field State belongs to the chat, not the card

The original stored whether each Field was on, and the progress of Trigger Actions, on the character card, so a transformation in one chat leaked into every other chat with that card. Here the card holds only Field Definitions; Field State and the active Alter Ego belong to the chat, worked out from its messages (ADR 0004), so a Branch inherits exactly the state as of its branch point. (Sigma copies chat metadata wholesale into branches, including entries after the branch point, which is why state is not kept there as one flat object.)
