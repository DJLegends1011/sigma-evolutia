// The Evolutia editor, for a card (its details tab) or a persona (a dialog from Settings › Chat): switching
// Evolutia on, and editing Alter Egos and their Fields.
import { blankField, idFor, rebuildFromDescription } from './core/definition.js';

const hasHeadings = (text) => /^#{1,6}\s+\S/m.test(String(text ?? ''));

// Keywords as typed: one per line or comma-separated; a /regex/ keeps its own line whole.
export function parseKeywords(text) {
    return String(text ?? '').split('\n').flatMap(line => {
        const t = line.trim();
        if (!t) return [];
        return /^\/.+\/[a-z]*$/.test(t) ? [t] : t.split(',').map(s => s.trim()).filter(Boolean);
    });
}
const keywordsText = (trigger) => (trigger?.keywords || []).join(', ');

function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
    target[last] = value;
}

// The editor of one owner's Field Definitions (a card's or a persona's, see owners.js).
export function mountEditor(pane, owner, ctx, { bigEditor }) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    let on = false, def = null, got = null, saved = '', egoIndex = 0, gallery = null;

    const dirty = () => JSON.stringify(def) !== saved;
    // the description the Fields come from: kept aside while Evolutia is on, the owner's own while it is off
    const sourceDescription = () => got?.source ?? '';
    const REBUILD_ASK = `Rebuild this ${owner.noun}'s Fields from the ${owner.descLabel}'s ## headings? A Field whose name matches a heading keeps its Triggers and Actions and takes the new text; the other Fields of the first Alter Ego are replaced.`;

    async function load() {
        pane.innerHTML = '<p class="evo-muted">Loading…</p>';
        try {
            got = await owner.load();
            on = got.on;
            def = got.definition;
            saved = JSON.stringify(def);
            egoIndex = 0;
            render();
        } catch (e) {
            pane.innerHTML = `<p class="evo-error">Could not read Evolutia's data: ${esc(e.message)}</p>`;
        }
    }

    // ---- markup

    const sw = (path, checked, label) => `
        <label class="evo-switch"><input type="checkbox" class="cl-switch-input" data-path="${path}" ${checked ? 'checked' : ''}><span class="cl-switch" aria-hidden="true"></span><span>${label}</span></label>`;

    const reads = (path, sources) => `
        <div class="evo-reads"><span class="evo-label">Reads</span>
            <label><input type="checkbox" data-path="${path}.user" ${sources?.user ? 'checked' : ''}> <span>Your messages</span></label>
            <label><input type="checkbox" data-path="${path}.char" ${sources?.char ? 'checked' : ''}> <span>${esc(owner.otherSide)}</span></label>
        </div>`;

    const trigger = (path, label, hint, value) => `
        <div class="evo-trigger">
            <div class="evo-trigger-head"><span class="evo-label">${label}</span>
                <select class="cl-select-fluid evo-mode" data-path="${path}.mode">
                    <option value="ANY" ${value?.mode !== 'ALL' ? 'selected' : ''}>any keyword</option>
                    <option value="ALL" ${value?.mode === 'ALL' ? 'selected' : ''}>all keywords</option>
                </select>
            </div>
            <textarea class="cl-input evo-keywords" rows="1" data-path="${path}" data-kind="keywords" placeholder="keyword, another, /regex/">${esc(keywordsText(value))}</textarea>
            <span class="evo-hint">${hint}</span>
        </div>`;

    const action = (path, label, hint, text, confirm) => `
        <div class="evo-action">
            ${labelWithExpand(label, `${path}Action`)}
            <textarea class="glass-input evo-long" rows="2" data-path="${path}Action" data-kind="nullable" placeholder="Optional">${esc(text)}</textarea>
            <span class="evo-hint">${hint}</span>
            <span class="evo-label evo-sub">Confirmed by a reply containing</span>
            <textarea class="cl-input evo-keywords" rows="1" data-path="${path}Confirm" data-kind="keywords" placeholder="Any reply counts">${esc(keywordsText(confirm))}</textarea>
        </div>`;

    // Content With Action (ADR 0007): on unless switched off, so a definition saved before it reads as on
    const withActionSwitch = (path, value) => `
        <div class="evo-row">${sw(path, value !== false, 'The change shows in the reply that narrates it')}
            <span class="evo-hint">Off: the new content waits until a reply confirms the Action, for a slow reveal the model must not know before it commits.</span></div>`;

    // A label with the Edit tab's expand button: long text is edited full screen, as the Edit tab does it.
    const labelWithExpand = (label, path) => `
        <div class="evo-label-row"><span class="evo-label">${label}</span>
            <button type="button" class="evo-expand" data-act="expand" data-for="${path}" data-label="${esc(label)}" title="Expand editor"><i class="fa-solid fa-expand"></i></button></div>`;

    // What a Field's summary line says about it, kept current as it is edited.
    const pillsHtml = (f) => [
        f.startsOn ? 'starts on' : 'starts off',
        f.activating.keywords.length ? 'activating' : '',
        f.enabling.keywords.length ? 'enabling' : '',
        f.disabling.keywords.length ? 'disabling' : '',
        f.entryAction || f.exitAction ? 'actions' : '',
    ].filter(Boolean).map(t => `<span class="evo-pill">${t}</span>`).join('');

    function fieldHtml(f, fi, count) {
        const p = `alterEgos.${egoIndex}.fields.${fi}`;
        return `
        <details class="evo-field" data-field="${fi}">
            <summary><span class="evo-field-name">${esc(f.name || 'Untitled')}</span><span class="evo-pills">${pillsHtml(f)}</span></summary>
            <div class="evo-field-body">
                <div class="evo-row"><span class="evo-label">Name</span><input class="cl-input" data-path="${p}.name" value="${esc(f.name)}"></div>
                <div class="evo-row">${labelWithExpand('Content', `${p}.content`)}
                    <textarea class="glass-input evo-long" rows="4" data-path="${p}.content">${esc(f.content)}</textarea></div>
                ${sw(`${p}.startsOn`, f.startsOn, 'On at the start of a chat')}
                ${reads(`${p}.sources`, f.sources)}
                ${trigger(`${p}.activating`, 'Activating Trigger', 'While set, the Field is in the prompt only when one of these is in the recent messages (the Window).', f.activating)}
                ${trigger(`${p}.enabling`, 'Enabling Trigger', 'Switches the Field on when the newest message says one of these.', f.enabling)}
                ${trigger(`${p}.disabling`, 'Disabling Trigger', 'Switches it off. When both match in one message, this one wins.', f.disabling)}
                ${action(`${p}.entry`, 'Entry Action', 'Asked of the next reply when the Field switches on; its content follows once a reply confirms it.', f.entryAction, f.entryConfirm)}
                ${action(`${p}.exit`, 'Exit Action', 'Asked of the next reply when the Field switches off.', f.exitAction, f.exitConfirm)}
                ${withActionSwitch(`${p}.withAction`, f.withAction)}
                <div class="evo-buttons">
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="up" ${fi === 0 ? 'disabled' : ''} title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="down" ${fi === count - 1 ? 'disabled' : ''} title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="dup-field"><i class="fa-solid fa-copy"></i> Duplicate</button>
                    <button type="button" class="cl-btn cl-btn-secondary evo-danger" data-act="del-field"><i class="fa-solid fa-trash"></i> Delete</button>
                </div>
            </div>
        </details>`;
    }

    function avatarHtml(ego) {
        const thumb = owner.avatar.thumb(ego.avatar);
        const shown = thumb ? `<img class="evo-avatar" src="${esc(thumb)}" alt="">` : '<span class="evo-avatar evo-avatar-own"><i class="fa-solid fa-user"></i></span>';
        const key = JSON.stringify(ego.avatar ?? null);
        const grid = gallery === null ? '' : gallery.length
            ? `<div class="evo-gallery">${gallery.map((c, i) => `<button type="button" class="evo-gallery-pick ${JSON.stringify(c.avatar) === key ? 'is-on' : ''}" data-act="pick-avatar" data-choice="${i}">
                <img src="${esc(c.thumb)}" alt="${esc(c.label)}" loading="lazy"></button>`).join('')}</div>`
            : `<p class="evo-hint">${esc(owner.avatar.emptyHint)}</p>`;
        return `
            <div class="evo-avatar-row">${shown}
                <div class="evo-buttons">
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="own-avatar" ${thumb ? '' : 'disabled'}>${esc(owner.avatar.ownLabel)}</button>
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="gallery">Choose a picture</button>
                    ${owner.avatar.upload ? '<label class="cl-btn cl-btn-secondary evo-upload"><i class="fa-solid fa-upload"></i> Upload<input type="file" accept="image/*" data-act="upload" hidden></label>' : ''}
                </div>
            </div>${grid}`;
    }

    function egoHtml(ego) {
        const p = `alterEgos.${egoIndex}`;
        const first = egoIndex === 0;
        return `
        <details class="evo-ego" ${first ? '' : 'open'}>
            <summary>Alter Ego settings</summary>
            <div class="evo-field-body">
                <div class="evo-row"><span class="evo-label">Name</span><input class="cl-input" data-path="${p}.name" value="${esc(ego.name)}"></div>
                ${first ? '<p class="evo-hint">The first Alter Ego is where every chat starts.</p>' : ''}
                ${trigger(`${p}.entry`, 'Entry Trigger', 'Makes this the active Alter Ego when the newest message says one of these.', ego.entry)}
                ${reads(`${p}.entrySources`, ego.entrySources)}
                ${action(`${p}.entry`, 'Entry Action', 'Asked of the next reply when this Alter Ego takes over.', ego.entryAction, ego.entryConfirm)}
                ${action(`${p}.exit`, 'Exit Action', 'Asked of the next reply when another Alter Ego takes over from this one.', ego.exitAction, ego.exitConfirm)}
                ${withActionSwitch(`${p}.withAction`, ego.withAction)}
                <div class="evo-row"><span class="evo-label">Prompt Name</span><input class="cl-input" data-path="${p}.promptName" data-kind="nullable" value="${esc(ego.promptName)}" placeholder="${esc(owner.name)}">
                    <span class="evo-hint">What the prompt says ${esc(owner.name)} is going by while this Alter Ego is active.</span></div>
                <div class="evo-row"><span class="evo-label">Name on messages</span><input class="cl-input" data-path="${p}.displayName" data-kind="nullable" value="${esc(ego.displayName)}" placeholder="${esc(owner.name)}"></div>
                <div class="evo-row"><span class="evo-label">Avatar on messages</span>${avatarHtml(ego)}</div>
            </div>
        </details>`;
    }

    function settingsHtml() {
        const s = def.settings || {};
        const g = (k) => ctx.settings.get(k);
        return `
        <details class="evo-ego">
            <summary>This ${owner.noun}'s settings</summary>
            <div class="evo-field-body">
                <p class="evo-hint">Left blank, a setting follows Settings › Extensions › Evolutia.</p>
                <div class="evo-row"><span class="evo-label">Window (recent messages Activating Triggers read)</span><input type="number" min="1" max="50" class="cl-input evo-num" data-path="settings.window" data-kind="number" value="${esc(s.window ?? '')}" placeholder="${esc(g('window'))}"></div>
                <div class="evo-row"><span class="evo-label">Replies an unconfirmed Action is asked of</span><input type="number" min="1" max="10" class="cl-input evo-num" data-path="settings.tries" data-kind="number" value="${esc(s.tries ?? '')}" placeholder="${esc(g('tries'))}"></div>
                <div class="evo-row"><span class="evo-label">Action Template</span><input class="cl-input" data-path="settings.template" data-kind="nullable" value="${esc(s.template ?? '')}" placeholder="${esc(g('template'))}"></div>
            </div>
        </details>`;
    }

    // Save and Revert at the foot of the editor, where Sigma's own dialogs keep their actions; not pinned: the
    // details scroll as one page, and a pinned bar would fight the tab strip and the header that slides away.
    const saveBarHtml = () => `
        <div class="evo-save ${dirty() ? 'is-dirty' : ''}">
            <span class="evo-hint">${dirty() ? 'Unsaved changes' : 'Saved'}</span>
            <button type="button" class="cl-btn cl-btn-secondary" data-act="revert" ${dirty() ? '' : 'disabled'}>Revert</button>
            <button type="button" class="cl-btn" data-act="save" ${dirty() ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>`;

    function render() {
        const head = `
            <div class="evo-head">
                <label class="evo-switch"><input type="checkbox" class="cl-switch-input" data-act="toggle" ${on ? 'checked' : ''}><span class="cl-switch" aria-hidden="true"></span>
                    <span>Use Evolutia on this ${owner.noun}</span></label>
                <span class="evo-hint">On, the ${owner.noun}'s ${owner.descLabel} becomes <code>${owner.macro}</code> and its text is kept; off brings it back.${def ? '' : ` Switching on makes one Field per <code>##</code> heading of the ${owner.descLabel}.`}</span>
            </div>`;
        if (!def) { pane.innerHTML = `<div class="evo-editor">${head}</div>`; return; }
        const ego = def.alterEgos[egoIndex];
        pane.innerHTML = `
            <div class="evo-editor">
                ${head}
                <div class="evo-egos">
                    ${def.alterEgos.map((e, i) => `<button type="button" class="evo-chip ${i === egoIndex ? 'is-on' : ''}" data-act="ego" data-ego="${i}">${esc(e.name || 'Untitled')}</button>`).join('')}
                    <button type="button" class="evo-chip" data-act="add-ego" title="New Alter Ego, copied from this one"><i class="fa-solid fa-plus"></i> Alter Ego</button>
                    ${def.alterEgos.length > 1 ? '<button type="button" class="evo-chip evo-danger" data-act="del-ego" title="Delete this Alter Ego"><i class="fa-solid fa-trash"></i></button>' : ''}
                </div>
                ${egoHtml(ego)}
                <h4 class="evo-section">Fields <span class="evo-hint">in prompt order</span></h4>
                ${egoIndex === 0 && hasHeadings(sourceDescription()) ? `<button type="button" class="cl-btn cl-btn-secondary" data-act="rebuild">
                    <i class="fa-solid fa-arrows-rotate"></i> Rebuild Fields from the ${owner.descLabel}'s headings</button>` : ''}
                ${ego.fields.map((f, i) => fieldHtml(f, i, ego.fields.length)).join('') || '<p class="evo-hint">No Fields yet.</p>'}
                <button type="button" class="cl-btn cl-btn-secondary" data-act="add-field"><i class="fa-solid fa-plus"></i> Field</button>
                ${settingsHtml()}
                ${saveBarHtml()}
            </div>`;
        // the app's own dropdowns: a bare <select> keeps the browser's look
        for (const select of pane.querySelectorAll('select')) CoreAPI.initCustomSelect(select);
        for (const box of pane.querySelectorAll('textarea.evo-keywords')) fit(box);
    }

    // A keyword box as tall as its text (where the browser has no field-sizing), so it never scrolls inside.
    const sizesItself = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
    function fit(box) {
        if (sizesItself) return;
        box.style.height = 'auto';
        box.style.height = `${box.scrollHeight + 2}px`;
    }

    // Re-render, keeping the open Fields open and the scroll where it was.
    function rerender() {
        const open = [...pane.querySelectorAll('details[open]')].map(d => d.dataset.field ?? d.querySelector('summary')?.textContent);
        const top = pane.scrollTop;
        render();
        for (const d of pane.querySelectorAll('details')) if (open.includes(d.dataset.field ?? d.querySelector('summary')?.textContent)) d.open = true;
        pane.scrollTop = top;
    }
    const markDirty = () => {
        for (const bar of pane.querySelectorAll('.evo-save')) {
            bar.classList.toggle('is-dirty', dirty());
            bar.querySelector('.evo-hint').textContent = dirty() ? 'Unsaved changes' : 'Saved';
            for (const b of bar.querySelectorAll('button')) b.disabled = !dirty();
        }
    };

    // ---- edits

    pane.addEventListener('input', (e) => {
        if (e.target.matches?.('textarea.evo-keywords')) fit(e.target);
        const path = e.target.dataset?.path;
        if (!path || !def) return;
        const t = e.target, kind = t.dataset.kind;
        if (t.type === 'checkbox') setPath(def, path, t.checked);
        else if (kind === 'keywords') setPath(def, path, { keywords: parseKeywords(t.value), mode: getPath(def, path)?.mode || 'ANY' });
        else if (kind === 'nullable') setPath(def, path, t.value.trim() ? t.value : null);
        else if (kind === 'number') setPath(def, path, t.value === '' ? null : Number(t.value));
        else if (path.endsWith('.mode')) setPath(def, path.slice(0, -5), { keywords: getPath(def, path.slice(0, -5))?.keywords || [], mode: t.value });
        else setPath(def, path, t.value);
        const fieldEl = t.closest('.evo-field');
        if (fieldEl) fieldEl.querySelector('.evo-pills').innerHTML = pillsHtml(def.alterEgos[egoIndex].fields[Number(fieldEl.dataset.field)]);
        if (path.endsWith('.name')) {
            const chip = pane.querySelector('.evo-chip.is-on');
            const field = t.closest('.evo-field')?.querySelector('.evo-field-name');
            if (field) field.textContent = t.value || 'Untitled';
            else if (chip) chip.textContent = t.value || 'Untitled';
        }
        markDirty();
    });

    pane.addEventListener('toggle', (e) => {
        if (e.target.open) for (const box of e.target.querySelectorAll('textarea.evo-keywords')) fit(box);
    }, true);

    pane.addEventListener('change', async (e) => {
        if (e.target.dataset?.act === 'toggle') await toggle(e.target.checked);
        if (e.target.dataset?.act === 'upload' && e.target.files?.[0]) await upload(e.target.files[0]);
    });

    pane.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const ego = def?.alterEgos[egoIndex];
        const fi = Number(b.closest('.evo-field')?.dataset.field);
        switch (b.dataset.act) {
            case 'save': return save();
            case 'revert': def = JSON.parse(saved); egoIndex = Math.min(egoIndex, def.alterEgos.length - 1); return rerender();
            case 'ego': egoIndex = Number(b.dataset.ego); gallery = null; return rerender();
            case 'add-ego': {
                const copy = structuredClone(ego);
                copy.id = idFor(`${ego.name} copy`, new Set(def.alterEgos.map(x => x.id)));
                copy.name = `${ego.name} (copy)`;
                def.alterEgos.push(copy);
                egoIndex = def.alterEgos.length - 1;
                return rerender();
            }
            case 'del-ego':
                if (!confirm(`Delete the Alter Ego "${ego.name}" and its Fields?`)) return;
                def.alterEgos.splice(egoIndex, 1);
                egoIndex = Math.max(0, egoIndex - 1);
                return rerender();
            case 'add-field': {
                const taken = new Set(ego.fields.map(f => f.id));
                ego.fields.push(blankField(idFor('field', taken), 'New Field'));
                rerender();
                pane.querySelector(`.evo-field[data-field="${ego.fields.length - 1}"]`)?.setAttribute('open', '');
                return;
            }
            case 'dup-field': {
                const copy = structuredClone(ego.fields[fi]);
                copy.id = idFor(copy.id, new Set(ego.fields.map(f => f.id)));
                copy.name = `${copy.name} (copy)`;
                ego.fields.splice(fi + 1, 0, copy);
                return rerender();
            }
            case 'del-field':
                if (!confirm(`Delete the Field "${ego.fields[fi].name}"?`)) return;
                ego.fields.splice(fi, 1);
                return rerender();
            case 'up': case 'down': {
                const to = b.dataset.act === 'up' ? fi - 1 : fi + 1;
                [ego.fields[fi], ego.fields[to]] = [ego.fields[to], ego.fields[fi]];
                return rerender();
            }
            case 'expand': return expand(b.dataset.for, b.dataset.label);
            case 'rebuild':
                if (!confirm(REBUILD_ASK)) return;
                def = rebuildFromDescription(def, sourceDescription());
                CoreAPI.showToast('Fields rebuilt: check them, then Save', 'info');
                return rerender();
            case 'own-avatar': ego.avatar = null; return rerender();
            case 'gallery': return openGallery();
            case 'pick-avatar': ego.avatar = gallery[Number(b.dataset.choice)].avatar; return rerender();
        }
    });

    async function openGallery() {
        try { gallery = await owner.avatar.choices(); }
        catch (e) { CoreAPI.showToast(`Could not read the pictures: ${e.message}`, 'error'); gallery = []; }
        rerender();
    }

    async function upload(file) {
        try {
            def.alterEgos[egoIndex].avatar = await owner.avatar.upload(file);
            gallery = null;
            rerender();
        } catch (e) { CoreAPI.showToast(`Could not upload the picture: ${e.message}`, 'error'); }
    }

    async function save() {
        try {
            await owner.saveDefinition(def);
            saved = JSON.stringify(def);
            markDirty();
            CoreAPI.showToast('Evolutia saved', 'success');
        } catch (e) { CoreAPI.showToast(`Could not save: ${e.message}`, 'error'); }
    }

    // The full-screen editor: the box's text in the app's own expanded-field look; Apply puts it back in the box.
    function expand(path, label) {
        const box = pane.querySelector(`textarea[data-path="${CSS.escape(path)}"]`);
        if (!box) return;
        const body = bigEditor.open({ title: label });
        body.classList.add('expand-field-body');
        body.innerHTML = `
            <textarea class="glass-input expand-field-textarea evo-big"></textarea>
            <div class="evo-buttons evo-big-buttons">
                <button type="button" class="cl-btn cl-btn-secondary" data-big="cancel">Cancel</button>
                <button type="button" class="cl-btn cl-btn-primary" data-big="apply"><i class="fa-solid fa-check"></i> Apply</button>
            </div>`;
        const big = body.querySelector('textarea');
        big.value = box.value;
        big.focus();
        body.onclick = (e) => {
            const which = e.target.closest('[data-big]')?.dataset.big;
            if (which === 'apply') {
                box.value = big.value;
                box.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (which) bigEditor.close({ force: true });
        };
    }

    async function toggle(want) {
        if (!want && dirty() && !confirm('Switch Evolutia off? Your unsaved changes are saved first.')) { render(); return; }
        try {
            if (dirty()) await save();
            // Fields already saved, and a description with headings (made after them, likely): offer to read them again
            const rebuilt = want && !on && def && hasHeadings(got.description) && confirm(REBUILD_ASK)
                ? rebuildFromDescription(def, got.description) : null;
            await owner.setOn(want, def, rebuilt);
            CoreAPI.showToast(want ? `Evolutia is on: the ${owner.descLabel} is now ${owner.macro}` : `Evolutia is off: the ${owner.descLabel} is back`, 'success');
            await load();
        } catch (e) { CoreAPI.showToast(`Could not switch Evolutia: ${e.message}`, 'error'); render(); }
    }

    load();
    return { dirty };
}
