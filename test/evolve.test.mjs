// Seam A: Field State worked out from a chat's messages, and what {{evolutia}} and the Action block say.
//     node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTimeline, promptFor, identityFor } from '../core/evolve.js';

const trig = (...keywords) => ({ keywords, mode: 'ANY' });
const field = (id, name, content, more = {}) => ({
    id, name, content, startsOn: false,
    activating: trig(), enabling: trig(), disabling: trig(),
    sources: { user: true, char: true },
    entryAction: null, exitAction: null, entryConfirm: null, exitConfirm: null,
    ...more,
});
const ego = (id, name, fields, more = {}) => ({
    id, name, fields, entry: trig(), entrySources: { user: true, char: true },
    entryAction: null, exitAction: null, entryConfirm: null, exitConfirm: null,
    promptName: null, displayName: null, ...more,
});
const OPTS = { charName: 'Kael', window: 1, tries: 2, template: 'In your next reply, make this happen: {{action}}' };
const you = (text, manual = []) => ({ role: 'user', text, manual });
const kael = (text, manual = []) => ({ role: 'char', text, manual });

// the prompt for the reply after the whole history
function promptAfter(def, messages, opts = OPTS) {
    return promptFor(def, messages, deriveTimeline(def, messages, opts), messages.length - 1, opts);
}

test('a Field that starts on is in {{evolutia}} under its name; one that starts off is not', () => {
    const def = { alterEgos: [ego('human', 'Human Kael', [
        field('look', 'Appearance', 'Tall, scarred, amber eyes.', { startsOn: true }),
        field('secret', 'The Secret', 'Kael is a werewolf.'),
    ])] };
    assert.equal(promptAfter(def, []).evolutia, '## Appearance\nTall, scarred, amber eyes.');
});

const injuryDef = () => ({ alterEgos: [ego('human', 'Human Kael', [
    field('injury', 'Injury', 'A fresh wound on his side.', { enabling: trig('stabbed', 'wounded'), disabling: trig('bandaged', 'healed') }),
])] });

test('an Enabling Trigger switches its Field on, matching whole words only', () => {
    assert.equal(promptAfter(injuryDef(), [you('An unstabbedness test.')]).evolutia, '');
    assert.equal(promptAfter(injuryDef(), [you('You got stabbed!')]).evolutia, '## Injury\nA fresh wound on his side.');
});

test('a Disabling Trigger switches its Field off, and beats an Enabling Trigger in the same message', () => {
    assert.equal(promptAfter(injuryDef(), [you('You got stabbed!'), kael('It is nothing.'), you('There, I bandaged it.')]).evolutia, '');
    assert.equal(promptAfter(injuryDef(), [you('You got stabbed but I bandaged it.')]).evolutia, '');
});

test('an Activating Trigger admits its Field only while it matches within the Window', () => {
    const def = { alterEgos: [ego('human', 'Human Kael', [
        field('mira', 'Around Mira', 'Guarded and formal around Mira.', { startsOn: true, activating: trig('Mira') }),
    ])] };
    const chat = [you('Mira just walked in.'), you('She left again.')];
    assert.equal(promptAfter(def, chat.slice(0, 1)).evolutia, '## Around Mira\nGuarded and formal around Mira.');
    assert.equal(promptAfter(def, chat).evolutia, '');
    assert.equal(promptAfter(def, chat, { ...OPTS, window: 2 }).evolutia, '## Around Mira\nGuarded and formal around Mira.');
});

const secretDef = (more = {}) => ({ alterEgos: [ego('human', 'Human Kael', [
    field('secret', 'The Secret', 'Kael has admitted he is a werewolf.', {
        enabling: trig('what are you'), sources: { user: true, char: false },
        entryAction: 'Kael confesses that he is a werewolf.', ...more,
    }),
])] });

test('an Entry Action is asked for in the next reply, and the content enters the prompt after it', () => {
    const asked = promptAfter(secretDef(), [you('Kael, what are you?')]);
    assert.equal(asked.evolutia, '');
    assert.equal(asked.actionBlock, 'In your next reply, make this happen: Kael confesses that he is a werewolf.');
    const after = promptAfter(secretDef(), [you('Kael, what are you?'), kael('I am a werewolf.')]);
    assert.equal(after.evolutia, '## The Secret\nKael has admitted he is a werewolf.');
    assert.equal(after.actionBlock, '');
});

test('a reply without a Confirm Keyword does not count: the Action is asked again, then given up after Action Tries', () => {
    const def = secretDef({ entryConfirm: trig('werewolf') });
    const dodged = promptAfter(def, [you('Kael, what are you?'), kael('Just a human.')]);
    assert.equal(dodged.evolutia, '');
    assert.equal(dodged.actionBlock, 'In your next reply, make this happen: Kael confesses that he is a werewolf.');
    const confessed = promptAfter(def, [you('Kael, what are you?'), kael('Just a human.'), you('Liar.'), kael('Fine. I am a werewolf.')]);
    assert.equal(confessed.evolutia, '## The Secret\nKael has admitted he is a werewolf.');
    const never = promptAfter(def, [you('Kael, what are you?'), kael('Just a human.'), you('Liar.'), kael('He walks away.')]);
    assert.equal(never.evolutia, '');
    assert.equal(never.actionBlock, '');
});

