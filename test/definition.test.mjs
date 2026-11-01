// Seam A: Field Definitions read from a Description.
//     node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromDescription, rebuildFromDescription } from '../client/core/definition.js';

test('rebuilding from the Description replaces the first Alter Ego\'s Fields, keeping the work on Fields of the same name', () => {
    const def = definitionFromDescription('## Appearance\nOld look.\n\n## Secret\nOld secret.');
    def.alterEgos[0].fields[1].enabling = { keywords: ['what are you'], mode: 'ANY' };
    def.alterEgos[0].fields[1].entryAction = 'She confesses.';
    def.alterEgos.push({ ...def.alterEgos[0], id: 'wolf', name: 'Wolf' });

    const rebuilt = rebuildFromDescription(def, '## Background\nBorn in Cain.\n\n## Secrets\nNew secret.\n\n## secret\nRenamed case.');
    const fields = rebuilt.alterEgos[0].fields;
    assert.deepEqual(fields.map(f => [f.name, f.content]), [['Background', 'Born in Cain.'], ['Secrets', 'New secret.'], ['secret', 'Renamed case.']]);
    assert.deepEqual(fields[2].enabling.keywords, ['what are you'], 'a name matching but for case keeps its Triggers');
    assert.equal(fields[2].entryAction, 'She confesses.');
    assert.equal(fields[0].enabling.keywords.length, 0);
    assert.equal(rebuilt.alterEgos[1].id, 'wolf', 'other Alter Egos are untouched');
    assert.equal(def.alterEgos[0].fields.length, 2, 'the definition handed in is not changed');
});

test('a kept Field keeps its id, which Manual Switches in chats refer to, even when a new Field would take it', () => {
    const def = definitionFromDescription('## Secret\nOld.');
    def.alterEgos[0].fields[0].name = 'Hidden Truth';
    const rebuilt = rebuildFromDescription(def, '## Secret\nA new Field named like the old id.\n\n## Hidden Truth\nKept.');
    const byName = Object.fromEntries(rebuilt.alterEgos[0].fields.map(f => [f.name, f.id]));
    assert.equal(byName['Hidden Truth'], 'secret');
    assert.notEqual(byName.Secret, 'secret');
});

test('two headings of one name: only the first keeps the old Field, and every id stays unique', () => {
    const def = definitionFromDescription('## Secret\nOld.');
    const ids = rebuildFromDescription(def, '## Secret\nOne.\n\n## Secret\nTwo.').alterEgos[0].fields.map(f => f.id);
    assert.equal(ids[0], 'secret');
    assert.equal(new Set(ids).size, 2);
});
