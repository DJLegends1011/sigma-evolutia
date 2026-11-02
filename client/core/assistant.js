// Pure helpers for exposing Evolutia definitions/state to Project Σ's Chat Assistant & Creator Studio,
// and applying `cl-evolutia-edits` proposals back to a Character or Persona definition.
import { blankField, blankAlterEgo, idFor, definitionFromDescription } from './definition.js';

const toList = (v) => {
    if (Array.isArray(v)) return v.map(x => String(x ?? '').trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map(x => x.trim()).filter(Boolean);
    return [];
};

// Formats a complete, readable Evolutia blueprint for the Assistant or Creator Studio reference block.
export function formatEvolutiaBlueprint(def, timeline, side = 'char', ownerName = '') {
    if (!def?.alterEgos?.length) return '';
    const now = timeline?.at(-1) || null;
    const activeEgoId = now?.ego || def.alterEgos[0].id;
    const activeEgo = def.alterEgos.find(e => e.id === activeEgoId) || def.alterEgos[0];
    const headerLabel = side === 'persona'
        ? `PERSONA EVOLUTIA (${ownerName || 'User'})`
        : `CHARACTER EVOLUTIA (${ownerName || 'Character'})`;

    const lines = [
        `=== ${headerLabel} ===`,
        `Active Alter Ego: ${activeEgo.name}${activeEgo.disguise ? ' [DISGUISE MODE]' : ''}${activeEgo.promptName ? ` (Prompt Name: "${activeEgo.promptName}")` : ''}`,
    ];

    for (let idx = 0; idx < def.alterEgos.length; idx++) {
        const ego = def.alterEgos[idx];
        const isCurrent = ego.id === activeEgo.id;
        const egoTag = idx === 0 ? 'Base / Default' : (ego.disguise ? 'Disguise Alter Ego' : 'Alter Ego');
        const readsOf = (sources) => {
            const list = [sources?.user !== false && 'user', sources?.char !== false && 'char'].filter(Boolean);
            return list.length === 2 ? '' : ` (reads: ${list.join(', ') || 'nothing'})`;
        };
        const entryKw = ego.entry?.keywords?.length ? ` | Entry Triggers: [${ego.entry.keywords.join(', ')}]` : '';
        const entryReads = ego.entry?.keywords?.length ? readsOf(ego.entrySources) : '';
        const entryConfirm = ego.entryConfirm?.keywords?.length ? ` | Entry confirmed by: [${ego.entryConfirm.keywords.join(', ')}]` : '';
        const exitConfirm = ego.exitConfirm?.keywords?.length ? ` | Exit confirmed by: [${ego.exitConfirm.keywords.join(', ')}]` : '';
        const entryAct = ego.entryAction ? ` | Entry Action: "${ego.entryAction}"` : '';
        lines.push(`\n### Alter Ego: ${ego.name} (${egoTag}${isCurrent ? ', ACTIVE IN SCENE' : ''})${entryKw}${entryReads}${entryConfirm}${exitConfirm}${entryAct}`);

        for (const f of ego.fields || []) {
            const phase = now?.fields?.[ego.id]?.[f.id]?.phase ?? (f.startsOn ? 'on' : 'off');
            const meta = [`state=${phase.toUpperCase()}`, `startsOn=${!!f.startsOn}`];
            if (f.activating?.keywords?.length) meta.push(`activating=[${f.activating.keywords.join(', ')}]`);
            if (f.enabling?.keywords?.length) meta.push(`enabling=[${f.enabling.keywords.join(', ')}]`);
            if (f.disabling?.keywords?.length) meta.push(`disabling=[${f.disabling.keywords.join(', ')}]`);
            const fReads = readsOf(f.sources);
            if (fReads) meta.push(`reads=${fReads.slice(9, -1)}`);
            if (f.entryConfirm?.keywords?.length) meta.push(`entryConfirm=[${f.entryConfirm.keywords.join(', ')}]`);
            if (f.exitConfirm?.keywords?.length) meta.push(`exitConfirm=[${f.exitConfirm.keywords.join(', ')}]`);
            if (f.entryAction) meta.push(`entryAction="${f.entryAction}"`);
            if (f.exitAction) meta.push(`exitAction="${f.exitAction}"`);
            lines.push(`## ${f.name} (${meta.join(', ')})\n${f.content || '(empty)'}`);
        }
    }
    return lines.join('\n');
}

export const EVOLUTIA_ASSISTANT_DIRECTIVE = `

CHANGING EVOLUTIA (DYNAMIC FIELDS & ALTER EGOS)

When the reader asks you to create, update, split, or distill Evolutia Alter Egos, Fields, Keyword Triggers, or Entry/Exit Actions (for either the character or the reader's persona), include a fenced \`cl-evolutia-edits\` JSON block at the end of your reply. Each item in the JSON array is one operation:

\`\`\`cl-evolutia-edits
[
  {
    "op": "upsert-ego",
    "side": "char",
    "name": "Alter Ego Name",
    "promptName": "Optional in-scene name",
    "disguise": false,
    "entry": ["keyword 1", "keyword 2"],
    "entrySources": ["user"],
    "entryConfirm": ["Alter Ego Name"],
    "entryAction": "Optional narrator instruction when switching into this Alter Ego",
    "exitConfirm": ["revert"],
    "stripTriggers": false,
    "fields": [
      {
        "name": "Background",
        "startsOn": true,
        "content": "Field prose...",
        "sources": ["user", "char"],
        "activating": [],
        "enabling": [],
        "disabling": [],
        "entryAction": "",
        "exitAction": ""
      },
      {
        "name": "Intimate",
        "startsOn": true,
        "content": "Only in the prompt while an activating keyword matches the Window...",
        "activating": ["kiss", "undress", "bed"],
        "enabling": [],
        "disabling": [],
        "entryAction": "",
        "exitAction": ""
      }
    ]
  },
  {
    "op": "upsert-field",
    "side": "char",
    "ego": "main",
    "name": "Secrets",
    "startsOn": false,
    "sources": ["user"],
    "activating": [],
    "enabling": ["what's wrong", "are you okay"],
    "disabling": [],
    "stripTriggers": false,
    "entryAction": "{{char}} hesitates before revealing the truth.",
    "exitAction": "",
    "content": "Hidden lore or dynamic state..."
  }
]
\`\`\`

- \`side\` is \`"char"\` (the character card) or \`"persona"\` (the reader's persona).
- \`op\` may be \`"upsert-ego"\` (creates or updates an Alter Ego and its fields), \`"upsert-field"\` (creates or updates one Field on \`"main"\` or a named Alter Ego), \`"delete-field"\` (removes a Field by \`name\` on \`ego\`), or \`"switch"\` (\`{"op":"switch","side":"char","ego":"Alter Ego Name"}\` or \`{"op":"switch","side":"char","ego":"main","field":"Secrets","on":true}\`).
- Trigger types (each accepts an array of keywords/regexes, or \`{"mode": "ANY" | "ALL", "keywords": [...], "sources": [...]}\`):
  - \`activating\` (Field): in the prompt only while it matches the Window (use with \`startsOn: true\` for context-sensitive fields like Intimate or combat stats).
  - \`enabling\` (Field): switches on and stays on.
  - \`disabling\` (Field): switches off and stays off.
  - \`entry\` (Alter Ego): makes an Alter Ego active. It may also be an object \`{"keywords": [...], "mode": "ANY" | "ALL", "confirm": [...], "sources": [...]}\`.
- \`sources\` (Field) and \`entrySources\` (Alter Ego) say which messages the triggers read: \`["user"]\` (the reader's messages), \`["char"]\` (the replies), or \`["user", "char"]\` (the default, both). On a Field, \`sources\` may sit on the op or inside one trigger object (\`activating\`, \`enabling\`, \`disabling\`); a trigger object's own \`sources\` wins. On an Alter Ego, \`entry\`'s own \`sources\` wins over \`entrySources\`. Morph-style forms usually want \`"entrySources": ["user"]\` so only the reader's words summon them.
- \`entryConfirm\` / \`exitConfirm\` (Alter Ego, arrays of keywords; or \`confirm\` inside \`entry\`) are Confirm Keywords: the Entry or Exit Action only counts as done once a reply contains one of them. A morph disguise usually sets \`"entryConfirm"\` to the form's own name.
- \`stripTriggers\` (boolean, on \`upsert-ego\` or \`upsert-field\`) removes matched trigger keywords from the stored-free prompt and bubble without touching the message row.
- Nothing is written until the reader clicks **Apply to Evolutia** on the review card.`;

function toTrigger(raw, modeProp) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const m = String(raw.mode ?? modeProp ?? 'ANY').toUpperCase() === 'ALL' ? 'ALL' : 'ANY';
        return { mode: m, keywords: toList(raw.keywords ?? raw.list ?? []) };
    }
    const m = String(modeProp ?? 'ANY').toUpperCase() === 'ALL' ? 'ALL' : 'ANY';
    return { mode: m, keywords: toList(raw) };
}