test('an Exit Action keeps the content in the prompt while it is asked for, then the content leaves', () => {
    const def = { alterEgos: [ego('human', 'Human Kael', [
        field('injury', 'Injury', 'A fresh wound on his side.', {
            startsOn: true, disabling: trig('healed'),
            exitAction: 'Kael notices his wound has closed.', exitConfirm: trig('closed', 'scar'),
        }),
    ])] };
    const asked = promptAfter(def, [you('Your wound looks healed.')]);
    assert.equal(asked.evolutia, '## Injury\nA fresh wound on his side.');
    assert.equal(asked.actionBlock, 'In your next reply, make this happen: Kael notices his wound has closed.');
    const done = promptAfter(def, [you('Your wound looks healed.'), kael('Only a pale scar is left.')]);
    assert.equal(done.evolutia, '');
    assert.equal(done.actionBlock, '');
});

test('a Manual Switch counts as a Trigger at its message, with its Action unless skipped', () => {
    const on = { kind: 'field', ego: 'human', id: 'secret', on: true };
    assert.equal(promptAfter(secretDef(), [you('Hello.', [on])]).actionBlock,
        'In your next reply, make this happen: Kael confesses that he is a werewolf.');
    assert.equal(promptAfter(secretDef(), [you('Hello.', [{ ...on, skip: true }])]).evolutia,
        '## The Secret\nKael has admitted he is a werewolf.');
});

test('an old keyword still in the Window cannot undo a Manual Switch', () => {
    const off = { kind: 'field', ego: 'human', id: 'injury', on: false };
    const chat = [you('You got stabbed!'), kael('Just a scratch.', [off]), you("Let's keep walking.")];
    assert.equal(promptAfter(injuryDef(), chat, { ...OPTS, window: 3 }).evolutia, '');
});

const wolfDef = () => ({ alterEgos: [
    ego('human', 'Human Kael', [
        field('injury', 'Injury', 'A fresh wound on his side.', { enabling: trig('stabbed') }),
    ], { entry: trig('sunrise') }),
    ego('wolf', 'Werewolf', [
        field('form', 'Form', 'A huge black wolf.', { startsOn: true }),
    ], {
        entry: trig('full moon'), promptName: 'the Werewolf', displayName: 'Werewolf Kael',
        entryAction: 'Kael transforms into a huge black wolf.', entryConfirm: trig('howl', 'fur'),
        exitAction: 'Kael turns back into a man.',
    }),
] });

test('an Alter Ego Entry Trigger asks for the change, and the new Alter Ego takes over once a reply confirms it', () => {
    const chat = [you('You got stabbed!'), kael('It is nothing.'), you('Look, the full moon.')];
    const asked = promptAfter(wolfDef(), chat);
    assert.equal(asked.evolutia, '## Injury\nA fresh wound on his side.');
    assert.equal(asked.actionBlock, 'In your next reply, make this happen: Kael transforms into a huge black wolf.');
    const wolf = promptAfter(wolfDef(), [...chat, kael('A howl tears out of him.')]);
    assert.equal(wolf.evolutia, 'Kael is currently going by: the Werewolf.\n\n## Form\nA huge black wolf.');
    assert.equal(wolf.actionBlock, '');
});

test('switching back to an Alter Ego finds its Fields as they were left', () => {
    const chat = [you('You got stabbed!'), you('Look, the full moon.'), kael('A howl.'), you('Sunrise at last.')];
    const asked = promptAfter(wolfDef(), chat);
    assert.equal(asked.actionBlock, 'In your next reply, make this happen: Kael turns back into a man.');
    assert.equal(promptAfter(wolfDef(), [...chat, kael('He collapses, a man again.')]).evolutia, '## Injury\nA fresh wound on his side.');
});

test('a /regex/ keyword matches as a regular expression, ignoring case', () => {
    const def = { alterEgos: [ego('human', 'Human Kael', [
        field('wolf', 'Wolf Form', 'Covered in black fur.', { enabling: trig('/transform(s|ed)? into a (were)?wolf/') }),
    ])] };
    assert.equal(promptAfter(def, [kael('He TRANSFORMED into a werewolf.')]).evolutia, '## Wolf Form\nCovered in black fur.');
    assert.equal(promptAfter(def, [kael('He transforms into a bird.')]).evolutia, '');
});

test('a Trigger in ALL mode needs every keyword', () => {
    const def = { alterEgos: [ego('human', 'Human Kael', [
        field('duel', 'Duel', 'Kael is mid-duel.', { enabling: { keywords: ['sword', 'draw'], mode: 'ALL' } }),
    ])] };
    assert.equal(promptAfter(def, [you('A sword hangs on the wall.')]).evolutia, '');
    assert.equal(promptAfter(def, [you('Draw your sword!')]).evolutia, '## Duel\nKael is mid-duel.');
});

test('the reply that carries an Alter Ego change still shows the old Display Identity; the next shows the new', () => {
    const chat = [you('Look, the full moon.'), kael('A howl tears out of him.'), you('Easy.'), kael('A low growl.')];
    const timeline = deriveTimeline(wolfDef(), chat, OPTS);
    assert.deepEqual(identityFor(wolfDef(), timeline, 1, OPTS), { name: 'Kael', avatar: null });
    assert.deepEqual(identityFor(wolfDef(), timeline, 3, OPTS), { name: 'Werewolf Kael', avatar: null });
});
