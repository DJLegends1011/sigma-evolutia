# Evolutia makes no LLM calls of its own

The original author abandoned Aspect: Evolutia after v1.4.0 added a pre-reply "Turn Director" JSON planner and required the roleplay model to append a machine-readable `[turn_control]` block, both of which failed on real models ("model compliance issues"). v1.3.1, which made no LLM calls and decided everything with deterministic keyword matching, worked. The reimagining therefore decides Triggers deterministically and never asks a model to emit machine output; the only model-facing text is the Fields themselves and Trigger Action instructions, which are plain prose.

## Considered Options

- **Optional Judge call** (a cheap connection decides descriptive Triggers like "when Kael is angry"): deferred, not rejected. If added, a failed or malformed judgement must mean "no change", never a blocked or rolled-back turn.
