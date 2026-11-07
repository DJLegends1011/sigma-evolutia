// Seam B: Evolutia in a real Sigma server, observed through the prompt a chat builds.
//     node --test test/server.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitPath = [
    process.env.SIGMA_DIR && path.resolve(process.env.SIGMA_DIR, 'tools/extension-kit/index.mjs'),
    path.resolve(here, '../../../../ProjectSigma-main/tools/extension-kit/index.mjs'),
    path.resolve(here, '../../../../../ProjectSigma-main/tools/extension-kit/index.mjs'),
].filter(Boolean).find(p => fs.existsSync(p));
const { startSigma } = await import(pathToFileURL(kitPath).href);
const sigma = await startSigma({ prefix: 'evolutia-test', extensions: [path.join(here, '..')] });
after(() => sigma.close());
const me = sigma.session;
const evolutia = me.ext('evolutia');
await me.enable('evolutia');

const trig = (...keywords) => ({ keywords, mode: 'ANY' });
const field = (id, name, content, more = {}) => ({
    id, name, content, startsOn: false, activating: trig(), enabling: trig(), disabling: trig(),
    sources: { user: true, char: true }, entryAction: null, exitAction: null, entryConfirm: null, exitConfirm: null, ...more,
});
const human = (fields) => ({ alterEgos: [{
    id: 'human', name: 'Human Kael', fields, entry: trig(), entrySources: { user: true, char: true },
    entryAction: null, exitAction: null, entryConfirm: null, exitConfirm: null, promptName: null, displayName: null,
}] });

// an identical card imports as the same character, so every chat gets its own name
let chats = 0;
async function kael(def, description = 'A wandering swordsman.') {
    const { id } = await me.importCard({ name: 'Kael', description, first_mes: 'Hello.' });
    if (def) assert.equal((await evolutia(`/characters/${id}/definition`, 'PUT', { definition: def })).status, 200);
    const made = await me.api(`/characters/${id}/chats`, 'POST', { name: `Test chat ${++chats}` });
    assert.ok(made.body?.id, `chat not made: ${made.status} ${JSON.stringify(made.body)}`);
    return { id, chatId: made.body.id };
}
const prompt = async (chatId) => (await me.api(`/chats/${chatId}/prompt`)).body.messages.map(m => m.content).join('\n');

