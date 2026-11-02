// Evolutia, the server half: Field Definitions on the card (and, for the Persona Side, in Evolutia's own table),
// {{evolutia}} and {{evolutia_persona}} in place of the descriptions, Field State worked out from the chat's
// messages each time a prompt is built (ADR 0004), non-destructive pipeline trigger stripping, and Assistant /
// Creator Studio integration (`cl-evolutia-edits`).
import { deriveTimeline, promptFor, identityFor, badgeFor, stripTriggeredMessage } from '../client/core/evolve.js';
import { switchPatch, definitionFromDescription } from '../client/core/definition.js';
import {
    formatEvolutiaBlueprint,
    EVOLUTIA_ASSISTANT_DIRECTIVE,
    applyEvolutiaOps,
    EVOLUTIA_ASSISTANT_PROMPTS,
    EVOLUTIA_CREATOR_PROMPTS,
} from '../client/core/assistant.js';

const CARDS = 'x_evolutia_cards';
const PERSONAS = 'x_evolutia_personas';
const PERSONA_MACRO = '{{evolutia_persona}}';

const BUILTIN_ASSISTANT_STARTERS = [
    { id: 'cas-starter-sum', icon: '📜', label: 'Summarise', text: 'Summarise what has happened in this story so far, in the order it happened.' },
    { id: 'cas-starter-crit', icon: '🔎', label: 'Critique', text: "Critique {{char}}'s last reply as a writing partner: what works, what falls flat, what you would change." },
    { id: 'cas-starter-dir', icon: '🧭', label: 'Directions', text: 'Suggest three directions this scene could go next, each in a sentence, without writing any of it.' },
];

const BUILTIN_CREATOR_STARTERS = [
    { id: 'ccs-starter-draft', icon: '📝', label: 'Draft the card', text: 'Draft every field that is still empty from what we have discussed, as one batch of changes I can review.' },
    { id: 'ccs-starter-tags', icon: '🏷️', label: 'Suggest tags', text: 'Suggest ten to fifteen tags for {{char}} as a tags change: lowercase, specific, none of the ones already set.' },
    { id: 'ccs-starter-greet', icon: '👋', label: 'Three greetings', text: 'Write three alternate greetings for {{char}} as greeting changes, each opening the story from a different situation.' },
];

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
    // timestamp for LAN Sync's Prefer-newer rule when a persona's Evolutia definition is edited independently of the persona row
    `ALTER TABLE ${PERSONAS} ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;`,
];

