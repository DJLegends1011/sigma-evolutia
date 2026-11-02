// Seam A: Field Definitions read from a Description.
//     node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromDescription, rebuildFromDescription } from '../client/core/definition.js';
import { drawAvatar } from '../client/identity.js';
import { resolveCopyAlterEgo } from '../client/editor.js';

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

// --- Issue #4: the Alter Ego portrait over a glyph frame (a persona without an avatar) ---

// A mock message element just rich enough for drawAvatar: attributes, dataset, querySelector over
// children (recursively), and innerHTML as a string. Only the selectors drawAvatar uses are matched.
class MockEl {
    constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = { ...attrs }; this.dataset = {}; this.children = []; }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    get className() { return this.attrs.class ?? ''; }
    set className(v) { this.attrs.class = v; }
    get innerHTML() { return this._html ?? ''; }
    set innerHTML(html) { this._html = html; this.children = []; }
    replaceChildren(...nodes) { this.children = nodes; this._html = ''; }
    querySelector(sel) {
        for (const c of this.children) {
            if (mockMatches(c, sel)) return c;
            const found = c.querySelector(sel);
            if (found) return found;
        }
        return null;
    }
}
function mockMatches(n, sel) {
    if (sel === '.chat-conv-msg-avatar-frame') return n.tag === 'div' && n.className === 'chat-conv-msg-avatar-frame';
    if (!n || n.tag !== 'img' || n.className !== 'chat-conv-msg-avatar') return false;
    const synth = n.getAttribute('data-evo-synth-avatar');
    return sel.includes(':not(') ? synth === null : synth === '1';
}
const mockDoc = { createElement: (tag) => new MockEl(tag) };
const GLYPH = '<i class="fa-solid fa-user chat-conv-msg-avatar-glyph"></i>';
const glyphMessage = () => {
    const el = new MockEl();
    const frame = new MockEl('div', { class: 'chat-conv-msg-avatar-frame' });
    frame.innerHTML = GLYPH;
    el.children = [frame];
    return { el, frame };
};
const SYNTH = 'img.chat-conv-msg-avatar[data-evo-synth-avatar]';

test('a persona with no avatar: glyph -> Alter Ego <img> -> glyph, with no leftover <img>', () => {
    const { el, frame } = glyphMessage();

    drawAvatar(el, '/thumb/wolf.png', mockDoc);
    const img = frame.querySelector(SYNTH);
    assert.ok(img, 'a synthesized avatar <img> appears in the frame');
    assert.equal(img.getAttribute('src'), '/thumb/wolf.png');
    assert.equal(img.getAttribute('alt'), '');
    assert.equal(img.getAttribute('loading'), 'lazy');
    assert.equal(el.dataset.evoAvatarHtml, GLYPH, 'the original glyph markup is remembered');
    assert.equal(el.dataset.evoSrc, undefined, 'the native-src path is never touched');

    drawAvatar(el, '/thumb/wolf-2.png', mockDoc);
    assert.equal(frame.children.length, 1, 'the same synthesized <img> is reused');
    assert.equal(frame.children[0].getAttribute('src'), '/thumb/wolf-2.png');

    drawAvatar(el, '', mockDoc);
    assert.equal(frame.innerHTML, GLYPH, 'the original glyph markup returns');
    assert.equal(el.dataset.evoAvatarHtml, undefined, 'the memory is cleared');
    assert.equal(frame.querySelector(SYNTH), null, 'no leftover <img> stays behind');
    assert.equal(el.querySelector(SYNTH), null);
});

test('a message that already has a native avatar <img>: the src swaps and comes back', () => {
    const el = new MockEl();
    const frame = new MockEl('div', { class: 'chat-conv-msg-avatar-frame' });
    const img = new MockEl('img', { class: 'chat-conv-msg-avatar', src: 'orig.png' });
    frame.children = [img];
    el.children = [frame];

    drawAvatar(el, '/thumb/ego.png', mockDoc);
    assert.equal(img.getAttribute('src'), '/thumb/ego.png');
    assert.equal(el.dataset.evoSrc, 'orig.png', 'the original src is remembered');
    assert.equal(el.dataset.evoAvatarHtml, undefined, 'no frame snapshot on the native path');
    assert.equal(frame.children.length, 1, 'no extra <img> is added');

    drawAvatar(el, '', mockDoc);
    assert.equal(img.getAttribute('src'), 'orig.png', 'the original src returns when the identity goes away');
});

