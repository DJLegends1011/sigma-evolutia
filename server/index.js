// Evolutia, the server half: Field Definitions on the card (and, for the Persona Side, in Evolutia's own table),
// {{evolutia}} and {{evolutia_persona}} in place of the descriptions, and Field State worked out from the chat's
// messages each time a prompt is built (ADR 0004).
import { deriveTimeline, promptFor, identityFor } from '../client/core/evolve.js';
import { switchPatch, definitionFromDescription } from '../client/core/definition.js';
const CARDS = 'x_evolutia_cards';
const PERSONAS = 'x_evolutia_personas';
const PERSONA_MACRO = '{{evolutia_persona}}';

// append-only; which cards have Evolutia on, so list rows can carry it (the card badge)
export const migrations = [
    `CREATE TABLE ${CARDS} (
        char_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;`,
    // the Persona Side (ADR 0006): personas carry no extension data, so it all lives here
    `CREATE TABLE ${PERSONAS} (
        persona_id TEXT PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0,
        original TEXT,
        definition TEXT CHECK (definition IS NULL OR json_valid(definition))) WITHOUT ROWID;`,
];

export function register(router, ctx) {
    const chars = ctx.stores.characters;
    ctx.query.projection({ key: 'on', table: CARDS, column: 'enabled' });
    const evolutiaOf = (db, charId) => chars.getCharacter(db, charId)?.card.data.extensions?.evolutia || null;

    // the definition's own settings (Q24), else the account's
    const options = (db, name, definition) => {
        const own = definition?.settings || {};
        const pick = (key) => (own[key] ?? '') !== '' ? own[key] : ctx.setting(db, key);
        return { charName: name, window: Number(pick('window')) || 1, tries: Number(pick('tries')) || 2, template: String(pick('template')) };
    };

    // ---- the Persona Side's row
    const personaRow = (db, personaId) => {
        const r = personaId && db.prepare(`SELECT enabled, original, definition FROM ${PERSONAS} WHERE persona_id = ?`).get(personaId);
        return r ? { on: !!r.enabled, original: r.original, definition: r.definition ? JSON.parse(r.definition) : null } : { on: false, original: null, definition: null };
    };
    const writePersonaRow = (db, personaId, row) => {
        db.prepare(`INSERT INTO ${PERSONAS} (persona_id, enabled, original, definition) VALUES (?, ?, ?, ?)
            ON CONFLICT(persona_id) DO UPDATE SET enabled = excluded.enabled, original = excluded.original, definition = excluded.definition`)
            .run(personaId, row.on ? 1 : 0, row.original ?? null, row.definition ? JSON.stringify(row.definition) : null);
        ctx.report(db, { entity: 'persona', op: 'updated', ids: [personaId], fields: ['evolutia'] });
    };
    // the persona a chat speaks as: its own, else the account's active one
    const chatPersona = (db, chatId) => ctx.stores.personas.resolvePersona(db, chatId)?.persona || null;

    // The chat's messages up to lastSeq, as the core reads them.
    function history(db, chatId, lastSeq) {
        const chat = ctx.prompt.read(db, chatId);
        if (!chat) return null;
        const kept = chat.history.filter(h => lastSeq == null || h.seq <= lastSeq);
        const messages = kept.map(h => ({
            role: h.msg.is_user ? 'user' : 'char',
            text: ctx.messages.shown(h.msg),
            manual: h.msg.extra?.evolutia?.manual || [],
        }));
        return { messages, seqs: kept.map(h => h.seq), charName: chat.charName, userName: chat.userName, expand: chat.expand };
    }

    // One side's run over the history: the character's (a card's definition) or the user's (a persona's), each
    // with its own Manual Switches.
    function run(db, h, definition, side) {
        const opts = options(db, side === 'persona' ? h.userName : h.charName, definition);
        const messages = h.messages.map(m => ({ ...m, manual: m.manual.filter(sw => (sw.side || 'char') === side) }));
        const timeline = deriveTimeline(definition, messages, opts);
        const said = promptFor(definition, messages, timeline, messages.length - 1, opts);
        return { opts, messages, timeline, said };
    }

    // The definitions in play for a chat: the card's and the chat's persona's, each only while switched on.
    function sides(db, chatId, charId) {
        const ev = charId ? evolutiaOf(db, charId) : null;
        const persona = chatPersona(db, chatId);
        const pr = personaRow(db, persona?.id);
        return {
            char: ev?.on && ev.definition ? ev.definition : null,
            persona: pr.on && pr.definition ? { ...persona, definition: pr.definition } : null,
        };
    }

    // What {{evolutia}}, {{evolutia_persona}} and the Action block say for the reply after lastSeq.
    function promptNow(db, chatId, charId, lastSeq) {
        const s = sides(db, chatId, charId);
        if (!s.char && !s.persona) return null;
        const h = history(db, chatId, lastSeq);
        if (!h) return null;
        const c = s.char && run(db, h, s.char, 'char').said;
        const p = s.persona && run(db, h, s.persona.definition, 'persona').said;
        // a macro's answer is not expanded again, so Fields and Actions get the chat's macros ({{user}}, ...) here
        return {
            evolutia: c ? h.expand(c.evolutia) : '',
            persona: p ? h.expand(p.evolutia) : '',
            actionBlock: h.expand([c?.actionBlock, p?.actionBlock].filter(Boolean).join('\n')),
        };
    }

    ctx.macros.add('evolutia', ({ db, chatId, charId, lastSeq }) => promptNow(db, chatId, charId, lastSeq)?.evolutia ?? '');
    ctx.macros.add('evolutia_persona', ({ db, chatId, charId, lastSeq }) => promptNow(db, chatId, charId, lastSeq)?.persona ?? '');

    // Entry and Exit Actions sit next to the reply, where a model is least likely to miss them.
    ctx.prompt.addBlock({
        id: 'actions',
        position: 'at_depth',
        depth: 0,
        role: 'system',
        text: ({ db, chatId, charId, lastSeq }) => promptNow(db, chatId, charId, lastSeq)?.actionBlock ?? '',
    });

    // ---- the Persona Side's routes

    router.get('/personas/:id', (req, res) => {
        const persona = ctx.stores.personas.getPersona(req.db, req.params.id);
        if (!persona) return res.status(404).json({ error: 'no such persona' });
        const row = personaRow(req.db, persona.id);
        return res.json({ ...row, description: persona.description ?? '' });
    });

    router.put('/personas/:id/definition', (req, res) => {
        const definition = req.body?.definition;
        if (!definition || !Array.isArray(definition.alterEgos) || !definition.alterEgos.length) {
            return res.status(400).json({ error: 'a definition needs at least one Alter Ego' });
        }
        if (!ctx.stores.personas.getPersona(req.db, req.params.id)) return res.status(404).json({ error: 'no such persona' });
        writePersonaRow(req.db, req.params.id, { ...personaRow(req.db, req.params.id), definition });
        return res.json({ ok: true });
    });

    // On: the persona's description becomes {{evolutia_persona}}, kept aside (with a first set of Fields read from it
    // when it has none). Off: it comes back. As a card's (ADR 0003), in Evolutia's own row (ADR 0006).
    router.put('/personas/:id/on', (req, res) => {
        const db = req.db;
        const persona = ctx.stores.personas.getPersona(db, req.params.id);
        if (!persona) return res.status(404).json({ error: 'no such persona' });
        const on = !!req.body?.on;
        const row = personaRow(db, persona.id);
        if (on === row.on) return res.json({ on });
        db.transaction(() => {
            if (on) {
                const original = persona.description ?? '';
                const definition = req.body?.definition || row.definition || definitionFromDescription(original);
                writePersonaRow(db, persona.id, { on: true, original, definition });
                ctx.stores.personas.updatePersona(db, persona.id, { description: PERSONA_MACRO });
            } else {
                ctx.stores.personas.updatePersona(db, persona.id, { description: row.original ?? '' });
                writePersonaRow(db, persona.id, { ...row, on: false, original: null });
            }
        })();
        return res.json({ on });
    });

    router.get('/characters/:id', (req, res) => {
        const c = chars.getCharacter(req.db, req.params.id);
        if (!c) return res.status(404).json({ error: 'no such character' });
        const ev = c.card.data.extensions?.evolutia || {};
        return res.json({ on: !!ev.on, definition: ev.definition || null, card: { description: c.card.data.description ?? '', extensions: { evolutia: ev } } });
    });

    router.put('/characters/:id/definition', (req, res) => {
        const definition = req.body?.definition;
        if (!definition || !Array.isArray(definition.alterEgos) || !definition.alterEgos.length) {
            return res.status(400).json({ error: 'a definition needs at least one Alter Ego' });
        }
        if (!chars.patchCharacter(req.db, req.params.id, { fields: { 'extensions.evolutia.definition': definition } })) {
            return res.status(404).json({ error: 'no such character' });
        }
        return res.json({ ok: true });
    });

    // What the chat window and the Display Identity read: each side's state after the newest message, and whose
    // Alter Ego wrote each message (the character's replies, the user's messages).
    router.get('/chats/:chatId/state', ctx.requireChat, (req, res) => {
        const db = req.db, chatId = req.params.chatId;
        const s = sides(db, chatId, req.query.charId ? String(req.query.charId) : null);
        const h = history(db, chatId, null);
        const view = (definition, side) => {
            const { opts, messages, timeline, said } = run(db, h, definition, side);
            const now = timeline.at(-1);
            const inPrompt = new Map(said.rows.map(r => [`${r.ego}/${r.id}`, r.inPrompt]));
            const writer = side === 'persona' ? 'user' : 'char';
            const identities = {};
            messages.forEach((m, i) => { if (m.role === writer) identities[h.seqs[i]] = identityFor(definition, timeline, i, opts); });
            const egoView = (e) => ({ id: e.id, name: e.name });
            return {
                ego: egoView(definition.alterEgos.find(e => e.id === now.ego)),
                egoMove: now.egoMove ? egoView(definition.alterEgos.find(e => e.id === now.egoMove.to)) : null,
                egos: definition.alterEgos.map(e => ({
                    ...egoView(e),
                    fields: e.fields.map(f => ({ id: f.id, name: f.name, phase: now.fields[e.id][f.id].phase, inPrompt: !!inPrompt.get(`${e.id}/${f.id}`) })),
                })),
                evolutia: h.expand(said.evolutia),
                actionBlock: h.expand(said.actionBlock),
                identities,
            };
        };
        return res.json({
            on: !!s.char,
            ...(s.char ? view(s.char, 'char') : {}),
            persona: s.persona ? { id: s.persona.id, name: s.persona.name, ...view(s.persona.definition, 'persona') } : null,
        });
    });

    // A Manual Switch rides on the newest message (ADR 0004): deleting that message takes it back.
    router.post('/chats/:chatId/switch', ctx.requireChat, (req, res) => {
        const { kind, ego, id, on, skip, side } = req.body || {};
        const sw = kind === 'ego'
            ? { kind, id: String(id ?? ''), skip: !!skip }
            : { kind: 'field', ego: String(ego ?? ''), id: String(id ?? ''), on: !!on, skip: !!skip };
        if (side === 'persona') sw.side = 'persona';
        if (!sw.id || (sw.kind === 'field' && !sw.ego)) return res.status(400).json({ error: 'a switch names a Field (ego and id) or an Alter Ego (id)' });
        const newest = ctx.prompt.read(req.db, req.params.chatId)?.history.at(-1);
        if (!newest) return res.status(409).json({ error: 'a Manual Switch attaches to the newest message; the chat has none' });
        const manual = [...(newest.msg.extra?.evolutia?.manual || []), sw];
        ctx.stores.chats.patchChatMessage(req.db, req.params.chatId, newest.seq, { extra: { evolutia: { manual } } }, { messageId: newest.id });
        return res.json({ seq: newest.seq, manual });
    });

    // On: the Description becomes {{evolutia}}, the Original Description kept. Off: it comes back.
    // (The Evolutia tab makes the same write through the app's own character.update.)
    router.put('/characters/:id/on', (req, res) => {
        const c = chars.getCharacter(req.db, req.params.id);
        if (!c) return res.status(404).json({ error: 'no such character' });
        const on = !!req.body?.on;
        const fields = switchPatch(c.card.data, on);
        if (fields) chars.patchCharacter(req.db, req.params.id, { fields });
        return res.json({ on });
    });

    // The badge's table follows every write to a card, whoever made it.
    ctx.events.on((records, { db }) => {
        const ids = new Set(records.filter(r => r.entity === 'character' && (r.op === 'created' || r.op === 'updated') && !r.extension)
            .flatMap(r => r.ids || []).map(String));
        if (!ids.size) return;
        const changed = [];
        const read = db.prepare(`SELECT enabled FROM ${CARDS} WHERE char_id = ?`);
        const write = db.prepare(`INSERT INTO ${CARDS} (char_id, enabled) VALUES (?, ?) ON CONFLICT(char_id) DO UPDATE SET enabled = excluded.enabled`);
        db.transaction(() => {
            for (const id of ids) {
                const c = chars.getCharacter(db, id);
                if (!c) continue;
                const on = c.card.data.extensions?.evolutia?.on ? 1 : 0;
                if ((read.get(id)?.enabled ?? 0) === on) continue;
                write.run(id, on);
                changed.push(id);
            }
            if (changed.length) ctx.report(db, { entity: 'character', op: 'updated', ids: changed, fields: ['evolutia.on'] });
        })();
    });
}