// `["user"]`, `["user", "char"]` (or an object of flags) to the sources map the definition keeps; null when it names none.
function parseSources(raw) {
    if (Array.isArray(raw)) {
        const names = raw.map(x => String(x ?? '').trim().toLowerCase()).filter(x => x === 'user' || x === 'char');
        if (!names.length) return null;
        return { user: names.includes('user'), char: names.includes('char') };
    }
    if (raw && typeof raw === 'object' && ('user' in raw || 'char' in raw)) {
        return { user: raw.user !== false, char: raw.char !== false };
    }
    return null;
}

// A trigger bucket off an op: its own object's keywords/mode/sources, an op-level `sources`, else the
// Field's existing trigger kept as it was (`fallback`).
function parseTriggerBucket(raw, fallback, opSources, modeProp) {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    const trigger = raw === undefined && fallback !== undefined ? fallback : toTrigger(raw, obj ? (obj.mode ?? modeProp) : modeProp);
    const sources = (obj && parseSources(obj.sources)) || parseSources(opSources);
    return { trigger, ...(sources ? { sources } : {}) };
}

function patchFieldFromOp(target, spec, opSources) {
    if (typeof spec.name === 'string' && spec.name.trim()) target.name = spec.name.trim();
    if (typeof spec.content === 'string') target.content = spec.content;
    if (typeof spec.startsOn === 'boolean') target.startsOn = spec.startsOn;
    if (typeof spec.withAction === 'boolean') target.withAction = spec.withAction;
    if (typeof spec.stripTriggers === 'boolean') target.stripTriggers = spec.stripTriggers;
    // which messages the triggers read: a trigger bucket's own `sources`, the op's, or the Field's own kept as it was
    let bucketedSources = false;
    for (const key of ['activating', 'enabling', 'disabling']) {
        if (spec[key] === undefined) continue;
        const parsed = parseTriggerBucket(spec[key], target[key], spec.sources ?? opSources, spec[`${key}Mode`]);
        target[key] = parsed.trigger;
        if (parsed.sources) { target.sources = parsed.sources; bucketedSources = true; }
    }
    if (!bucketedSources) {
        const sources = parseSources(spec.sources) || parseSources(opSources);
        if (sources) target.sources = sources;
    }
    if (typeof spec.entryAction === 'string') target.entryAction = spec.entryAction;
    if (typeof spec.exitAction === 'string') target.exitAction = spec.exitAction;
    if (spec.entryConfirm !== undefined) target.entryConfirm = toTrigger(spec.entryConfirm);
    if (spec.exitConfirm !== undefined) target.exitConfirm = toTrigger(spec.exitConfirm);
    return target;
}

    function findEgo(def, key) {
        if (!key || key === 'main' || key === 'default') return def.alterEgos[0];
        const norm = String(key).trim().toLowerCase();
        return def.alterEgos.find(e => (e.id || '').toLowerCase() === norm || (e.name || '').trim().toLowerCase() === norm) || null;
    }

