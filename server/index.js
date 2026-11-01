// Evolutia, the server half: Field Definitions on the card, {{evolutia}} in place of the Description,
// and Field State worked out from the chat's messages each time a prompt is built (ADR 0004).
import { deriveTimeline, promptFor, identityFor } from '../client/core/evolve.js';
import { switchPatch } from '../client/core/definition.js';
const CARDS = 'x_evolutia_cards';

// append-only; which cards have Evolutia on, so list rows can carry it (the card badge)
export const migrations = [
    `CREATE TABLE ${CARDS} (
        char_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;`,
];

export function register(router, ctx) {
    const chars = ctx.stores.characters;
    ctx.query.projection({ key: 'on', table: CARDS, column: 'enabled' });
    const evolutiaOf = (db, charId) => chars.getCharacter(db, charId)?.card.data.extensions?.evolutia || null;

    // the card's own settings (Q24), else the account's
    const options = (db, charName, ev) => {
        const own = ev.definition?.settings || {};
        const pick = (key) => (own[key] ?? '') !== '' ? own[key] : ctx.setting(db, key);
        return { charName, window: Number(pick('window')) || 1, tries: Number(pick('tries')) || 2, template: String(pick('template')) };
    };

    // The chat's messages up to lastSeq, as the core reads them.
    function history(db, chatId, lastSeq) {
        const chat = ctx.prompt.read(db, chatId);
        if (!chat) return null;
        const messages = chat.history
            .filter(h => lastSeq == null || h.seq <= lastSeq)
            .map(h => ({
                role: h.msg.is_user ? 'user' : 'char',
                text: ctx.messages.shown(h.msg),
                manual: h.msg.extra?.evolutia?.manual || [],
            }));
        return { messages, charName: chat.charName, expand: chat.expand };
    }

    // What {{evolutia}} and the Action block say for the reply after lastSeq; null when the card has Evolutia off.
    function promptNow(db, chatId, charId, lastSeq) {
        const ev = charId && evolutiaOf(db, charId);
        if (!ev?.on || !ev.definition) return null;
        const h = history(db, chatId, lastSeq);
        if (!h) return null;
        const opts = options(db, h.charName, ev);
        const timeline = deriveTimeline(ev.definition, h.messages, opts);
        const said = promptFor(ev.definition, h.messages, timeline, h.messages.length - 1, opts);
        // a macro's answer is not expanded again, so Fields and Actions get the chat's macros ({{user}}, ...) here
        return { evolutia: h.expand(said.evolutia), actionBlock: h.expand(said.actionBlock) };
    }

    ctx.macros.add('evolutia', ({ db, chatId, charId, lastSeq }) => promptNow(db, chatId, charId, lastSeq)?.evolutia ?? '');

    // Entry and Exit Actions sit next to the reply, where a model is least likely to miss them.
    ctx.prompt.addBlock({
        id: 'actions',
        position: 'at_depth',
        depth: 0,
        role: 'system',
        text: ({ db, chatId, charId, lastSeq }) => promptNow(db, chatId, charId, lastSeq)?.actionBlock ?? '',
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

    // What the chat window and the Display Identity read: the state after the newest message, and who wrote each reply.
    router.get('/chats/:chatId/state', ctx.requireChat, (req, res) => {
        const db = req.db, chatId = req.params.chatId;
        const ev = req.query.charId ? evolutiaOf(db, String(req.query.charId)) : null;
        if (!ev?.on || !ev.definition) return res.json({ on: false });
        const chat = ctx.prompt.read(db, chatId);
        const h = history(db, chatId, null);
        const opts = options(db, h.charName, ev);
        const timeline = deriveTimeline(ev.definition, h.messages, opts);
        const now = timeline.at(-1);
        const said = promptFor(ev.definition, h.messages, timeline, h.messages.length - 1, opts);
        const inPrompt = new Map(said.rows.map(r => [r.id, r.inPrompt]));
        const identities = {};
        h.messages.forEach((m, i) => { if (m.role === 'char') identities[chat.history[i].seq] = identityFor(ev.definition, timeline, i, opts); });
        const egoView = (e) => ({ id: e.id, name: e.name });
        return res.json({
            on: true,
            ego: egoView(ev.definition.alterEgos.find(e => e.id === now.ego)),
            egoMove: now.egoMove ? egoView(ev.definition.alterEgos.find(e => e.id === now.egoMove.to)) : null,
            egos: ev.definition.alterEgos.map(e => ({
                ...egoView(e),
                fields: e.fields.map(f => ({ id: f.id, name: f.name, phase: now.fields[e.id][f.id].phase, inPrompt: e.id === now.ego && !!inPrompt.get(f.id) })),
            })),
            evolutia: h.expand(said.evolutia),
            actionBlock: h.expand(said.actionBlock),
            identities,
        });
    });

    // A Manual Switch rides on the newest message (ADR 0004): deleting that message takes it back.
    router.post('/chats/:chatId/switch', ctx.requireChat, (req, res) => {
        const { kind, ego, id, on, skip } = req.body || {};
        const sw = kind === 'ego'
            ? { kind, id: String(id ?? ''), skip: !!skip }
            : { kind: 'field', ego: String(ego ?? ''), id: String(id ?? ''), on: !!on, skip: !!skip };
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
