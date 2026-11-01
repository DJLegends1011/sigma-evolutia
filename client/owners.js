// Whose Field Definitions the editor edits: a character card's, or a persona's (the Persona Side, ADR 0006).
// Everything the editor needs to know about where the definition lives, how Evolutia is switched on and where an
// Alter Ego's avatar comes from is here; the editor itself does not care which it has.
import { switchPatch } from './core/definition.js';

const enc = encodeURIComponent;

// A character card: Fields on the card, written through the app's own character.update (the details then know
// the write for their own); the Description becomes {{evolutia}} (ADR 0003).
export function cardOwner(character, ctx) {
    const { CoreAPI } = ctx;
    const call = ctx.server.call;
    let card = null;

    const update = async (fields) => {
        const done = await ctx.commands.run('character.update', { id: character.id, fields, source: 'evolutia' });
        if (done?.ok === false) throw new Error('the card write was refused');
    };

    // The details paint the Description, and the Edit form takes it, only when the card opens; re-opening
    // rebuilds every tab (a flash), so the two are brought up to the new Description in place instead. No door
    // for either: absent markup is skipped, and a Description box with the reader's own typing is left alone.
    function showDescription(was, now) {
        const shown = document.getElementById('modalDescription');
        if (shown) shown.innerHTML = CoreAPI.safePurify(CoreAPI.formatRichText(now, character.name));
        const box = document.getElementById('editDescription');
        if (box && box.value !== now) {
            if (box.value === was) box.value = now;
            else CoreAPI.showToast('The Edit tab holds your unsaved Description: re-open the card before saving it', 'warning');
        }
    }

    return {
        noun: 'card',
        name: character.name,
        // the other side's messages, as the Reads checkboxes name them
        otherSide: `${character.name}'s messages`,
        macro: '{{evolutia}}',
        descLabel: 'Description',

        async load() {
            const got = await call(`/characters/${enc(character.id)}`);
            card = got.card;
            const ev = card.extensions?.evolutia || {};
            return { on: got.on, definition: got.definition, description: card.description, source: (got.on ? ev.originalDescription : card.description) ?? '' };
        },
        saveDefinition: (definition) => update({ 'extensions.evolutia.definition': definition }),
        // switch on or off; rebuilt, when given, replaces the Fields as it does
        async setOn(want, definition, rebuilt) {
            let fields = switchPatch({ ...card, extensions: { evolutia: { ...card.extensions?.evolutia, definition } } }, want);
            if (!fields) return;
            if (rebuilt) fields = { ...fields, 'extensions.evolutia.definition': rebuilt };
            await update(fields);
            showDescription(card.description, fields.description);
        },

        avatar: {
            ownLabel: "Card's own",
            thumb: (a) => (a?.media ? CoreAPI.thumbUrl('media', a.media, 96) : null),
            emptyHint: "This card's gallery has no pictures yet.",
            async choices() {
                const res = await CoreAPI.apiRequest(`/characters/${enc(character.id)}/media?limit=100&count=false`);
                const page = await res.json();
                return (page.items || []).filter(m => m.kind !== 'video')
                    .map(m => ({ avatar: { media: m.id }, thumb: CoreAPI.thumbUrl('media', m.id, 96), label: m.displayName }));
            },
            async upload(file) {
                const res = await CoreAPI.apiRequest(`/characters/${enc(character.id)}/media?name=${enc(file.name)}`, 'POST', file,
                    { raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
                const body = await res.json();
                if (!res.ok) throw new Error(body.error || res.status);
                return { media: body.duplicateOf ?? body.id };
            },
        },
    };
}

// A persona: Fields and the Original Description in Evolutia's own table; the description becomes
// {{evolutia_persona}} (ADR 0006). An Alter Ego's avatar is one of the account's persona pictures.
export function personaOwner(persona, ctx) {
    const { CoreAPI } = ctx;
    const call = ctx.server.call;

    return {
        noun: 'persona',
        name: persona.name,
        otherSide: "the character's messages",
        macro: '{{evolutia_persona}}',
        descLabel: 'description',

        async load() {
            const got = await call(`/personas/${enc(persona.id)}`);
            return { on: got.on, definition: got.definition, description: got.description, source: (got.on ? got.original : got.description) ?? '' };
        },
        saveDefinition: (definition) => call(`/personas/${enc(persona.id)}/definition`, 'PUT', { definition }),
        setOn: (want, definition, rebuilt) => call(`/personas/${enc(persona.id)}/on`, 'PUT', { on: want, ...(want && (rebuilt || definition) ? { definition: rebuilt || definition } : {}) }),

        avatar: {
            ownLabel: "Persona's own",
            thumb: (a) => (a?.persona ? CoreAPI.thumbUrl('persona', a.persona, 96) : null),
            emptyHint: 'None of your personas has a picture yet.',
            async choices() {
                const res = await CoreAPI.apiRequest('/personas');
                const { personas = [] } = await res.json();
                return personas.filter(p => p.avatar)
                    .map(p => ({ avatar: { persona: p.id }, thumb: CoreAPI.thumbUrl('persona', p.id, 96), label: p.name }));
            },
            upload: null,
        },
    };
}