// Pure application of cl-evolutia-edits operations for one side ('char' or 'persona').
export function applyEvolutiaOps(existingDef, fallbackDescription, ops, targetSide = 'char') {
    const relevant = (Array.isArray(ops) ? ops : []).filter(o => o && (o.side || 'char') === targetSide);
    if (!relevant.length) return { changed: false, definition: existingDef, summary: [], switches: [] };

    const def = existingDef?.alterEgos?.length
        ? structuredClone(existingDef)
        : definitionFromDescription(fallbackDescription || '');

    const summary = [];
    const switches = [];

    for (const op of relevant) {
        const kind = String(op.op || '').trim();
        if (kind === 'upsert-ego') {
            const egoName = String(op.name || '').trim() || 'New Alter Ego';
            let ego = findEgo(def, op.id || egoName);
            const isNew = !ego;
            if (!ego) {
                const takenEgos = new Set(def.alterEgos.map(e => e.id));
                ego = blankAlterEgo(idFor(egoName, takenEgos), egoName, []);
                def.alterEgos.push(ego);
            } else if (op.name) {
                ego.name = egoName;
            }
            if (typeof op.displayName === 'string') ego.displayName = op.displayName;
            else if (isNew && !ego.displayName) ego.displayName = egoName;
            if (typeof op.promptName === 'string') ego.promptName = op.promptName;
            if (typeof op.disguise === 'boolean') ego.disguise = op.disguise;
            if (typeof op.withAction === 'boolean') ego.withAction = op.withAction;
            if (typeof op.stripTriggers === 'boolean') ego.stripTriggers = op.stripTriggers;
            let entryObj = null;
            if (op.entry !== undefined || op.activating !== undefined) {
                const rawEntry = op.entry !== undefined ? op.entry : op.activating;
                entryObj = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) ? rawEntry : null;
                ego.entry = toTrigger(rawEntry, op.entryMode ?? op.activatingMode);
            }
            // Confirm keywords for the Entry Action: `entryConfirm`, or `confirm` inside the `entry` object
            const rawEntryConfirm = op.entryConfirm !== undefined ? op.entryConfirm : entryObj?.confirm;
            if (rawEntryConfirm !== undefined) ego.entryConfirm = toTrigger(rawEntryConfirm);
            // which messages the Entry Trigger reads: `entrySources`, or `sources` inside the `entry` object
            const rawEntrySources = op.entrySources !== undefined ? op.entrySources : entryObj?.sources;
            if (rawEntrySources !== undefined) {
                const sources = parseSources(rawEntrySources);
                if (sources) ego.entrySources = sources;
            }
            if (typeof op.entryAction === 'string') ego.entryAction = op.entryAction;
            if (typeof op.exitAction === 'string') ego.exitAction = op.exitAction;
            if (op.exitConfirm !== undefined) ego.exitConfirm = toTrigger(op.exitConfirm);

            if (Array.isArray(op.fields)) {
                for (const fSpec of op.fields) {
                    if (!fSpec || typeof fSpec !== 'object') continue;
                    const fName = String(fSpec.name || '').trim() || 'Field';
                    let field = ego.fields.find(f => (f.name || '').trim().toLowerCase() === fName.toLowerCase());
                    if (!field) {
                        const takenFields = new Set(ego.fields.map(f => f.id));
                        field = blankField(idFor(fName, takenFields), fName, '');
                        ego.fields.push(field);
                    }
                    patchFieldFromOp(field, fSpec, op.sources);
                }
            }
            if (!ego.fields.length) {
                ego.fields.push(blankField('overview', 'Overview', ''));
            }
            summary.push(`${isNew ? 'Created' : 'Updated'} Alter Ego "${ego.name}" (${targetSide})`);
        } else if (kind === 'upsert-field') {
            let ego = findEgo(def, op.ego);
            if (!ego) {
                const egoName = String(op.ego || 'New Alter Ego').trim();
                const takenEgos = new Set(def.alterEgos.map(e => e.id));
                ego = blankAlterEgo(idFor(egoName, takenEgos), egoName, []);
                def.alterEgos.push(ego);
            }
            const fName = String(op.name || '').trim() || 'Field';
            let field = ego.fields.find(f => f.id === op.id || (f.name || '').trim().toLowerCase() === fName.toLowerCase());
            const isNew = !field;
            if (!field) {
                const takenFields = new Set(ego.fields.map(f => f.id));
                field = blankField(idFor(fName, takenFields), fName, '');
                ego.fields.push(field);
            }
            patchFieldFromOp(field, op);
            summary.push(`${isNew ? 'Added' : 'Updated'} Field "${field.name}" on "${ego.name}" (${targetSide})`);
        } else if (kind === 'delete-field') {
            const ego = findEgo(def, op.ego);
            if (ego && ego.fields.length > 1) {
                const norm = String(op.name || op.id || '').trim().toLowerCase();
                const idx = ego.fields.findIndex(f => f.id.toLowerCase() === norm || (f.name || '').trim().toLowerCase() === norm);
                if (idx !== -1) {
                    const [removed] = ego.fields.splice(idx, 1);
                    summary.push(`Deleted Field "${removed.name}" from "${ego.name}" (${targetSide})`);
                }
            }
        } else if (kind === 'switch') {
            const ego = findEgo(def, op.ego || op.name);
            if (ego && op.field) {
                const norm = String(op.field).trim().toLowerCase();
                const field = ego.fields.find(f => f.id.toLowerCase() === norm || (f.name || '').trim().toLowerCase() === norm);
                if (field) {
                    switches.push({
                        kind: 'field',
                        ego: ego.id,
                        id: field.id,
                        on: op.on !== undefined ? !!op.on : op.phase !== 'off',
                        skip: op.skip !== false,
                        ...(targetSide === 'persona' ? { side: 'persona' } : {}),
                    });
                    summary.push(`Switched Field "${field.name}" ${op.on === false || op.phase === 'off' ? 'OFF' : 'ON'} (${targetSide})`);
                }
            } else if (ego) {
                switches.push({
                    kind: 'ego',
                    id: ego.id,
                    skip: op.skip !== false,
                    ...(targetSide === 'persona' ? { side: 'persona' } : {}),
                });
                summary.push(`Switched active Alter Ego to "${ego.name}" (${targetSide})`);
            }
        }
    }

    return {
        changed: summary.length > 0,
        definition: def,
        summary,
        switches,
    };
}

