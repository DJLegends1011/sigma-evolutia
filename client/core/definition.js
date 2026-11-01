// Field Definitions: blank ones, and a first set read from a Description. Pure; shared by server and client
// (under client/, the only folder Sigma serves the page; the server imports it from here).

const trigger = () => ({ keywords: [], mode: 'ANY' });

export function blankField(id, name, content = '') {
    return {
        id, name, content, startsOn: true,
        activating: trigger(), enabling: trigger(), disabling: trigger(),
        sources: { user: true, char: true },
        entryAction: null, exitAction: null, entryConfirm: null, exitConfirm: null,
    };
}

export function blankAlterEgo(id, name, fields = []) {
    return {
        id, name, fields,
        entry: trigger(), entrySources: { user: true, char: true },
        entryAction: null, exitAction: null, entryConfirm: null, exitConfirm: null,
        promptName: null, displayName: null, avatar: null,
    };
}

// An id from a name, unique among those taken.
export function idFor(name, taken) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
}

// One Field per Markdown heading; if the text has no Markdown headings, looks for labeled sections
// (Background:, Personality:, Appearance:, Outfit:, etc.) or falls back to one Description Field.
export function definitionFromDescription(description) {
    const text = String(description ?? '');
    const sections = [];
    let current = { name: 'Overview', lines: [] };
    for (const line of text.split('\n')) {
        const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
        if (heading) { sections.push(current); current = { name: heading[1], lines: [] }; }
        else current.lines.push(line);
    }
    sections.push(current);

    if (sections.length === 1 && text.trim()) {
        const sectionRegex = /^(?:\*{1,2})?(Background|Backstory|History|Bio|Identity|Personality|Traits|Behavior|Appearance|Body|Looks|Physical|Outfit|Attire|Clothing|Costume|Powers|Abilities|Relationships|Secrets|Intimate)(?:\*{1,2})?\s*(?:[:\-—]|\()/gim;
        const matches = [...text.matchAll(sectionRegex)];
        if (matches.length >= 2) {
            const labeled = [];
            const pre = text.slice(0, matches[0].index).trim();
            if (pre) labeled.push({ name: 'Background', content: pre });
            for (let i = 0; i < matches.length; i++) {
                const rawLabel = matches[i][1];
                const isParen = matches[i][0].endsWith('(');
                const start = isParen ? matches[i].index : (matches[i].index + matches[i][0].length);
                const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
                const chunk = text.slice(start, end).trim();
                if (!chunk) continue;
                const lower = rawLabel.toLowerCase();
                const normName = ['background', 'backstory', 'history', 'bio', 'identity'].includes(lower) ? 'Background'
                    : ['personality', 'traits', 'behavior'].includes(lower) ? 'Personality'
                    : ['appearance', 'body', 'looks', 'physical', 'outfit', 'attire', 'clothing'].includes(lower) ? 'Appearance'
                    : rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
                const existing = labeled.find(s => s.name === normName);
                if (existing) existing.content = `${existing.content}\n\n${chunk}`;
                else labeled.push({ name: normName, content: chunk });
            }
            if (labeled.length >= 2) {
                const taken = new Set();
                const fields = labeled.map(s => blankField(idFor(s.name, taken), s.name, s.content));
                return { alterEgos: [blankAlterEgo('main', 'Main', fields)] };
            }
        }
    }

    const taken = new Set();
    const fields = sections
        .map(s => ({ name: s.name, content: s.lines.join('\n').trim() }))
        .filter(s => s.content)
        .map(s => blankField(idFor(s.name, taken), sections.length === 1 ? 'Description' : s.name, s.content));
    return { alterEgos: [blankAlterEgo('main', 'Main', fields)] };
}

// The first Alter Ego's Fields read again from a Description's headings (Q32). A new Field whose name matches
// an old one (ignoring case) keeps everything of the old but its name and content; other Alter Egos stay.
export function rebuildFromDescription(definition, description) {
    const next = structuredClone(definition);
    const old = new Map(next.alterEgos[0].fields.map(f => [f.name.toLowerCase(), f]));
    const imported = definitionFromDescription(description).alterEgos[0].fields;
    // each old Field to the first heading of its name; their ids taken first: Manual Switches in chats name them
    const kept = imported.map(f => {
        const k = old.get(f.name.toLowerCase());
        if (k) old.delete(f.name.toLowerCase());
        return k || null;
    });
    const taken = new Set(kept.filter(Boolean).map(k => k.id));
    next.alterEgos[0].fields = imported.map((f, i) => (kept[i] ? { ...kept[i], name: f.name, content: f.content } : { ...f, id: idFor(f.id, taken) }));
    return next;
}

export const MACRO = '{{evolutia}}';

// The card write that switches Evolutia on or off (ADR 0003), as Sigma's character.update takes it: on, the
// Description becomes {{evolutia}} and the Original Description is kept (with a first set of Fields read from
// it when the card has none); off, the Original Description comes back. Null when there is nothing to change.
export function switchPatch(cardData, on) {
    const ev = cardData.extensions?.evolutia || {};
    if (on === !!ev.on) return null;
    if (!on) return { description: ev.originalDescription ?? '', 'extensions.evolutia.on': false, 'extensions.evolutia.originalDescription': null };
    const description = cardData.description ?? '';
    return {
        description: MACRO,
        'extensions.evolutia.on': true,
        'extensions.evolutia.originalDescription': description,
        ...(ev.definition ? {} : { 'extensions.evolutia.definition': definitionFromDescription(description) }),
    };
}
