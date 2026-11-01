// Seam B: Evolutia in a real Sigma server, observed through the prompt a chat builds.
//     node --test test/server.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSigma } from '../../../../ProjectSigma-main/tools/extension-kit/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
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

async function kael(def, description = 'A wandering swordsman.') {
    const { id } = await me.importCard({ name: 'Kael', description, first_mes: 'Hello.' });
    if (def) assert.equal((await evolutia(`/characters/${id}/definition`, 'PUT', { definition: def })).status, 200);
    const chat = (await me.api(`/characters/${id}/chats`, 'POST', { name: 'Test chat' })).body;
    return { id, chatId: chat.id };
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
const setChat = async (chatId, messages) => assert.equal((await me.api(`/chats/${chatId}/messages`, 'PUT', { messages })).status, 200);

const secret = () => human([field('secret', 'The Secret', 'Kael has admitted to {{user}} that he is a werewolf.', {
    enabling: trig('what are you'), sources: { user: true, char: false },
    entryAction: 'Kael confesses that he is a werewolf.', entryConfirm: trig('werewolf'),
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
