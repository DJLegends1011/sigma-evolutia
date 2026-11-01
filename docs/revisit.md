# To revisit

Decisions taken provisionally during design (2026-11-01), to be checked once there is something to play with.

- **Settings placement (Q24):** global defaults in Settings → Extensions → Evolutia, overridable per card in the card's Evolutia tab. Judge after UX testing whether the split feels natural or whether overrides should live elsewhere.
- **Prompt Name (Q23):** a single "currently going by" line in `{{evolutia}}`. If models keep using the card name, look at overriding `{{char}}` per chat.
- **Action placement (Q22):** Entry/Exit Actions as a depth-0 block with an editable template. Check compliance in play; tune the default template.
- **Licence (Q25):** get Genisai's written OK and agree a licence before any public release.
- **Persona side (Q4):** deferred from the first release until the character side was proven; it was proven on 2026-11-01 (Vannessa's first chat). Sigma's personas have no field for extension data, so persona Fields need Evolutia's own table keyed by persona id; designed on 2026-11-01 (Q33 to Q39, ADR 0006).
- **Group chats (when Sigma has them):** Sigma's author plans a group entity whose participants are cards (2026-11-01). Each participant would get its own Character Side over the same messages (ADR 0004 holds), but Trigger Sources must tell participants apart (today every non-user message counts as "the character's") and Actions must name whose reply they are asked of. Vocalia, the other inherited extension, waits on the same feature.