export function register(router, ctx) {
    const chars = ctx.stores.characters;
    ctx.query.projection({ key: 'on', table: CARDS, column: 'enabled' });
    const evolutiaOf = (db, charId) => chars.getCharacter(db, charId)?.card.data.extensions?.evolutia || null;
    const initializedDbs = new WeakSet();

    // Rebuild x_evolutia_cards from characters and ensure enabled x_evolutia_personas rows have {{evolutia_persona}}
    // in place of the persona's description (at server start and after LAN Sync).
    function rebuildCardsTable(db) {
        if (!db) return;
        try {
            const rows = db.prepare('SELECT id, card FROM characters').all();
            const read = db.prepare(`SELECT enabled FROM ${CARDS} WHERE char_id = ?`);
            const write = db.prepare(`INSERT INTO ${CARDS} (char_id, enabled) VALUES (?, ?) ON CONFLICT(char_id) DO UPDATE SET enabled = excluded.enabled`);
            const changed = [];
            db.transaction(() => {
                db.prepare(`DELETE FROM ${CARDS} WHERE char_id NOT IN (SELECT id FROM characters)`).run();
                for (const r of rows) {
                    let on = 0;
                    try { on = JSON.parse(r.card)?.data?.extensions?.evolutia?.on ? 1 : 0; } catch { on = 0; }
                    if ((read.get(r.id)?.enabled ?? -1) === on) continue;
                    write.run(r.id, on);
                    changed.push(r.id);
                }
                if (changed.length) ctx.report(db, { entity: 'character', op: 'updated', ids: changed, fields: ['evolutia.on'] });

                const pRows = db.prepare(`SELECT persona_id, enabled, original FROM ${PERSONAS} WHERE enabled = 1`).all();
                for (const pr of pRows) {
                    const p = ctx.stores.personas.getPersona(db, pr.persona_id);
                    if (!p || p.description === PERSONA_MACRO) continue;
                    if (pr.original == null && p.description) {
                        db.prepare(`UPDATE ${PERSONAS} SET original = ? WHERE persona_id = ?`).run(p.description, pr.persona_id);
                    }
                    ctx.stores.personas.updatePersona(db, pr.persona_id, { description: PERSONA_MACRO });
                }
            })();
        } catch { /* ignore if table not ready yet */ }
    }

    function ensureDbInitialized(db) {
        if (!db || initializedDbs.has(db)) return;
        initializedDbs.add(db);
        rebuildCardsTable(db);
    }

    router.use((req, _res, next) => {
        ensureDbInitialized(req.db);
        next();
    });

    // the definition's own settings (Q24), else the account's
    const options = (db, name, definition) => {
        const own = definition?.settings || {};
        const pick = (key) => (own[key] ?? '') !== '' ? own[key] : ctx.setting(db, key);
        return { charName: name, window: Number(pick('window')) || 1, tries: Number(pick('tries')) || 2, template: String(pick('template')) };
    };

    // ---- the Persona Side's row
    const personaRow = (db, personaId) => {
        const r = personaId && db.prepare(`SELECT enabled, original, definition, updated_at FROM ${PERSONAS} WHERE persona_id = ?`).get(personaId);
        return r
            ? { on: !!r.enabled, original: r.original, definition: r.definition ? JSON.parse(r.definition) : null, updatedAt: r.updated_at ?? 0 }
            : { on: false, original: null, definition: null, updatedAt: 0 };
    };
    // a report belongs inside its write's transaction (a nested one joins the caller's)
    const writePersonaRow = (db, personaId, row) => db.transaction(() => {
        const updatedAt = Date.now();
        db.prepare(`INSERT INTO ${PERSONAS} (persona_id, enabled, original, definition, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(persona_id) DO UPDATE SET enabled = excluded.enabled, original = excluded.original, definition = excluded.definition, updated_at = excluded.updated_at`)
            .run(personaId, row.on ? 1 : 0, row.original ?? null, row.definition ? JSON.stringify(row.definition) : null, updatedAt);
        ctx.report(db, { entity: 'persona', op: 'updated', ids: [personaId], fields: ['evolutia'] });
    })();
    // the persona a chat speaks as: its own, else the account's active one
    const chatPersona = (db, chatId) => ctx.stores.personas.resolvePersona(db, chatId)?.persona || null;

    // Non-destructively seed Evolutia's Saved Prompts into `assistant-prompts` and `creator-studio-prompts` once per user.
    // Keeps the marker in Evolutia's own per-user file folder (`ctx.files.user(req)`) so when Sigma's `ai-panel.js`
    // re-saves `{ version, prompts }`, the marker is never lost and deleted prompts never come back.
    function ensureSavedPrompts(req, { force = false } = {}) {
        try {
            const db = req.db;
            const userFiles = ctx.files.user(req);
            const marker = userFiles.readJson('seeded-prompts.json', null);
            if (marker?.seeded && !force) return false;

            const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_store'").get();
            if (!hasTable) return false;
            const mergeDoc = (key, builtinStarters, evoPrompts) => {
                const row = db.prepare('SELECT value FROM app_store WHERE key = ?').get(key);
                let parsed = null;
                if (row?.value) {
                    try { parsed = JSON.parse(row.value); } catch { parsed = null; }
                }
                const list = Array.isArray(parsed?.prompts)
                    ? [...parsed.prompts]
                    : [...builtinStarters];
                for (const ep of evoPrompts) {
                    if (!list.some(x => x.id === ep.id || x.label === ep.label)) {
                        list.push({ ...ep });
                    }
                }
                db.prepare(`INSERT INTO app_store (key, value, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
                    .run(key, JSON.stringify({ version: parsed?.version || 1, prompts: list }), Date.now());
                return true;
            };
            mergeDoc('assistant-prompts', BUILTIN_ASSISTANT_STARTERS, EVOLUTIA_ASSISTANT_PROMPTS);
            mergeDoc('creator-studio-prompts', BUILTIN_CREATOR_STARTERS, EVOLUTIA_CREATOR_PROMPTS);
            userFiles.writeJson('seeded-prompts.json', { seeded: true, at: Date.now() });
            return true;
        } catch {
            return false;
        }
    }

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
        const resolvedCharId = charId || (chatId ? db.prepare('SELECT char_id FROM chats WHERE id = ?').get(chatId)?.char_id : null);
        const ev = resolvedCharId ? evolutiaOf(db, resolvedCharId) : null;
        const persona = chatPersona(db, chatId);
        const pr = personaRow(db, persona?.id);
        return {
            charId: resolvedCharId || null,
            personaMeta: persona ? { id: persona.id, name: persona.name, on: pr.on } : null,
            char: ev?.on && ev.definition ? ev.definition : null,
            persona: pr.on && pr.definition ? { ...persona, definition: pr.definition } : null,
        };
    }

    // Non-destructive trigger stripping across the timeline: computes { [seq]: strippedText } and a text->stripped
    // map without ever mutating `chat_messages` in SQLite (preserving ADR 0004 timeline derivation and Sigma's
    // read-only guard contract).
    function computeStrippedMessages(db, s, h) {
        if (!h || (!s.char && !s.persona)) return { bySeq: {}, byText: new Map() };
        const cRun = s.char ? run(db, h, s.char, 'char') : null;
        const pRun = s.persona ? run(db, h, s.persona.definition, 'persona') : null;
        const bySeq = {};
        const byText = new Map();
        h.messages.forEach((m, i) => {
            if (!m.text) return;
            let text = m.text;
            if (cRun) {
                text = stripTriggeredMessage(s.char, cRun.timeline[i], m.role, text, 'char').text;
            }
            if (pRun) {
                text = stripTriggeredMessage(s.persona.definition, pRun.timeline[i], m.role, text, 'persona').text;
            }
            if (text !== m.text) {
                bySeq[h.seqs[i]] = text;
                byText.set(m.text, text);
            }
        });
        return { bySeq, byText, cRun, pRun };
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

    // Pipeline filter for non-destructive `stripTriggers`: strips matched trigger keywords from prompt messages
    // (including the Prompt Inspector) while leaving the stored SQLite rows untouched.
    ctx.hooks.add('prompt.final', (messages, { db, chatId, charId }) => {
        if (!Array.isArray(messages) || !chatId) return messages;
        const s = sides(db, chatId, charId);
        if (!s.char && !s.persona) return messages;
        const h = history(db, chatId, null);
        const { byText } = computeStrippedMessages(db, s, h);
        if (!byText.size) return messages;
        return messages.map(m => {
            if (!m || typeof m.content !== 'string') return m;
            const exact = byText.get(m.content);
            if (exact !== undefined) return { ...m, content: exact };
            for (const [orig, cleaned] of byText.entries()) {
                if (m.content.endsWith(`: ${orig}`) || m.content.endsWith(`\n${orig}`)) {
                    return { ...m, content: m.content.slice(0, m.content.length - orig.length) + cleaned };
                }
            }
            return m;
        });
    });

    // Assistant & Creator Studio context expansion + `cl-evolutia-edits` directive (Tiers 1 & 3, strictly read-only)
    ctx.hooks.add('llm.request', (req, info) => {
        const db = info?.db;
        const purpose = info?.purpose;
        if (!db || !Array.isArray(req?.messages) || req.messages.length < 2) return req;

        if (purpose === 'assistant') {
            const refText = String(req.messages[1]?.content || '');
            const charMatch = refText.match(/CHARACTER:\s*([^\n]+)/);
            const refCharName = charMatch ? charMatch[1].trim() : null;
            let chatId = info?.chatId || null;
            if (!chatId) {
                try {
                    const sessions = db.prepare(`
                        SELECT a.chat_id, c.char_id
                        FROM assistant_sessions a
                        JOIN chats c ON c.id = a.chat_id
                        ORDER BY a.updated_at DESC LIMIT 10
                    `).all();
                    if (refCharName) {
                        const matched = sessions.find(row => chars.getCharacter(db, row.char_id)?.card?.data?.name === refCharName);
                        chatId = matched?.chat_id || sessions[0]?.chat_id || null;
                    } else {
                        chatId = sessions[0]?.chat_id || null;
                    }
                } catch { chatId = null; }
            }
            if (!chatId) return req;

            const s = sides(db, chatId, null);
            const h = history(db, chatId, null);
            const { cRun, pRun } = computeStrippedMessages(db, s, h);
            const messages = req.messages.map(m => ({ ...m }));

            // 1. Expand {{evolutia}} and append full Character & Persona Evolutia blueprints inside messages[1]
            if (typeof messages[1]?.content === 'string') {
                let ref = messages[1].content;
                if (s.char && h) {
                    const expandedChar = h.expand(cRun.said.evolutia || '');
                    const charBlueprint = h.expand(formatEvolutiaBlueprint(s.char, cRun.timeline, 'char', h.charName));
                    const replacement = [expandedChar, charBlueprint].filter(Boolean).join('\n\n');
                    if (ref.includes('{{evolutia}}')) {
                        ref = ref.replace(/\{\{evolutia\}\}/g, replacement);
                    } else if (replacement) {
                        ref = `${ref}\n\n${replacement}`;
                    }
                }
                if (s.persona && h) {
                    const personaBlueprint = h.expand(formatEvolutiaBlueprint(s.persona.definition, pRun.timeline, 'persona', s.persona.name));
                    if (ref.includes('{{evolutia_persona}}')) {
                        ref = ref.replace(/\{\{evolutia_persona\}\}/g, personaBlueprint);
                    } else if (personaBlueprint) {
                        ref = `${ref}\n\n${personaBlueprint}`;
                    }
                }
                messages[1].content = ref;
            }

            // 2. Append cast disguise/alter-ego note + `cl-evolutia-edits` directive to messages[0]
            if (typeof messages[0]?.content === 'string') {
                let sys = messages[0].content;
                if (s.persona && pRun) {
                    const activePersonaEgo = s.persona.definition.alterEgos.find(e => e.id === pRun.timeline.at(-1)?.ego);
                    if (activePersonaEgo && (activePersonaEgo.disguise || activePersonaEgo.id !== s.persona.definition.alterEgos[0]?.id)) {
                        const asName = activePersonaEgo.promptName || activePersonaEgo.displayName || activePersonaEgo.name;
                        sys += `\n\nEVOLUTIA SCENE NOTE: In the current scene, "${s.persona.name}" is active in the Evolutia Alter Ego "${asName}"${activePersonaEgo.disguise ? ' (Disguise mode: in-scene characters perceive them as ' + asName + ')' : ''}.`;
                    }
                }
                if (!sys.includes('cl-evolutia-edits')) {
                    sys += EVOLUTIA_ASSISTANT_DIRECTIVE;
                }
                messages[0].content = sys;
            }

            return { ...req, messages };
        }

        if (purpose === 'creator') {
            const refText = String(req.messages[1]?.content || '');
            const nameMatch = refText.match(/Name \[name\]:\n([^\n]+)/);
            const refCharName = nameMatch ? nameMatch[1].trim() : null;
            let charId = info?.charId || null;
            if (!charId) {
                try {
                    const sessions = db.prepare('SELECT char_id FROM studio_sessions WHERE char_id IS NOT NULL ORDER BY updated_at DESC LIMIT 10').all();
                    if (refCharName) {
                        const matched = sessions.find(row => chars.getCharacter(db, row.char_id)?.card?.data?.name === refCharName);
                        charId = matched?.char_id || sessions[0]?.char_id || null;
                    } else {
                        charId = sessions[0]?.char_id || null;
                    }
                } catch { charId = null; }
            }
            const ev = charId ? evolutiaOf(db, charId) : null;
            const c = charId ? chars.getCharacter(db, charId) : null;
            const charName = c?.card?.data?.name || 'Character';
            const messages = req.messages.map(m => ({ ...m }));

            if (typeof messages[1]?.content === 'string' && ev?.definition) {
                const blueprint = formatEvolutiaBlueprint(ev.definition, null, 'char', charName);
                messages[1].content = messages[1].content.replace(/\{\{evolutia\}\}/g, blueprint);
            }
            if (typeof messages[0]?.content === 'string' && !messages[0].content.includes('cl-evolutia-edits')) {
                messages[0].content += EVOLUTIA_ASSISTANT_DIRECTIVE;
            }
            return { ...req, messages };
        }

        return req;
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

    // What the chat window and the Display Identity read: each side's state after the newest message, whose
    // Alter Ego wrote each message, and any non-destructively stripped message texts (`stripped`).
    router.get('/chats/:chatId/state', ctx.requireChat, (req, res) => {
        const db = req.db, chatId = req.params.chatId;
        const s = sides(db, chatId, req.query.charId ? String(req.query.charId) : null);
        const h = history(db, chatId, null);
        const { bySeq: stripped } = computeStrippedMessages(db, s, h);
        const view = (definition, side) => {
            const { opts, messages, timeline, said } = run(db, h, definition, side);
            const now = timeline.at(-1);
            const inPrompt = new Map(said.rows.map(r => [`${r.ego}/${r.id}`, r.inPrompt]));
            const writer = side === 'persona' ? 'user' : 'char';
            const identities = {};
            const badges = {};
            messages.forEach((m, i) => {
                if (m.role !== writer) return;
                identities[h.seqs[i]] = identityFor(definition, timeline, i, opts);
                const b = badgeFor(definition, timeline, i);
                if (b) badges[h.seqs[i]] = b;
            });
            const egoView = (e) => ({ id: e.id, name: e.name, avatar: e.avatar || null, disguise: !!e.disguise });
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
                badges,
            };
        };
        return res.json({
            on: !!s.char,
            charId: s.charId,
            personaMeta: s.personaMeta,
            stripped,
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

    // Apply `cl-evolutia-edits` proposals from the Chat Assistant or Creator Studio
    router.post('/assistant-apply', (req, res) => {
        const db = req.db;
        const { chatId = null, charId = null, personaId = null, ops = [] } = req.body || {};
        if (!Array.isArray(ops) || !ops.length) {
            return res.status(400).json({ error: 'ops array is required' });
        }

        const resolvedCharId = charId
            || (chatId ? db.prepare('SELECT char_id FROM chats WHERE id = ?').get(chatId)?.char_id : null)
            || (() => {
                try { return db.prepare('SELECT char_id FROM studio_sessions ORDER BY updated_at DESC LIMIT 1').get()?.char_id || null; }
                catch { return null; }
            })();
        const resolvedPersona = personaId
            ? ctx.stores.personas.getPersona(db, personaId)
            : chatPersona(db, chatId);

        const appliedSummary = [];
        const allSwitches = [];

        db.transaction(() => {
            if (resolvedCharId) {
                const c = chars.getCharacter(db, resolvedCharId);
                if (c) {
                    const ev = c.card.data.extensions?.evolutia || {};
                    const fallbackDesc = ev.originalDescription ?? (c.card.data.description === '{{evolutia}}' ? '' : (c.card.data.description ?? ''));
                    const charRes = applyEvolutiaOps(ev.definition, fallbackDesc, ops, 'char');
                    if (charRes.changed) {
                        const patchFields = { 'extensions.evolutia.definition': charRes.definition };
                        if (!ev.on) {
                            const onPatch = switchPatch({
                                description: c.card.data.description ?? '',
                                extensions: { evolutia: { ...ev, definition: charRes.definition } },
                            }, true);
                            if (onPatch) Object.assign(patchFields, onPatch);
                        }
                        chars.patchCharacter(db, resolvedCharId, { fields: patchFields });
                        appliedSummary.push(...charRes.summary);
                        allSwitches.push(...charRes.switches);
                    }
                }
            }

            if (resolvedPersona) {
                const pRow = personaRow(db, resolvedPersona.id);
                const fallbackDesc = pRow.original ?? (resolvedPersona.description === PERSONA_MACRO ? '' : (resolvedPersona.description ?? ''));
                const pRes = applyEvolutiaOps(pRow.definition, fallbackDesc, ops, 'persona');
                if (pRes.changed) {
                    if (!pRow.on) {
                        const original = resolvedPersona.description === PERSONA_MACRO ? (pRow.original ?? '') : (resolvedPersona.description ?? '');
                        writePersonaRow(db, resolvedPersona.id, { on: true, original, definition: pRes.definition });
                        ctx.stores.personas.updatePersona(db, resolvedPersona.id, { description: PERSONA_MACRO });
                    } else {
                        writePersonaRow(db, resolvedPersona.id, { ...pRow, definition: pRes.definition });
                    }
                    appliedSummary.push(...pRes.summary);
                    allSwitches.push(...pRes.switches);
                }
            }

            if (chatId && allSwitches.length) {
                const newest = ctx.prompt.read(db, chatId)?.history.at(-1);
                if (newest) {
                    const manual = [...(newest.msg.extra?.evolutia?.manual || []), ...allSwitches];
                    ctx.stores.chats.patchChatMessage(db, chatId, newest.seq, { extra: { evolutia: { manual } } }, { messageId: newest.id });
                }
            }
        })();

        if (!appliedSummary.length) {
            return res.status(400).json({ error: 'No matching Character or Persona found for these operations' });
        }
        return res.json({ ok: true, summary: appliedSummary, charId: resolvedCharId, personaId: resolvedPersona?.id || null });
    });

    router.post('/seed-prompts', (req, res) => {
        const seeded = ensureSavedPrompts(req, { force: !!req.body?.force });
        res.json({ ok: true, seeded });
    });

    router.post('/rebuild-cards', (req, res) => {
        rebuildCardsTable(req.db);
        res.json({ ok: true });
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

    // Direct avatar upload & serving for Persona / Custom Alter Ego portraits
    router.post('/avatars', (req, res) => {
        try {
            const { filename = 'avatar.png', dataUrl = '' } = req.body || {};
            const match = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
            if (!match) return res.status(400).json({ error: 'Invalid image dataUrl' });
            const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
            const safeBase = String(filename).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'ego';
            const storedName = `${safeBase}-${Date.now()}.${ext}`;
            const buf = Buffer.from(match[2], 'base64');
            ctx.files.user(req).write(storedName, buf);
            res.json({
                ok: true,
                file: storedName,
                avatar: { upload: storedName },
                url: `/api/ext/evolutia/avatars/${encodeURIComponent(storedName)}`,
            });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    router.get('/avatars/:file', (req, res) => {
        try {
            const file = String(req.params.file || '').replace(/[^a-zA-Z0-9._-]/g, '');
            const fullPath = ctx.files.user(req).path(file);
            res.sendFile(fullPath);
        } catch {
            res.status(404).end();
        }
    });

    // The badge's table follows every write to a card (and full-library resyncs), whoever made it.
    ctx.events.on((records, { db }) => {
        ensureDbInitialized(db);
        if (records.some(r => r.entity === 'library')) {
            rebuildCardsTable(db);
            return;
        }
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