// --- Issue #6: copying an Alter Ego onto a target that already has one of that name ---

const sourceEgo = () => ({
    id: 'wolf', name: 'Wolf', promptName: null, displayName: null, avatar: null,
    fields: [{ id: 'fangs', name: 'Fangs', content: 'Sharp.' }], _uiAvatarMode: 'gallery',
});

test('copying to a target without that name adds the Alter Ego under its own name', () => {
    const targetDef = { alterEgos: [{ id: 'main', name: 'Main', fields: [] }] };
    const applied = resolveCopyAlterEgo(targetDef, sourceEgo(), { ownerNoun: 'card', ownerCharId: 'kael', targetNoun: 'persona' });
    assert.equal(applied.mode, 'add');
    assert.equal(targetDef.alterEgos.length, 2);
    assert.equal(targetDef.alterEgos[1].name, 'Wolf');
    assert.equal(new Set(targetDef.alterEgos.map(x => x.id)).size, 2, "the copy's id is unique among the target's own");
    assert.equal(targetDef.alterEgos[1].disguise, true, 'a card copied to a persona becomes a Disguise');
    assert.equal(targetDef.alterEgos[1]._uiAvatarMode, undefined, 'editor-only UI state is dropped');
    assert.equal(targetDef.alterEgos[1].fields[0].id, 'fangs');
});

test("copying onto an existing name (case-insensitive) with 'replace' overwrites it and keeps its id", () => {
    const targetDef = { alterEgos: [{ id: 'main', name: 'Main', fields: [] }, { id: 'tracked', name: ' wolf ', fields: [{ id: 'x', name: 'Old' }] }] };
    const applied = resolveCopyAlterEgo(targetDef, sourceEgo(), { choice: 'replace', ownerNoun: 'persona', targetNoun: 'card' });
    assert.equal(applied.mode, 'replace');
    assert.equal(targetDef.alterEgos.length, 2, 'nothing is appended');
    assert.equal(targetDef.alterEgos[1].id, 'tracked', 'the id chats track this Alter Ego by survives');
    assert.equal(targetDef.alterEgos[1].name, 'Wolf');
    assert.deepEqual(targetDef.alterEgos[1].fields.map(f => f.name), ['Fangs'], 'the old Fields are replaced');
    assert.equal(targetDef.alterEgos[1].disguise, undefined, 'persona -> card copies stay ordinary Alter Egos');
});

test("copying onto an existing name with 'copy' appends '<Name> (2)', then (3), with fresh ids", () => {
    const targetDef = { alterEgos: [{ id: 'wolf', name: 'Wolf', fields: [] }, { id: 'main', name: 'Main', fields: [] }] };
    const applied = resolveCopyAlterEgo(targetDef, sourceEgo(), { choice: 'copy', ownerNoun: 'card', targetNoun: 'card' });
    assert.equal(applied.mode, 'copy');
    assert.equal(targetDef.alterEgos.length, 3);
    assert.equal(targetDef.alterEgos[2].name, 'Wolf (2)');
    assert.notEqual(targetDef.alterEgos[2].id, 'wolf');
    assert.equal(targetDef.alterEgos[0].name, 'Wolf', 'the existing one stays as it was');

    const again = resolveCopyAlterEgo(targetDef, sourceEgo(), { choice: 'copy', ownerNoun: 'card', targetNoun: 'card' });
    assert.equal(again.ego.name, 'Wolf (3)', '"(2)" taken: the next copy takes "(3)"');
    assert.equal(new Set(targetDef.alterEgos.map(x => x.id)).size, 4, 'every id stays unique');
});

test("copying onto an existing name with 'cancel' leaves the target's Alter Egos unchanged", () => {
    const targetDef = { alterEgos: [{ id: 'wolf', name: 'Wolf', fields: [{ id: 'x', name: 'Old' }] }] };
    const before = JSON.stringify(targetDef);
    assert.equal(resolveCopyAlterEgo(targetDef, sourceEgo(), { choice: 'cancel', ownerNoun: 'card', targetNoun: 'persona' }), null);
    assert.equal(JSON.stringify(targetDef), before, 'not a byte moves');
});
