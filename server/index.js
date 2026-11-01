// Evolutia, the server half: Field Definitions on the card, {{evolutia}} in place of the Description,
// and Field State worked out from the chat's messages each time a prompt is built (ADR 0004).
import { deriveTimeline, promptFor } from '../core/evolve.js';
import { definitionFromDescription } from '../core/definition.js';

const MACRO = '{{evolutia}}';

export function register(router, ctx) {
    const chars = ctx.stores.characters;
    const evolutiaOf = (db, charId) => chars.getCharacter(db, charId)?.card.data.extensions?.evolutia || null;

    const options = (db, charName) => ({
        charName,
        window: Number(ctx.setting(db, 'window')) || 1,
        tries: Number(ctx.setting(db, 'tries')) || 2,
        template: ctx.setting(db, 'template'),
    });

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
        const opts = options(db, h.charName);
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
    router.put('/characters/:id/on', (req, res) => {
        const c = chars.getCharacter(req.db, req.params.id);
        if (!c) return res.status(404).json({ error: 'no such character' });
        const ev = c.card.data.extensions?.evolutia || {};
        const on = !!req.body?.on;
        if (on === !!ev.on) return res.json({ on });
        const description = c.card.data.description ?? '';
        const fields = on
            ? {
                description: MACRO, 'extensions.evolutia.on': true, 'extensions.evolutia.originalDescription': description,
                ...(ev.definition ? {} : { 'extensions.evolutia.definition': definitionFromDescription(description) }),
            }
            : { description: ev.originalDescription ?? '', 'extensions.evolutia.on': false, 'extensions.evolutia.originalDescription': null };
        chars.patchCharacter(req.db, req.params.id, { fields });
        return res.json({ on });
    });
}