export const EVOLUTIA_ASSISTANT_PROMPTS = [
    {
        id: 'evo-distill-ego',
        icon: '🧬',
        label: 'Distill Alter Ego',
        text: 'Distill a portable Evolutia Alter Ego from this scene or character, with modular Fields like Background, Personality, Appearance, Outfit, and Intimate, and propose it as a `cl-evolutia-edits` block. Use `"entry"` (not `"activating"`) for the Alter Ego\'s Entry Triggers, with `"entrySources": ["user"]` so only the reader\'s words summon it, and `"entryConfirm"` set to the form\'s own name. Give any Intimate Field an `"activating"` trigger (e.g. `["kiss", "undress", "bed"]`) so its tokens are only spent when the scene calls for it. For a morph form, add a True Self Field with the fixed wording `FORM is really <name>, a metamorph disguised as FORM. No one else knows.` — replacing FORM with the form\'s name and <name> with the character\'s (or the persona\'s) real name, never writing the {{user}} macro twice.',
    },
    {
        id: 'evo-seed-distill-ego-dshad',
        icon: '🧬',
        label: 'Distill Alter Ego (DShad Template)',
        text: 'Distill an Evolutia Alter Ego from this scene or character following the DShad template below exactly — one Field per `##` block, omitting lines that do not apply, keeping the bracketed `Key: [ value; ]` list form — and propose it as a `cl-evolutia-edits` block.\n\n## Identity\nName: [ ; ] · Nicknames: [ ; ] · Titles: [ ; ] · Occupation: [ ; ] · Species: [ ; ] · Type: [ ; ] · Sex: [ ; ] · Gender: [ ; ] · Age: [ ; ] · Height: [ ; ]\n\n## Appearance\nAppearance: [ ; ] · Clothing & Accessories: [ ; ]\n\n## Personality\nTemperament: [ ; ] · Personality: [ ; ] · Quirks: [ ; ] · Speech: [ ; ] · Likes: [ ; ] · Dislikes: [ ; ]\n\n## Life (a morph form can skip this Field so the persona\'s own life carries through)\nRelationships: [ ; ] · Lives: [ ; ] · Daily Life: [ ; ] · Backstory: [ ; ] · Goals: [ ; ]\n\n## Abilities\nSkill 1: [ ; ] · Ability 1: [ ; ] · Vulnerabilities & weaknesses: [ ; ]\n\n## Intimate\nPenis: [ ; ] · Sheath: [ ; ] · Balls: [ ; ] · Vagina: [ ; ] · Anus: [ ; ] · Teats: [ ; ] · Trait or kink: [ ; ]\n\n## True Self (morph forms only)\nFORM is really <name>, a metamorph disguised as FORM. No one else knows.\n\nEvolutia settings for a morph form: Entry Trigger with `"entry"` (reads the user\'s messages: `"entrySources": ["user"]`), Entry Action `Narrate {{user}} morphing into FORM: body, voice and outfit entirely hers.`, `"entryConfirm"` set to FORM\'s name, `"promptName"` set to FORM\'s name, `"disguise": true`, and the change showing in the reply that narrates it. Give the Intimate Field an `"activating"` trigger (e.g. `["kiss", "undress", "bed"]`) so it is only in the prompt when the scene calls for it. In True Self, replace FORM with the form\'s name and <name> with the real name, never writing the {{user}} macro twice.',
    },
    {
        id: 'evo-distill-lore',
        icon: '📚',
        label: 'Distill to Lorebook',
        text: 'Distill the key characters, locations, or ongoing story facts from this conversation into compact, portable Lorebook entries using a `cl-lore-edits` block.',
    },
    {
        id: 'evo-suggest-triggers',
        icon: '⚡',
        label: 'Suggest Triggers & Fields',
        text: 'Review {{char}}\'s and {{user}}\'s Evolutia definitions and propose a `cl-evolutia-edits` block that splits long fields or adds dynamic Fields, keyword triggers, and Entry/Exit Actions for this story.',
    },
];

export const EVOLUTIA_CREATOR_PROMPTS = [
    {
        id: 'evo-creator-split',
        icon: '🧬',
        label: 'Split into Evolutia Fields',
        text: 'Organize {{char}}\'s card description into modular Evolutia Fields (such as Background, Personality, Appearance, Relationships, and any gated Secrets with enabling keywords and entry actions) and propose them in a `cl-evolutia-edits` block.',
    },
];