test('switching Evolutia on puts the Fields where the Description was; switching it off restores the Original Description', async () => {
    const { id, chatId } = await kael(human([field('look', 'Appearance', 'Tall, scarred, amber eyes.', { startsOn: true })]));
    assert.equal((await evolutia(`/characters/${id}/on`, 'PUT', { on: true })).status, 200);
    const row = async () => (await me.api('/characters?count=false&limit=100')).body.items.find(r => r.id === id);
    assert.equal((await row()).ext?.evolutia?.on, 1, 'list rows carry it, for the card badge');
    let text = await prompt(chatId);
    assert.match(text, /## Appearance\nTall, scarred, amber eyes\./);
    assert.doesNotMatch(text, /wandering swordsman/);
    assert.equal((await evolutia(`/characters/${id}/on`, 'PUT', { on: false })).status, 200);
    text = await prompt(chatId);
    assert.match(text, /A wandering swordsman\./);
    assert.doesNotMatch(text, /## Appearance/);
    assert.equal((await me.api(`/characters/${id}`)).body.card.data.description, 'A wandering swordsman.');
    assert.equal((await row()).ext?.evolutia?.on ?? 0, 0);
});

const you = (mes) => ({ name: 'User', is_user: true, mes });
const said = (mes) => ({ name: 'Kael', is_user: false, mes });
const setChat = async (chatId, messages) => { const r = await me.api(`/chats/${chatId}/messages`, "PUT", { messages }); assert.equal(r.status, 200, JSON.stringify(r.body)); };

const secret = () => human([field('secret', 'The Secret', 'Kael has admitted to {{user}} that he is a werewolf.', {
    enabling: trig('what are you'), sources: { user: true, char: false },
    entryAction: 'Kael confesses that he is a werewolf.', entryConfirm: trig('werewolf'), withAction: false,
})]);

test('a Trigger in a message asks for the Entry Action next to the reply, and a confirming reply brings the Field in', async () => {
    const { id, chatId } = await kael(secret());
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    await setChat(chatId, [said('Hello.'), you('Kael, what are you?')]);
    const built = (await me.api(`/chats/${chatId}/prompt`)).body.messages;
    assert.equal(built.at(-1).content.includes('In your next reply, make this happen: Kael confesses that he is a werewolf.'), true,
        'the Action sits at the end of the prompt, next to the reply');
    assert.doesNotMatch(built.map(m => m.content).join('\n'), /## The Secret/);
    await setChat(chatId, [said('Hello.'), you('Kael, what are you?'), said('I am a werewolf.')]);
    const text = await prompt(chatId);
    assert.match(text, /## The Secret\nKael has admitted to User that he is a werewolf\./);
    assert.doesNotMatch(text, /make this happen/);
});

test('a Branch inherits the state as of the message it branches from', async () => {
    const { id, chatId } = await kael(secret());
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    await setChat(chatId, [said('Hello.'), you('Kael, what are you?'), said('I am a werewolf.'), you('I see.')]);
    const seqs = (await me.api(`/chats/${chatId}`)).body.messages.map(m => m.seq);
    const before = (await me.api(`/chats/${chatId}/branch`, 'POST', { seq: seqs[0] })).body.id;
    const after = (await me.api(`/chats/${chatId}/branch`, 'POST', { seq: seqs[2] })).body.id;
    assert.doesNotMatch(await prompt(before), /## The Secret/);
    assert.match(await prompt(after), /## The Secret/);
});

test('a Manual Switch is kept on the newest message, so deleting that message undoes it', async () => {
    const { id, chatId } = await kael(secret());
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    await setChat(chatId, [said('Hello.'), you('Nice weather.')]);
    const sw = await evolutia(`/chats/${chatId}/switch`, 'POST', { kind: 'field', ego: 'human', id: 'secret', on: true, skip: true });
    assert.equal(sw.status, 200);
    assert.match(await prompt(chatId), /## The Secret/);
    const last = (await me.api(`/chats/${chatId}`)).body.messages.at(-1);
    assert.equal((await me.api(`/chats/${chatId}/messages/${last.seq}`, 'DELETE')).status, 200);
    assert.doesNotMatch(await prompt(chatId), /## The Secret/);
});

test('switching on a card with no Fields yet imports them from the Description, one per heading', async () => {
    const { id, chatId } = await kael(null, 'Intro line.\n\n## Appearance\nTall, scarred.\n\n## Personality\nGruff but kind.');
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    const read = (await evolutia(`/characters/${id}`)).body;
    assert.deepEqual(read.definition.alterEgos[0].fields.map(f => f.name), ['Overview', 'Appearance', 'Personality']);
    const text = await prompt(chatId);
    assert.match(text, /## Overview\nIntro line\.\n\n## Appearance\nTall, scarred\.\n\n## Personality\nGruff but kind\./);
});

test('the chat state reports each Field, the active Alter Ego, the pending Actions and each reply\'s Display Identity', async () => {
    const def = human([field('secret', 'The Secret', 'Kael is a werewolf.', { enabling: trig('what are you'), entryAction: 'Kael confesses.' })]);
    def.alterEgos.push({ ...def.alterEgos[0], id: 'wolf', name: 'Werewolf', fields: [], entry: trig('full moon'), entryAction: 'Kael transforms.', displayName: 'Werewolf Kael', avatar: { media: 7 } });
    const { id, chatId } = await kael(def);
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    await setChat(chatId, [said('Hello.'), you('What are you? Look, the full moon!'), said('A howl.'), said('A growl.')]);
    const seqs = (await me.api(`/chats/${chatId}`)).body.messages.map(m => m.seq);
    const state = (await evolutia(`/chats/${chatId}/state?charId=${id}`)).body;
    assert.equal(state.on, true);
    assert.equal(state.ego.id, 'wolf');
    assert.deepEqual(state.egos.find(e => e.id === 'human').fields, [{ id: 'secret', name: 'The Secret', phase: 'on', inPrompt: false }]);
    assert.equal(state.actionBlock, '');
    assert.deepEqual(state.identities[seqs[2]], { name: 'Kael', avatar: null });
    assert.deepEqual(state.identities[seqs[3]], { name: 'Werewolf Kael', avatar: { media: 7 } });
});

test('a card\'s own settings override the global ones', async () => {
    const def = { ...secret(), settings: { template: 'NOW: {{action}}' } };
    const { id, chatId } = await kael(def);
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    await setChat(chatId, [said('Hello.'), you('Kael, what are you?')]);
    assert.match(await prompt(chatId), /NOW: Kael confesses that he is a werewolf\./);
});

test('the badge follows a card switched through the app\'s own card write, as the Evolutia tab does it', async () => {
    const { id } = await kael(secret());
    const row = async () => (await me.api(`/characters?count=false&ids=${id}`)).body.items[0];
    assert.equal((await me.api(`/characters/${id}`, 'PATCH', { fields: { 'extensions.evolutia.on': true } })).status, 200);
    assert.equal((await row()).ext?.evolutia?.on, 1);
    await me.api(`/characters/${id}`, 'PATCH', { fields: { 'extensions.evolutia.on': false } });
    assert.equal((await row()).ext?.evolutia?.on ?? 0, 0);
});

// ---- the Persona Side (ADR 0006)

// a fresh Demetri each time (Sigma keeps persona names unique), made the active persona
async function demetri(description = 'A laid-back student.') {
    for (const old of (await me.api('/personas')).body.personas.filter(x => x.name === 'Demetri')) await me.api(`/personas/${old.id}`, 'DELETE');
    const p = (await me.api('/personas', 'POST', { name: 'Demetri', description })).body;
    assert.ok(p.id, JSON.stringify(p));
    assert.equal((await me.api('/personas/active', 'PUT', { id: p.id })).status, 200);
    return p.id;
}

test('switching Evolutia on for a persona puts its Fields where its description was; off restores the description', async () => {
    const personaId = await demetri('## Looks\nTall, hoodie.\n\n## Quirk\nAlways late.');
    const { chatId } = await kael(null);
    assert.equal((await evolutia(`/personas/${personaId}/on`, 'PUT', { on: true })).status, 200);
    assert.equal((await me.api(`/personas/${personaId}`)).body.description, '{{evolutia_persona}}');
    let text = await prompt(chatId);
    assert.match(text, /## Looks\nTall, hoodie\.\n\n## Quirk\nAlways late\./);
    const read = (await evolutia(`/personas/${personaId}`)).body;
    assert.deepEqual(read.definition.alterEgos[0].fields.map(f => f.name), ['Looks', 'Quirk']);
    assert.equal((await evolutia(`/personas/${personaId}/on`, 'PUT', { on: false })).status, 200);
    assert.equal((await me.api(`/personas/${personaId}`)).body.description, '## Looks\nTall, hoodie.\n\n## Quirk\nAlways late.');
    text = await prompt(chatId);
    assert.doesNotMatch(text, /evolutia_persona/);
});

const glowing = () => human([field('eyes', 'Glowing Eyes', "{{user}}'s eyes glow faintly blue.", {
    enabling: trig('focus'), sources: { user: true, char: false },
    entryAction: "Describe how {{user}}'s eyes begin to glow.", entryConfirm: trig('glow', 'glowing'), withAction: false,
})]);

test('a persona Trigger asks its Action of the character\'s next reply, and that reply confirms it', async () => {
    const personaId = await demetri('A laid-back student.');
    await evolutia(`/personas/${personaId}/on`, 'PUT', { on: true });
    const saved = await evolutia(`/personas/${personaId}/definition`, 'PUT', { definition: glowing() });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const { chatId } = await kael(null);
    await setChat(chatId, [said('Hello.'), you('I close my eyes and focus.')]);
    let built = (await me.api(`/chats/${chatId}/prompt`)).body.messages;
    assert.match(built.at(-1).content, /make this happen: Describe how Demetri's eyes begin to glow\./);
    await setChat(chatId, [said('Hello.'), you('I close my eyes and focus.'), said('Your eyes start glowing!')]);
    assert.match(await prompt(chatId), /## Glowing Eyes\nDemetri's eyes glow faintly blue\./);
});

test('a persona Manual Switch changes only the persona, and the chat state reports both sides', async () => {
    const personaId = await demetri('A laid-back student.');
    const def = glowing();
    def.alterEgos[0].displayName = 'Demetri (glowing)';
    await evolutia(`/personas/${personaId}/on`, 'PUT', { on: true, definition: def });
    const { id, chatId } = await kael(secret());
    await evolutia(`/characters/${id}/on`, 'PUT', { on: true });
    await setChat(chatId, [said('Hello.'), you('Hi.')]);
    await evolutia(`/chats/${chatId}/switch`, 'POST', { side: 'persona', kind: 'field', ego: 'human', id: 'eyes', on: true, skip: true });
    const text = await prompt(chatId);
    assert.match(text, /## Glowing Eyes/);
    assert.doesNotMatch(text, /## The Secret/);
    const seqs = (await me.api(`/chats/${chatId}`)).body.messages.map(m => m.seq);
    const state = (await evolutia(`/chats/${chatId}/state?charId=${id}`)).body;
    assert.equal(state.egos[0].fields.find(f => f.id === 'secret').phase, 'off');
    assert.equal(state.persona.name, 'Demetri');
    assert.equal(state.persona.egos[0].fields.find(f => f.id === 'eyes').phase, 'on');
    assert.deepEqual(state.persona.identities[seqs[1]], { name: 'Demetri (glowing)', avatar: null });
});

test('stripTriggers is non-destructive: stored message stays untouched while prompt.final and state.stripped strip the keyword', async () => {
    const personaId = await demetri('A laid-back student.');
    const def = human([field('id', 'Identity', 'Demetri base.')]);
    def.alterEgos.push({
        ...def.alterEgos[0],
        id: 'bambi',
        name: 'Bambi',
        disguise: true,
        stripTriggers: true,
        entry: trig('!morphbambi'),
        entrySources: { user: true, char: false },
        fields: [field('bambi-look', 'Appearance', 'Platinum blonde.', { startsOn: true })],
    });
    await evolutia(`/personas/${personaId}/on`, 'PUT', { on: true, definition: def });
    const { chatId } = await kael(null);
    await me.api(`/chats/${chatId}/messages`, 'POST', { mes: '!morphbambi Hey there!' });
    const msgs = (await me.api(`/chats/${chatId}`)).body.messages;
    // Stored SQLite row remains untouched as written (ADR 0004 & ADR 0008)
    assert.equal(msgs.at(-1).content, '!morphbambi Hey there!');
    // Built prompt has the trigger stripped via prompt.final
    const built = (await me.api(`/chats/${chatId}/prompt`)).body.messages;
    assert.ok(built.some(m => m.content === 'Hey there!'));
    assert.ok(!built.some(m => m.content.includes('!morphbambi')));
    const text = built.map(m => m.content).join('\n');
    assert.match(text, /disguised \/ presenting in-scene as: Bambi/);
    assert.match(text, /## Appearance\nPlatinum blonde\./);
    // And /state exposes stripped map for message.render / message.enhance
    const state = (await evolutia(`/chats/${chatId}/state`)).body;
    assert.equal(state.stripped[msgs.at(-1).seq], 'Hey there!');
});

test('assistant-apply creates/updates Alter Egos and Fields on Character and Persona and seeds Saved Prompts', async () => {
    const personaId = await demetri('A laid-back student.');
    const { id: charId, chatId } = await kael(null);
    const applyRes = await evolutia('/assistant-apply', 'POST', {
        chatId,
        charId,
        personaId,
        ops: [
            {
                op: 'upsert-field',
                side: 'char',
                ego: 'main',
                name: 'Secrets',
                startsOn: false,
                enabling: ['what is wrong'],
                entryAction: 'Kael hesitates before speaking.',
                content: 'He is hiding a cursed blade.',
            },
            {
                op: 'upsert-ego',
                side: 'persona',
                name: 'Bambi',
                promptName: 'Bambi',
                disguise: true,
                // Old block using "activating" on the ego still sets its Entry Triggers
                activating: ['bambi disguise'],
                fields: [
                    { name: 'Appearance', startsOn: true, content: 'Platinum waves and pink crop top.' },
                ],
            },
            {
                op: 'upsert-ego',
                side: 'persona',
                name: 'Ollie',
                promptName: 'Ollie',
                disguise: true,
                entry: ['become ollie'],
                entrySources: ['user'],
                entryConfirm: ['Ollie'],
                exitConfirm: ['Demetri'],
                stripTriggers: true,
                fields: [
                    {
                        name: 'Intimate',
                        startsOn: true,
                        sources: ['user'],
                        activating: ['kiss', 'undress'],
                        content: 'Energetic and vocal.',
                    },
                ],
            },
            {
                op: 'switch',
                side: 'persona',
                ego: 'Bambi',
            },
        ],
    });
    assert.equal(applyRes.status, 200, JSON.stringify(applyRes.body));
    assert.equal(applyRes.body.summary.length, 4);

    // Check that Bambi's legacy "activating" set Entry Triggers, and Ollie's "entry" + Intimate "activating" mapped to Activating Triggers (with no Enabling ones)
    const personaEvo = (await evolutia(`/personas/${applyRes.body.personaId}`)).body.definition;
    const bambiEgo = personaEvo.alterEgos.find(e => e.name === 'Bambi');
    assert.deepEqual(bambiEgo.entry.keywords, ['bambi disguise'], 'old "activating" on ego sets Entry Triggers');
    const ollieEgo = personaEvo.alterEgos.find(e => e.name === 'Ollie');
    assert.deepEqual(ollieEgo.entry.keywords, ['become ollie'], '"entry" on ego sets Entry Triggers');
    assert.deepEqual(ollieEgo.entrySources, { user: true, char: false }, '"entrySources" on ego sets user-only source');
    assert.deepEqual(ollieEgo.entryConfirm.keywords, ['Ollie'], '"entryConfirm" on ego sets Confirm keywords');
    assert.deepEqual(ollieEgo.exitConfirm.keywords, ['Demetri'], '"exitConfirm" on ego sets Exit Confirm keywords');
    assert.equal(ollieEgo.stripTriggers, true, '"stripTriggers" on ego is saved');
    const intimateField = ollieEgo.fields.find(f => f.name === 'Intimate');
    assert.deepEqual(intimateField.activating.keywords, ['kiss', 'undress'], 'nested Field "activating" sets Activating Triggers');
    assert.deepEqual(intimateField.enabling.keywords, [], 'nested Field has no Enabling Triggers');
    assert.deepEqual(intimateField.sources, { user: true, char: false }, 'nested Field "sources" sets user-only source');

    const state = (await evolutia(`/chats/${chatId}/state?charId=${charId}`)).body;
    assert.equal(state.on, true);
    assert.ok(state.egos[0].fields.some(f => f.name === 'Secrets' && f.phase === 'off'));
    assert.equal(state.persona.ego.name, 'Bambi');
    assert.equal(state.persona.ego.disguise, true);

    const seedRes = await evolutia('/seed-prompts', 'POST', {});
    assert.equal(seedRes.status, 200);
    assert.equal(seedRes.body.seeded, true);

    // Deleting a seeded prompt via Sigma's store route ({ version, prompts } with no extra keys)
    // and calling /seed-prompts again must NOT resurrect the deleted prompt.
    const doc1 = (await me.api('/store/assistant-prompts')).body;
    assert.ok(doc1.prompts.some(p => p.id === 'evo-distill-ego'));
    assert.ok(!doc1.prompts.some(p => p.id === 'evo-seed-distill-ego-dshad'), 'DShad template is not seeded');
    const { EVOLUTIA_ASSISTANT_PROMPTS, EVOLUTIA_CREATOR_PROMPTS } = await import('../client/core/assistant.js');
    assert.ok(!EVOLUTIA_ASSISTANT_PROMPTS.some(p => p.id === 'evo-seed-distill-ego-dshad'));
    for (const p of [...EVOLUTIA_ASSISTANT_PROMPTS, ...EVOLUTIA_CREATOR_PROMPTS]) {
        assert.doesNotMatch(p.text, /\{\{(?:user|char)\}\}/, p.id);
    }
    const distillPrompt = doc1.prompts.find(p => p.id === 'evo-distill-ego');
    assert.match(distillPrompt.text, /entryConfirm/, 'updated Distill Alter Ego prompt mentions entryConfirm');
    const filtered = doc1.prompts.filter(p => p.id !== 'evo-distill-ego');
    await me.api('/store/assistant-prompts', 'PUT', { version: 1, prompts: filtered });

    const seedAgain = await evolutia('/seed-prompts', 'POST', {});
    assert.equal(seedAgain.status, 200);
    assert.equal(seedAgain.body.seeded, false);
    const doc2 = (await me.api('/store/assistant-prompts')).body;
    assert.ok(!doc2.prompts.some(p => p.id === 'evo-distill-ego'), 'deleted prompt stays deleted');
});

test('seed upgrades preserve deletions and custom texts, migrate stock texts, and allow forced restoration', async () => {
    const prompts = await import('../client/core/assistant.js');
    const hostRoot = path.resolve(path.dirname(kitPath), '../..');
    const { extensionUserDir } = await import(pathToFileURL(path.join(hostRoot, 'server/lib/extensions.js')).href);
    const marker = path.join(extensionUserDir('default', 'evolutia'), 'seeded-prompts.json');
    const stock36 = 'Distill a portable Evolutia Alter Ego from this scene or character (with modular Fields like Background, Personality, Appearance, Outfit, and Intimate, using entry triggers on the Alter Ego, activating/enabling triggers on Fields, and disguise setting if appropriate) and propose it as a `cl-evolutia-edits` block.';
    const current = prompts.EVOLUTIA_ASSISTANT_PROMPTS.find(p => p.id === 'evo-distill-ego');
    const legacyDshad = prompts.LEGACY_DSHAD_PROMPT_TEXT ?? prompts.EVOLUTIA_ASSISTANT_PROMPTS.find(p => p.id === 'evo-seed-distill-ego-dshad').text;
    const previous = prompts.PREVIOUS_SEED_TEXTS?.['evo-distill-ego'] ?? [stock36, current.text];
    const seedFrom = async (version, assistant, creator = []) => {
        fs.writeFileSync(marker, JSON.stringify({ seeded: true, version }));
        assert.equal((await me.api('/store/assistant-prompts', 'PUT', { version: 1, prompts: assistant })).status, 200);
        assert.equal((await me.api('/store/creator-studio-prompts', 'PUT', { version: 1, prompts: creator })).status, 200);
        const seeded = await evolutia('/seed-prompts', 'POST', {});
        assert.equal(seeded.body.seeded, true);
        assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).version, 3);
        return (await me.api('/store/assistant-prompts')).body.prompts;
    };
    for (const version of [1, 2]) {
        let list = await seedFrom(version, [{ ...current, text: 'My custom distillation', label: 'My label', icon: 'X' }]);
        assert.ok(!list.some(p => p.id === 'evo-distill-lore'));
        assert.equal(list.find(p => p.id === current.id).text, 'My custom distillation');
        assert.deepEqual((await me.api('/store/creator-studio-prompts')).body.prompts, []);
        for (const text of new Set([stock36, ...previous])) {
            list = await seedFrom(version, [{ ...current, text, label: 'Keep my label', icon: 'X' }]);
            assert.equal(list.find(p => p.id === current.id).text, current.text);
            assert.equal(list.find(p => p.id === current.id).label, 'Keep my label');
            assert.equal(list.find(p => p.id === current.id).icon, 'X');
        }
        list = await seedFrom(version, [{ id: 'evo-seed-distill-ego-dshad', text: legacyDshad }]);
        assert.ok(!list.some(p => p.id === 'evo-seed-distill-ego-dshad'));
        assert.ok(!list.some(p => p.id === current.id));
        list = await seedFrom(version, [{ id: 'evo-seed-distill-ego-dshad', text: legacyDshad + ' My edits.' }]);
        assert.equal(list.find(p => p.id === 'evo-seed-distill-ego-dshad').text, legacyDshad + ' My edits.');
        const creator = prompts.EVOLUTIA_CREATOR_PROMPTS[0];
        await seedFrom(version, [], [{ ...creator, text: 'My creator instructions' }]);
        assert.equal((await me.api('/store/creator-studio-prompts')).body.prompts[0].text, 'My creator instructions');
        for (const text of prompts.PREVIOUS_SEED_TEXTS?.[creator.id] ?? []) {
            await seedFrom(version, [], [{ ...creator, text }]);
            assert.equal((await me.api('/store/creator-studio-prompts')).body.prompts[0].text, creator.text);
        }
        const forced = await evolutia('/seed-prompts', 'POST', { force: true });
        assert.equal(forced.body.seeded, true);
        list = (await me.api('/store/assistant-prompts')).body.prompts;
        for (const p of prompts.EVOLUTIA_ASSISTANT_PROMPTS) assert.equal(list.find(x => x.id === p.id).text, p.text);
        assert.equal((await me.api('/store/creator-studio-prompts')).body.prompts.find(p => p.id === creator.id).text, creator.text);
    }
});

test('extension requests use latest message time rather than latest chat edit', async () => {
    const older = await kael(human([field('look', 'Appearance', 'WRONG CHAT FIELD', { startsOn: true })]));
    const latest = await kael(human([field('look', 'Appearance', 'LATEST MESSAGE FIELD', { startsOn: true })]));
    for (const chat of [older, latest]) await evolutia(`/characters/${chat.id}/on`, 'PUT', { on: true });
    const db = sigma.db();
    db.prepare('UPDATE chats SET last_mes_at = 10, updated_at = 9999999999999').run();
    db.prepare('UPDATE chats SET last_mes_at = 20, updated_at = 1 WHERE id = ?').run(latest.chatId);
    const { runHook } = await import(pathToFileURL(path.resolve(path.dirname(kitPath), '../../server/db/hook-seat.js')).href);
    const request = { messages: [{ role: 'system', content: '{{evolutia}}' }], params: {} };
    const result = runHook('llm.request', request, { db, purpose: 'extension', profileKind: 'openai', profileId: null });
    assert.match(result.messages[0].content, /LATEST MESSAGE FIELD/);
    assert.doesNotMatch(result.messages[0].content, /WRONG CHAT FIELD|\{\{evolutia\}\}/);
    assert.equal(request.messages[0].content, '{{evolutia}}', 'request stays immutable');
});

test('uploading a custom avatar returns an upload avatar descriptor and client page boots cleanly with __SIGMA_EVOLUTIA__', async () => {
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const up = await evolutia('/avatars', 'POST', { filename: 'bambi.png', dataUrl: tinyPng });
    assert.equal(up.status, 200);
    assert.ok(up.body.avatar?.upload);

    const page = await me.page();
    try {
        await page.boot();
        assert.ok(globalThis.window?.__SIGMA_EVOLUTIA__, 'window.__SIGMA_EVOLUTIA__ is exposed');
        assert.equal(globalThis.window.__SIGMA_EVOLUTIA__.version, '0.3.9');
    } finally {
        await page.close();
    }
});


