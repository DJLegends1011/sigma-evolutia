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

// One Field per Markdown heading; text before the first heading is the Overview, a Description with no
// headings one Field. Every Field starts on, so the prompt reads as it did before.
export function definitionFromDescription(description) {
    const sections = [];
    let current = { name: 'Overview', lines: [] };
    for (const line of String(description ?? '').split('\n')) {
        const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
        if (heading) { sections.push(current); current = { name: heading[1], lines: [] }; }
        else current.lines.push(line);
    }
    sections.push(current);
    const taken = new Set();
    const fields = sections
        .map(s => ({ name: s.name, content: s.lines.join('\n').trim() }))
        .filter(s => s.content)
        .map(s => blankField(idFor(s.name, taken), sections.length === 1 ? 'Description' : s.name, s.content));
    return { alterEgos: [blankAlterEgo('main', 'Main', fields)] };
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
