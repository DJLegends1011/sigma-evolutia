// The Evolutia tab in a character's details: switching Evolutia on, and editing Alter Egos and their Fields.
import { blankField, idFor, switchPatch } from './core/definition.js';

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

export function mountEditor(pane, character, ctx) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    const call = ctx.server.call;
    const charId = character.id;
    let on = false, def = null, card = null, saved = '', egoIndex = 0, gallery = null;

    const dirty = () => JSON.stringify(def) !== saved;

    async function load() {
        pane.innerHTML = '<p class="evo-muted">Loading…</p>';
        try {
            const got = await call(`/characters/${encodeURIComponent(charId)}`);
            on = got.on;
            def = got.definition;
            card = got.card;
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
            <label><input type="checkbox" data-path="${path}.char" ${sources?.char ? 'checked' : ''}> <span>${esc(character.name)}'s messages</span></label>
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
            <span class="evo-label">${label}</span>
            <textarea class="cl-input" rows="2" data-path="${path}Action" data-kind="nullable" placeholder="Optional">${esc(text)}</textarea>
            <span class="evo-hint">${hint}</span>
            <span class="evo-label evo-sub">Confirmed by a reply containing</span>
            <textarea class="cl-input evo-keywords" rows="1" data-path="${path}Confirm" data-kind="keywords" placeholder="Any reply counts">${esc(keywordsText(confirm))}</textarea>
        </div>`;

    function fieldHtml(f, fi, count) {
        const p = `alterEgos.${egoIndex}.fields.${fi}`;
        const pills = [
            f.startsOn ? 'starts on' : 'starts off',
            f.activating.keywords.length ? 'activating' : '',
            f.enabling.keywords.length ? 'enabling' : '',
            f.disabling.keywords.length ? 'disabling' : '',
            f.entryAction || f.exitAction ? 'actions' : '',
        ].filter(Boolean).map(t => `<span class="evo-pill">${t}</span>`).join('');
        return `
        <details class="evo-field" data-field="${fi}">
            <summary><span class="evo-field-name">${esc(f.name || 'Untitled')}</span>${pills}</summary>
            <div class="evo-field-body">
                <div class="evo-row"><span class="evo-label">Name</span><input class="cl-input" data-path="${p}.name" value="${esc(f.name)}"></div>
                <div class="evo-row"><span class="evo-label">Content</span>
                    <textarea class="cl-input evo-content" rows="5" data-path="${p}.content">${esc(f.content)}</textarea></div>
                ${sw(`${p}.startsOn`, f.startsOn, 'On at the start of a chat')}
                ${reads(`${p}.sources`, f.sources)}
                ${trigger(`${p}.activating`, 'Activating Trigger', 'While set, the Field is in the prompt only when one of these is in the recent messages (the Window).', f.activating)}
                ${trigger(`${p}.enabling`, 'Enabling Trigger', 'Switches the Field on when the newest message says one of these.', f.enabling)}
                ${trigger(`${p}.disabling`, 'Disabling Trigger', 'Switches it off. When both match in one message, this one wins.', f.disabling)}
                ${action(`${p}.entry`, 'Entry Action', 'Asked of the next reply when the Field switches on; its content follows once a reply confirms it.', f.entryAction, f.entryConfirm)}
                ${action(`${p}.exit`, 'Exit Action', 'Asked of the next reply when the Field switches off.', f.exitAction, f.exitConfirm)}
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
        const media = ego.avatar?.media;
        const thumb = media ? `<img class="evo-avatar" src="${esc(CoreAPI.thumbUrl('media', media, 96))}" alt="">` : '<span class="evo-avatar evo-avatar-own"><i class="fa-solid fa-user"></i></span>';
        const grid = gallery === null ? '' : gallery.length
            ? `<div class="evo-gallery">${gallery.map(m => `<button type="button" class="evo-gallery-pick ${m.id === media ? 'is-on' : ''}" data-act="pick-avatar" data-media="${m.id}">
                <img src="${esc(CoreAPI.thumbUrl('media', m.id, 96))}" alt="${esc(m.displayName)}" loading="lazy"></button>`).join('')}</div>`
            : '<p class="evo-hint">This card\'s gallery has no pictures yet.</p>';
        return `
            <div class="evo-avatar-row">${thumb}
                <div class="evo-buttons">
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="own-avatar" ${media ? '' : 'disabled'}>Card's own</button>
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="gallery">From the gallery</button>
                    <label class="cl-btn cl-btn-secondary evo-upload"><i class="fa-solid fa-upload"></i> Upload<input type="file" accept="image/*" data-act="upload" hidden></label>
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
                <div class="evo-row"><span class="evo-label">Prompt Name</span><input class="cl-input" data-path="${p}.promptName" data-kind="nullable" value="${esc(ego.promptName)}" placeholder="${esc(character.name)}">
                    <span class="evo-hint">What the prompt says ${esc(character.name)} is going by while this Alter Ego is active.</span></div>
                <div class="evo-row"><span class="evo-label">Name on messages</span><input class="cl-input" data-path="${p}.displayName" data-kind="nullable" value="${esc(ego.displayName)}" placeholder="${esc(character.name)}"></div>
                <div class="evo-row"><span class="evo-label">Avatar on messages</span>${avatarHtml(ego)}</div>
            </div>
        </details>`;
    }

    function settingsHtml() {
        const s = def.settings || {};
        const g = (k) => ctx.settings.get(k);
        return `
        <details class="evo-ego">
            <summary>This card's settings</summary>
            <div class="evo-field-body">
                <p class="evo-hint">Left blank, a setting follows Settings › Extensions › Evolutia.</p>
                <div class="evo-row"><span class="evo-label">Window (recent messages Activating Triggers read)</span><input type="number" min="1" max="50" class="cl-input evo-num" data-path="settings.window" data-kind="number" value="${esc(s.window ?? '')}" placeholder="${esc(g('window'))}"></div>
                <div class="evo-row"><span class="evo-label">Replies an unconfirmed Action is asked of</span><input type="number" min="1" max="10" class="cl-input evo-num" data-path="settings.tries" data-kind="number" value="${esc(s.tries ?? '')}" placeholder="${esc(g('tries'))}"></div>
                <div class="evo-row"><span class="evo-label">Action Template</span><input class="cl-input" data-path="settings.template" data-kind="nullable" value="${esc(s.template ?? '')}" placeholder="${esc(g('template'))}"></div>
            </div>
        </details>`;
    }

    function render() {
        const head = `
            <div class="evo-head">
                <label class="evo-switch"><input type="checkbox" class="cl-switch-input" data-act="toggle" ${on ? 'checked' : ''}><span class="cl-switch" aria-hidden="true"></span>
                    <span>Use Evolutia on this card</span></label>
                <span class="evo-hint">On, the card's Description becomes <code>{{evolutia}}</code> and its text is kept; off brings it back.${def ? '' : ' Switching on makes one Field per <code>##</code> heading of the Description.'}</span>
            </div>`;
        if (!def) { pane.innerHTML = `<div class="evo-editor">${head}</div>`; return; }
        const ego = def.alterEgos[egoIndex];
        pane.innerHTML = `
            <div class="evo-editor">
                ${head}
                <div class="evo-save ${dirty() ? 'is-dirty' : ''}">
                    <span class="evo-hint">${dirty() ? 'Unsaved changes' : 'Saved'}</span>
                    <button type="button" class="cl-btn cl-btn-secondary" data-act="revert" ${dirty() ? '' : 'disabled'}>Revert</button>
                    <button type="button" class="cl-btn" data-act="save" ${dirty() ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk"></i> Save</button>
                </div>
                <div class="evo-egos">
                    ${def.alterEgos.map((e, i) => `<button type="button" class="evo-chip ${i === egoIndex ? 'is-on' : ''}" data-act="ego" data-ego="${i}">${esc(e.name || 'Untitled')}</button>`).join('')}
                    <button type="button" class="evo-chip" data-act="add-ego" title="New Alter Ego, copied from this one"><i class="fa-solid fa-plus"></i> Alter Ego</button>
                    ${def.alterEgos.length > 1 ? '<button type="button" class="evo-chip evo-danger" data-act="del-ego" title="Delete this Alter Ego"><i class="fa-solid fa-trash"></i></button>' : ''}
                </div>
                ${egoHtml(ego)}
                <h4 class="evo-section">Fields <span class="evo-hint">in prompt order</span></h4>
                ${ego.fields.map((f, i) => fieldHtml(f, i, ego.fields.length)).join('') || '<p class="evo-hint">No Fields yet.</p>'}
                <button type="button" class="cl-btn cl-btn-secondary" data-act="add-field"><i class="fa-solid fa-plus"></i> Field</button>
                ${settingsHtml()}
            </div>`;
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
        const bar = pane.querySelector('.evo-save');
        if (!bar) return;
        bar.classList.toggle('is-dirty', dirty());
        bar.querySelector('.evo-hint').textContent = dirty() ? 'Unsaved changes' : 'Saved';
        for (const b of bar.querySelectorAll('button')) b.disabled = !dirty();
    };

    // ---- edits

    pane.addEventListener('input', (e) => {
        const path = e.target.dataset?.path;
        if (!path || !def) return;
        const t = e.target, kind = t.dataset.kind;
        if (t.type === 'checkbox') setPath(def, path, t.checked);
        else if (kind === 'keywords') setPath(def, path, { keywords: parseKeywords(t.value), mode: getPath(def, path)?.mode || 'ANY' });
        else if (kind === 'nullable') setPath(def, path, t.value.trim() ? t.value : null);
        else if (kind === 'number') setPath(def, path, t.value === '' ? null : Number(t.value));
        else if (path.endsWith('.mode')) setPath(def, path.slice(0, -5), { keywords: getPath(def, path.slice(0, -5))?.keywords || [], mode: t.value });
        else setPath(def, path, t.value);
        if (path.endsWith('.name')) {
            const chip = pane.querySelector('.evo-chip.is-on');
            const field = t.closest('.evo-field')?.querySelector('.evo-field-name');
            if (field) field.textContent = t.value || 'Untitled';
            else if (chip) chip.textContent = t.value || 'Untitled';
        }
        markDirty();
    });

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
            case 'own-avatar': ego.avatar = null; return rerender();
            case 'gallery': return openGallery();
            case 'pick-avatar': ego.avatar = { media: Number(b.dataset.media) }; return rerender();
        }
    });

    async function openGallery() {
        try {
            const res = await CoreAPI.apiRequest(`/characters/${encodeURIComponent(charId)}/media?limit=100&count=false`);
            const page = await res.json();
            gallery = (page.items || []).filter(m => m.kind !== 'video');
        } catch (e) { CoreAPI.showToast(`Could not read the gallery: ${e.message}`, 'error'); gallery = []; }
        rerender();
    }

    async function upload(file) {
        try {
            const res = await CoreAPI.apiRequest(`/characters/${encodeURIComponent(charId)}/media?name=${encodeURIComponent(file.name)}`, 'POST', file,
                { raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || res.status);
            def.alterEgos[egoIndex].avatar = { media: body.duplicateOf ?? body.id };
            gallery = null;
            rerender();
        } catch (e) { CoreAPI.showToast(`Could not upload the picture: ${e.message}`, 'error'); }
    }

    // Card writes go through the app's own character.update, so the details know the edit for their own.
    const update = async (fields) => {
        const done = await ctx.commands.run('character.update', { id: charId, fields, source: 'evolutia' });
        if (done?.ok === false) throw new Error('the card write was refused');
    };

    async function save() {
        try {
            await update({ 'extensions.evolutia.definition': def });
            saved = JSON.stringify(def);
            markDirty();
            CoreAPI.showToast('Evolutia saved', 'success');
        } catch (e) { CoreAPI.showToast(`Could not save: ${e.message}`, 'error'); }
    }

    // The details paint the Description, and the Edit form takes it, only when the card opens; re-opening
    // rebuilds every tab (a flash), so the two are brought up to the new Description in place instead. No door
    // for either: absent markup is skipped, and a Description box with the reader's own typing is left alone.
    function showDescription(was, now) {
        const shown = document.getElementById('modalDescription');
        if (shown) shown.innerHTML = CoreAPI.safePurify(CoreAPI.formatRichText(now, character.name));
        const box = document.getElementById('editDescription');
        if (box && box.value !== now) {
            if (box.value === was) box.value = now;
            else CoreAPI.showToast('The Edit tab holds your unsaved Description: re-open the card before saving it', 'warning');
        }
    }

    async function toggle(want) {
        if (!want && dirty() && !confirm('Switch Evolutia off? Your unsaved changes are saved first.')) { render(); return; }
        try {
            if (dirty()) await save();
            const fields = switchPatch({ ...card, extensions: { evolutia: { ...card.extensions.evolutia, definition: def } } }, want);
            if (fields) {
                await update(fields);
                showDescription(card.description, fields.description);
            }
            CoreAPI.showToast(want ? 'Evolutia is on: the Description is now {{evolutia}}' : 'Evolutia is off: the Description is back', 'success');
            await load();
        } catch (e) { CoreAPI.showToast(`Could not switch Evolutia: ${e.message}`, 'error'); render(); }
    }

    load();
    return { dirty };
}
