// The Evolutia glassmorphic card editor, for a card (its details tab or chat window tab) or a persona
// (Settings › Chat or chat window tab): switching Evolutia on, managing Alter Egos, and editing Dynamic Fields.
import { blankField, blankAlterEgo, idFor, definitionFromDescription, rebuildFromDescription } from './core/definition.js';

function estimateTokens(text = '') {
    const s = String(text ?? '').trim();
    return s ? Math.max(1, Math.ceil(s.length / 4)) : 0;
}

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

function avatarModeOf(avatar) {
    if (!avatar) return 'inherit';
    if (avatar.character) return 'character';
    if (avatar.media || avatar.persona) return 'gallery';
    if (avatar.upload) return 'upload';
    if (avatar.url) return 'url';
    return 'inherit';
}

// Copying an Alter Ego to the other owner (a Persona or a card): when the target already has one of
// that name (case-insensitive, trimmed), the choice decides — 'replace' overwrites it but keeps its
// id so chats tracking it keep working, 'copy' appends a renamed duplicate ("<Name> (2)", then (3)…),
// 'cancel' (or anything else) touches nothing. Without a conflict the Alter Ego is simply added.
// Pure on purpose: the dialog (or onCopyConflict) asks, this applies, the tests check.
export function resolveCopyAlterEgo(targetDef, ego, { ownerNoun, ownerCharId, targetNoun, choice } = {}) {
    if (!targetDef) return null;
    targetDef.alterEgos ||= [];
    const key = String(ego.name || '').trim().toLowerCase();
    const existingIdx = targetDef.alterEgos.findIndex(x => String(x.name || '').trim().toLowerCase() === key);

    const prepare = () => {
        const copy = structuredClone(ego);
        delete copy._uiAvatarMode;
        copy.id = idFor(ego.name || 'ego', new Set(targetDef.alterEgos.map(x => x.id)));
        const takenFields = new Set();
        for (const f of copy.fields || []) {
            f.id = idFor(f.name || f.id || 'field', takenFields);
            takenFields.add(f.id);
        }
        if (targetNoun === 'persona' && ownerNoun === 'card') {
            copy.disguise = true;
            if (!copy.promptName && ego.name) copy.promptName = ego.name;
            if (!copy.avatar && ownerCharId) copy.avatar = { character: ownerCharId };
        }
        return copy;
    };

    if (existingIdx < 0 || !choice) {
        const copy = prepare();
        targetDef.alterEgos.push(copy);
        return { ego: copy, index: targetDef.alterEgos.length - 1, mode: 'add' };
    }
    if (choice === 'replace') {
        const copy = prepare();
        copy.id = targetDef.alterEgos[existingIdx].id; // the id chats track this Alter Ego by
        targetDef.alterEgos[existingIdx] = copy;
        return { ego: copy, index: existingIdx, mode: 'replace' };
    }
    if (choice === 'copy') {
        const copy = prepare();
        const takenNames = new Set(targetDef.alterEgos.map(x => String(x.name || '').trim().toLowerCase()));
        let n = 2;
        while (takenNames.has(`${copy.name} (${n})`.trim().toLowerCase())) n++;
        copy.name = `${copy.name} (${n})`;
        copy.id = idFor(copy.name, new Set(targetDef.alterEgos.map(x => x.id)));
        targetDef.alterEgos.push(copy);
        return { ego: copy, index: targetDef.alterEgos.length - 1, mode: 'copy' };
    }
    return null; // cancel: the target keeps what it has
}

// The editor of one owner's Field Definitions (a card's or a persona's, see owners.js).
export function mountEditor(hostPane, owner, ctx, { bigEditor, onChanged, liveSide = null, onLiveSwitch = null, otherOwner = null, onCopyConflict = null } = {}) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    // Isolate listeners on a fresh child node so host-reused panes (like #pane-ext.evolutia.evolutia
    // across Character Details opens or extension reloads) never accumulate duplicate event handlers.
    const pane = document.createElement('div');
    hostPane.replaceChildren(pane);
    let on = false, def = null, got = null, saved = '', egoIndex = 0, gallery = null, charList = null, saving = false;

    const dirty = () => JSON.stringify(def) !== saved;
    const sourceDescription = () => got?.source ?? '';

    // The 3-way ask when copying would duplicate a name in the other owner: Replace (keeps the
    // target's id), Add a copy, or Cancel. Falls back to a plain confirm without ctx.ui.dialog.
    let copyDialog = null;
    function askCopyConflict(name, target) {
        return new Promise((resolve) => {
            const done = (() => { let settled = false; return (choice) => { if (!settled) { settled = true; resolve(choice); } }; })();
            if (!ctx.ui?.dialog || typeof document === 'undefined') {
                done(confirm(`${target.noun === 'persona' ? 'Persona' : 'Character'} "${target.name}" already has an Alter Ego named "${name}". Replace it?`) ? 'replace' : 'cancel');
                return;
            }
            copyDialog ??= ctx.ui.dialog({ id: 'evo-copy-conflict', label: 'Copy Alter Ego', icon: 'fa-clone', onClose: () => done('cancel') });
            const body = copyDialog.open({ title: 'Copy Alter Ego' });
            const destLabel = target.noun === 'persona' ? `Persona (${target.name})` : `Character (${target.name})`;
            body.innerHTML = `
                <div class="evo-copy-conflict">
                    <p>${esc(destLabel)} already has an Alter Ego named <strong>${esc(name)}</strong>.</p>
                    <div class="evo-btn-row">
                        <button type="button" class="glass-btn glass-btn-sm" data-copy-choice="replace"><i class="fa-solid fa-rotate-right"></i> Replace</button>
                        <button type="button" class="glass-btn glass-btn-sm" data-copy-choice="copy"><i class="fa-solid fa-clone"></i> Add a copy</button>
                        <button type="button" class="glass-btn glass-btn-sm" data-copy-choice="cancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
                    </div>
                    <span class="evo-muted">Replace keeps this Alter Ego's id, so chats tracking it keep working. Add a copy makes a separate "<strong>${esc(name)}</strong> (2)".</span>
                </div>`;
            body.onclick = async (e) => {
                const b = e.target.closest('[data-copy-choice]');
                if (!b) return;
                done(b.dataset.copyChoice);
                try { await copyDialog.close(); } catch { /* already closed */ }
            };
        });
    }

    async function ensureCharList() {
        if (charList) return charList;
        try {
            const res = await CoreAPI.apiRequest('/characters?limit=500&count=false');
            const body = await res.json();
            charList = Array.isArray(body?.items) ? body.items : (Array.isArray(body) ? body : []);
        } catch {
            charList = [];
        }
        return charList;
    }

    async function load({ silent = false } = {}) {
        if (!silent && !got) {
            pane.innerHTML = '<div class="evo-window"><div class="evo-card"><span class="evo-muted">Loading…</span></div></div>';
        }
        try {
            const [loaded] = await Promise.all([owner.load(), ensureCharList()]);
            const hadDef = Boolean(def);
            got = loaded;
            on = got.on;
            def = got.definition;
            saved = JSON.stringify(def);
            if (def?.alterEgos?.length) {
                const liveEgoId = liveSide?.ego?.id;
                const liveIdx = liveEgoId ? def.alterEgos.findIndex(e => e.id === liveEgoId) : -1;
                egoIndex = liveIdx >= 0 ? liveIdx : Math.min(egoIndex, def.alterEgos.length - 1);
            } else {
                egoIndex = 0;
            }
            if (!silent || Boolean(def) !== hadDef) {
                rerender();
            } else {
                const toggleInput = pane.querySelector('input[data-act="toggle"]');
                if (toggleInput) toggleInput.checked = on;
            }
        } catch (e) {
            pane.innerHTML = `<div class="evo-window"><div class="evo-card"><span class="evo-error">Could not read Evolutia's data: ${esc(e.message)}</span></div></div>`;
        }
    }

    const sw = (path, checked, label, extraAttrs = '') => `
        <label class="evo-switch-label"><input type="checkbox" class="cl-switch-input" data-path="${path}" ${checked ? 'checked' : ''} ${extraAttrs}><span class="cl-switch" aria-hidden="true"></span><span>${label}</span></label>`;

    const reads = (path, sources) => `
        <div class="evo-reads"><span class="evo-label">Reads:</span>
            <label><input type="checkbox" data-path="${path}.user" ${sources?.user !== false ? 'checked' : ''}> <span>Your messages</span></label>
            <label><input type="checkbox" data-path="${path}.char" ${sources?.char !== false ? 'checked' : ''}> <span>${esc(owner.otherSide)}</span></label>
        </div>`;

    const labelWithExpand = (label, path) => `
        <div class="evo-label-row"><span class="evo-label">${label}</span>
            <button type="button" class="evo-expand" data-act="expand" data-for="${path}" data-label="${esc(label)}" title="Expand full-screen editor"><i class="fa-solid fa-expand"></i></button></div>`;

    function fieldSummaryBadges(f, liveField) {
        const badges = [];
        if (liveField) {
            if (liveField.inPrompt) badges.push('<span class="evo-pill evo-on"><i class="fa-solid fa-check"></i> in prompt</span>');
            else if (liveField.phase === 'entering') badges.push('<span class="evo-pill evo-entering">entering</span>');
            else if (liveField.phase === 'exiting') badges.push('<span class="evo-pill evo-exiting">exiting</span>');
        }
        if (f.activating?.keywords?.length) badges.push(`<span class="evo-pill">window: ${esc(keywordsText(f.activating))}</span>`);
        if (f.enabling?.keywords?.length) badges.push(`<span class="evo-pill">on: ${esc(keywordsText(f.enabling))}</span>`);
        if (f.disabling?.keywords?.length) badges.push(`<span class="evo-pill">off: ${esc(keywordsText(f.disabling))}</span>`);
        if (f.entryAction || f.exitAction) badges.push('<span class="evo-pill">actions</span>');
        return badges.join(' ');
    }

    function fieldCardHtml(f, fi, count, ego) {
        const p = `alterEgos.${egoIndex}.fields.${fi}`;
        const tokens = estimateTokens(f.content);
        const liveEgo = liveSide?.egos?.find(e => e.id === ego.id);
        const liveField = liveEgo?.fields?.find(lf => lf.id === f.id);
        const isCurrentlyOn = liveField ? (liveField.phase === 'on' || liveField.phase === 'entering') : Boolean(f.startsOn);
        const hasTriggersOrActions = Boolean(
            f.activating?.keywords?.length ||
            f.enabling?.keywords?.length ||
            f.disabling?.keywords?.length ||
            f.entryAction ||
            f.exitAction
        );
        const kwMode = f.activating?.mode === 'ALL' || f.enabling?.mode === 'ALL' || f.disabling?.mode === 'ALL' ? 'ALL' : 'ANY';

        return `
            <div class="evo-field-card ${isCurrentlyOn ? '' : 'is-disabled'}" data-field="${fi}">
                <div class="evo-field-head">
                    <label class="evo-switch-label" title="${liveField ? 'Toggle Field on/off in this chat (and default)' : 'On at the start of a chat'}">
                        <input type="checkbox" class="cl-switch-input" data-path="${p}.startsOn" data-live-field="${esc(f.id)}" data-live-ego="${esc(ego.id)}" ${isCurrentlyOn ? 'checked' : ''}>
                        <span class="cl-switch" aria-hidden="true"></span>
                    </label>
                    <input type="text" class="glass-input evo-field-name-input" data-path="${p}.name" value="${esc(f.name)}" placeholder="Field Name (e.g. Appearance, Outfit)">
                    <span class="evo-token-pill" data-token-pill="${fi}">~${tokens} tok</span>
                    <button type="button" class="glass-btn glass-btn-sm" data-act="expand" data-for="${p}.content" data-label="${esc(f.name || 'Field Content')}" title="Expand Editor"><i class="fa-solid fa-expand"></i></button>
                    <button type="button" class="glass-btn glass-btn-sm" data-act="up" ${fi === 0 ? 'disabled' : ''} title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
                    <button type="button" class="glass-btn glass-btn-sm" data-act="down" ${fi === count - 1 ? 'disabled' : ''} title="Move Down"><i class="fa-solid fa-arrow-down"></i></button>
                    <button type="button" class="glass-btn glass-btn-sm" data-act="dup-field" title="Duplicate Field"><i class="fa-solid fa-copy"></i></button>
                    <button type="button" class="glass-btn glass-btn-sm evo-danger" data-act="del-field" title="Delete Field"><i class="fa-solid fa-trash"></i></button>
                </div>
                <textarea class="glass-input evo-field-content" data-path="${p}.content" rows="3" placeholder="Enter ${esc(f.name || 'Field')} details...">${esc(f.content)}</textarea>
                <details class="evo-details" data-details="field-triggers-${fi}" ${hasTriggersOrActions ? 'open' : ''}>
                    <summary>
                        <i class="fa-solid fa-bolt"></i> Keyword Triggers & Actions
                        <span class="evo-pills" data-summary-pills="${fi}">${fieldSummaryBadges(f, liveField)}</span>
                    </summary>
                    <div class="evo-details-body">
                        <div class="evo-row">
                            <div class="evo-ego-select-col">
                                <span class="evo-label">Activating Keywords (In Window; Blank = Always Admitted)</span>
                                <input type="text" class="glass-input" data-path="${p}.activating" data-kind="keywords" value="${esc(keywordsText(f.activating))}" placeholder="comma-separated keywords or /regex/">
                            </div>
                            <div class="evo-ego-select-col" style="max-width:135px;">
                                <span class="evo-label">Match Mode</span>
                                <select class="cl-select-fluid" data-field-kw-mode="${fi}">
                                    <option value="ANY" ${kwMode !== 'ALL' ? 'selected' : ''}>Match Any</option>
                                    <option value="ALL" ${kwMode === 'ALL' ? 'selected' : ''}>Match All</option>
                                </select>
                            </div>
                        </div>
                        <div class="evo-row">
                            <div class="evo-ego-select-col">
                                <span class="evo-label">Enabling Keywords (Turns Field On)</span>
                                <input type="text" class="glass-input" data-path="${p}.enabling" data-kind="keywords" value="${esc(keywordsText(f.enabling))}" placeholder="e.g. what's wrong, stabbed, /regex/">
                            </div>
                            <div class="evo-ego-select-col">
                                <span class="evo-label">Disabling Keywords (Turns Field Off)</span>
                                <input type="text" class="glass-input" data-path="${p}.disabling" data-kind="keywords" value="${esc(keywordsText(f.disabling))}" placeholder="e.g. healed, bandaged">
                            </div>
                        </div>
                        <div class="evo-row-between">
                            ${reads(`${p}.sources`, f.sources)}
                            ${sw(`${p}.stripTriggers`, !!f.stripTriggers, 'Strip matched trigger keyword from sent message')}
                        </div>
                        <div class="evo-row">
                            <div class="evo-ego-select-col">
                                ${labelWithExpand('Entry Action (When Switched On)', `${p}.entryAction`)}
                                <textarea class="glass-input" rows="2" data-path="${p}.entryAction" data-kind="nullable" placeholder="Optional instruction for the next reply...">${esc(f.entryAction)}</textarea>
                                <input type="text" class="glass-input" data-path="${p}.entryConfirm" data-kind="keywords" value="${esc(keywordsText(f.entryConfirm))}" placeholder="Confirm keywords (blank = any reply confirms)">
                            </div>
                            <div class="evo-ego-select-col">
                                ${labelWithExpand('Exit Action (When Switched Off)', `${p}.exitAction`)}
                                <textarea class="glass-input" rows="2" data-path="${p}.exitAction" data-kind="nullable" placeholder="Optional instruction when turning off...">${esc(f.exitAction)}</textarea>
                                <input type="text" class="glass-input" data-path="${p}.exitConfirm" data-kind="keywords" value="${esc(keywordsText(f.exitConfirm))}" placeholder="Confirm keywords (blank = any reply confirms)">
                            </div>
                        </div>
                        ${sw(`${p}.withAction`, f.withAction !== false, 'Content With Action (Include new field content in the reply that narrates the action)')}
                    </div>
                </details>
            </div>`;
    }

    function renderAvatarSection(ego, p) {
        const mode = ego._uiAvatarMode || avatarModeOf(ego.avatar);
        const charIdRef = ego.avatar?.character || '';
        const urlRef = ego.avatar?.url || '';
        const charOptionsHtml = [
            '<option value="">— Select Library Character —</option>',
            ...(charList || []).map(c => `<option value="${esc(c.id)}" ${charIdRef === c.id ? 'selected' : ''}>${esc(c.name)}</option>`),
        ].join('');

        const key = JSON.stringify(ego.avatar ?? null);
        const galleryGridHtml = mode === 'gallery' && gallery
            ? (gallery.length
                ? `<div class="evo-gallery">${gallery.map((c, i) => `<button type="button" class="evo-gallery-pick ${JSON.stringify(c.avatar) === key ? 'is-on' : ''}" data-act="pick-avatar" data-choice="${i}" title="${esc(c.label)}">
                    <img src="${esc(c.thumb)}" alt="${esc(c.label)}" loading="lazy">
                    <span class="evo-gallery-caption">${esc(c.label)}</span></button>`).join('')}</div>`
                : `<span class="evo-hint">${esc(owner.avatar.emptyHint)}</span>`)
            : '';

        return `
            <div class="evo-row">
                <div class="evo-ego-select-col">
                    <span class="evo-label">Alter Ego Display Name</span>
                    <input type="text" class="glass-input" data-path="${p}.name" value="${esc(ego.name)}" placeholder="Display Name">
                </div>
                <div class="evo-ego-select-col">
                    <span class="evo-label">Avatar Portrait Source</span>
                    <select class="cl-select-fluid" data-act="avatar-mode">
                        <option value="inherit" ${mode === 'inherit' ? 'selected' : ''}>Inherit Base Portrait</option>
                        <option value="character" ${mode === 'character' ? 'selected' : ''}>Library Character Portrait</option>
                        <option value="gallery" ${mode === 'gallery' ? 'selected' : ''}>Card Gallery / Persona Portrait</option>
                        <option value="upload" ${mode === 'upload' ? 'selected' : ''}>Upload Custom Image</option>
                        <option value="url" ${mode === 'url' ? 'selected' : ''}>Custom Image URL</option>
                    </select>
                </div>
            </div>
            ${mode === 'character' ? `
                <div class="evo-ego-select-col">
                    <span class="evo-label">Linked Library Character Portrait</span>
                    <select class="cl-select-fluid" data-act="avatar-char-ref">${charOptionsHtml}</select>
                </div>
            ` : ''}
            ${mode === 'gallery' ? `
                <div class="evo-ego-select-col">
                    <span class="evo-label">Select Portrait</span>
                    ${galleryGridHtml || '<span class="evo-hint">Loading gallery…</span>'}
                </div>
            ` : ''}
            ${mode === 'upload' ? `
                <div class="evo-row-between">
                    <span class="evo-hint">${ego.avatar?.upload ? `Uploaded: ${esc(ego.avatar.upload)}` : 'Upload a PNG/JPG/WebP portrait for this Alter Ego.'}</span>
                    <label class="glass-btn glass-btn-sm evo-upload"><i class="fa-solid fa-upload"></i> Upload Image<input type="file" accept="image/*" data-act="upload" hidden></label>
                </div>
            ` : ''}
            ${mode === 'url' ? `
                <div class="evo-ego-select-col">
                    <span class="evo-label">Custom Portrait URL</span>
                    <input type="text" class="glass-input" data-act="avatar-url" value="${esc(urlRef)}" placeholder="https://... or /avatars/...">
                </div>
            ` : ''}
        `;
    }

    function render() {
        const ownerTitle = owner.noun === 'persona' ? 'Active Persona' : 'Character';
        if (!def) {
            pane.innerHTML = `
                <div class="evo-window">
                    <div class="evo-card">
                        <div class="evo-row-between">
                            <span class="evo-label">${ownerTitle}: <strong>${esc(owner.name)}</strong></span>
                            <label class="evo-switch-label">
                                <input type="checkbox" class="cl-switch-input" data-act="toggle" ${on ? 'checked' : ''}>
                                <span class="cl-switch" aria-hidden="true"></span>
                                <span>Active in Prompt</span>
                            </label>
                        </div>
                        <span class="evo-hint">Switch on <strong>Active in Prompt</strong> to split ${esc(owner.name)}'s ${esc(owner.descLabel)} into Dynamic Fields and Alter Egos (replacing the static ${esc(owner.descLabel)} with <code>${esc(owner.macro)}</code> while keeping the original text safe).</span>
                    </div>
                </div>`;
            return;
        }

        const ego = def.alterEgos[egoIndex] || def.alterEgos[0];
        const p = `alterEgos.${egoIndex}`;
        const thumb = owner.avatar.thumb(ego.avatar) || (owner.noun === 'card' && owner.charId ? `/avatars/${encodeURIComponent(owner.charId)}.png` : null);
        const avatarHtml = thumb
            ? `<img src="${esc(thumb)}" alt="${esc(ego.name)}">`
            : '<i class="fa-solid fa-masks-theater"></i>';
        const hasEgoTriggers = Boolean(ego.entry?.keywords?.length || ego.entryAction || ego.exitAction || ego.promptName || ego.displayName);
        const liveActiveEgoId = liveSide?.ego?.id;
        const isLiveActive = !liveActiveEgoId || liveActiveEgoId === ego.id;

        const s = def.settings || {};
        const g = (k) => ctx.settings.get(k);

        pane.innerHTML = `
            <div class="evo-window">
                <div class="evo-card">
                    <div class="evo-row-between">
                        <div>
                            <span class="evo-label">${ownerTitle}: <strong>${esc(owner.name)}</strong></span>
                        </div>
                        <label class="evo-switch-label" title="When enabled, ${esc(owner.name)}'s ${esc(owner.descLabel)} uses Evolutia (${esc(owner.macro)})">
                            <input type="checkbox" class="cl-switch-input" data-act="toggle" ${on ? 'checked' : ''}>
                            <span class="cl-switch" aria-hidden="true"></span>
                            <span>Active in Prompt</span>
                        </label>
                    </div>

                    <div class="evo-ego-header">
                        <div class="evo-ego-avatar-preview">${avatarHtml}</div>
                        <div class="evo-ego-select-col">
                            <span class="evo-label">Current Alter Ego ${liveActiveEgoId ? (isLiveActive ? '<span class="evo-pill evo-on">Active in Chat</span>' : '<span class="evo-pill">Editing</span>') : ''}</span>
                            <select class="cl-select-fluid" data-act="select-ego">
                                ${def.alterEgos.map((e, idx) => `<option value="${idx}" ${idx === egoIndex ? 'selected' : ''}>${esc(e.name || 'Untitled')}${idx === 0 ? ' (Base)' : ''}${e.disguise ? ' [Disguise]' : ''}${liveActiveEgoId === e.id ? ' ★' : ''}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="evo-btn-row">
                        <button type="button" class="glass-btn glass-btn-sm" data-act="add-ego"><i class="fa-solid fa-plus"></i> Create</button>
                        <button type="button" class="glass-btn glass-btn-sm" data-act="dup-ego"><i class="fa-solid fa-clone"></i> Duplicate</button>
                        ${otherOwner ? `<button type="button" class="glass-btn glass-btn-sm" data-act="copy-ego-other" title="Copy this Alter Ego to ${esc(otherOwner.noun === 'persona' ? `Persona (${otherOwner.name})` : `Character (${otherOwner.name})`)}"><i class="fa-solid fa-share-from-square"></i> Copy to ${otherOwner.noun === 'persona' ? 'Persona' : 'Character'}</button>` : ''}
                        <button type="button" class="glass-btn glass-btn-sm" data-act="rebuild" title="Split original ${esc(owner.descLabel)} into Fields"><i class="fa-solid fa-file-import"></i> Import Native Desc</button>
                        <button type="button" class="glass-btn glass-btn-sm evo-danger" data-act="del-ego" ${def.alterEgos.length <= 1 ? 'disabled' : ''}><i class="fa-solid fa-trash"></i> Delete Ego</button>
                    </div>

                    ${renderAvatarSection(ego, p)}

                    <div class="evo-row-between">
                        ${sw(`${p}.disguise`, !!ego.disguise, 'Disguise / Separate Scene Identity')}
                    </div>

                    <details class="evo-details" data-details="ego-triggers" ${hasEgoTriggers ? 'open' : ''}>
                        <summary><i class="fa-solid fa-key"></i> Automatic Keyword Swap, Identity & Entry/Exit Actions</summary>
                        <div class="evo-details-body">
                            <div class="evo-row">
                                <div class="evo-ego-select-col">
                                    <span class="evo-label">Entry Trigger Keywords (Switches to this Alter Ego)</span>
                                    <input type="text" class="glass-input" data-path="${p}.entry" data-kind="keywords" value="${esc(keywordsText(ego.entry))}" placeholder="e.g. full moon, morph into ${esc(ego.name)}, /regex/">
                                </div>
                                <div class="evo-ego-select-col" style="max-width:135px;">
                                    <span class="evo-label">Match Mode</span>
                                    <select class="cl-select-fluid" data-path="${p}.entry.mode">
                                        <option value="ANY" ${ego.entry?.mode !== 'ALL' ? 'selected' : ''}>Match Any</option>
                                        <option value="ALL" ${ego.entry?.mode === 'ALL' ? 'selected' : ''}>Match All</option>
                                    </select>
                                </div>
                            </div>
                            <div class="evo-row-between">
                                ${reads(`${p}.entrySources`, ego.entrySources)}
                                ${sw(`${p}.stripTriggers`, !!ego.stripTriggers, 'Strip matched trigger keyword from sent message')}
                            </div>
                            <div class="evo-row">
                                <div class="evo-ego-select-col">
                                    <span class="evo-label">Prompt Name Override</span>
                                    <input type="text" class="glass-input" data-path="${p}.promptName" data-kind="nullable" value="${esc(ego.promptName)}" placeholder="${esc(ego.name || owner.name)}">
                                </div>
                                <div class="evo-ego-select-col">
                                    <span class="evo-label">Message Header Name Override</span>
                                    <input type="text" class="glass-input" data-path="${p}.displayName" data-kind="nullable" value="${esc(ego.displayName)}" placeholder="${esc(ego.name || owner.name)}">
                                </div>
                            </div>
                            <div class="evo-row">
                                <div class="evo-ego-select-col">
                                    ${labelWithExpand('Entry Action (Asked when this Alter Ego takes over)', `${p}.entryAction`)}
                                    <textarea class="glass-input" rows="2" data-path="${p}.entryAction" data-kind="nullable" placeholder="Optional transition instruction...">${esc(ego.entryAction)}</textarea>
                                    <input type="text" class="glass-input" data-path="${p}.entryConfirm" data-kind="keywords" value="${esc(keywordsText(ego.entryConfirm))}" placeholder="Confirm keywords (blank = any reply confirms)">
                                </div>
                                <div class="evo-ego-select-col">
                                    ${labelWithExpand('Exit Action (Asked when leaving this Alter Ego)', `${p}.exitAction`)}
                                    <textarea class="glass-input" rows="2" data-path="${p}.exitAction" data-kind="nullable" placeholder="Optional revert instruction...">${esc(ego.exitAction)}</textarea>
                                    <input type="text" class="glass-input" data-path="${p}.exitConfirm" data-kind="keywords" value="${esc(keywordsText(ego.exitConfirm))}" placeholder="Confirm keywords (blank = any reply confirms)">
                                </div>
                            </div>
                            ${sw(`${p}.withAction`, ego.withAction !== false, 'Content With Action (Include new Alter Ego fields in the reply that narrates the transformation)')}
                        </div>
                    </details>
                </div>

                <div class="evo-card">
                    <div class="evo-row-between">
                        <span class="evo-label">Dynamic Fields (${ego.fields.length})</span>
                        <div class="evo-btn-row">
                            <button type="button" class="glass-btn glass-btn-sm" data-act="add-field"><i class="fa-solid fa-plus"></i> Add Field</button>
                            <button type="button" class="glass-btn glass-btn-sm ${dirty() ? 'evo-btn-accent' : ''}" data-act="save"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
                        </div>
                    </div>
                    <div class="evo-fields-list">
                        ${ego.fields.map((f, i) => fieldCardHtml(f, i, ego.fields.length, ego)).join('') || '<span class="evo-hint">No Dynamic Fields yet. Click <strong>Add Field</strong> or <strong>Import Native Desc</strong>.</span>'}
                    </div>
                    <details class="evo-details" data-details="owner-settings">
                        <summary><i class="fa-solid fa-sliders"></i> Per-${owner.noun === 'persona' ? 'Persona' : 'Card'} Trigger & Action Overrides</summary>
                        <div class="evo-details-body">
                            <div class="evo-row">
                                <div class="evo-ego-select-col">
                                    <span class="evo-label">Window (Messages)</span>
                                    <input type="number" min="1" max="50" class="glass-input" data-path="settings.window" data-kind="number" value="${esc(s.window ?? '')}" placeholder="${esc(g('window'))}">
                                </div>
                                <div class="evo-ego-select-col">
                                    <span class="evo-label">Action Tries</span>
                                    <input type="number" min="1" max="10" class="glass-input" data-path="settings.tries" data-kind="number" value="${esc(s.tries ?? '')}" placeholder="${esc(g('tries'))}">
                                </div>
                            </div>
                            <div class="evo-ego-select-col">
                                <span class="evo-label">Action Template</span>
                                <input type="text" class="glass-input" data-path="settings.template" data-kind="nullable" value="${esc(s.template ?? '')}" placeholder="${esc(g('template'))}">
                            </div>
                        </div>
                    </details>
                    <div class="evo-save ${dirty() ? 'is-dirty' : ''}">
                        <span class="evo-hint">${dirty() ? 'Unsaved changes' : 'All changes saved'}</span>
                        <button type="button" class="glass-btn glass-btn-sm" data-act="revert" ${dirty() ? '' : 'disabled'}>Revert</button>
                        <button type="button" class="glass-btn glass-btn-sm ${dirty() ? 'evo-btn-accent' : ''}" data-act="save" ${dirty() ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
                    </div>
                </div>
            </div>`;

        for (const select of pane.querySelectorAll('select.cl-select-fluid')) {
            CoreAPI.initCustomSelect?.(select);
        }
    }

    function rerender() {
        const openKeys = [...pane.querySelectorAll('details[open]')].map(d => d.dataset.details).filter(Boolean);
        const top = pane.scrollTop;
        render();
        for (const d of pane.querySelectorAll('details[data-details]')) {
            if (openKeys.includes(d.dataset.details)) d.open = true;
        }
        pane.scrollTop = top;
    }

    const markDirty = () => {
        const isDirty = dirty();
        for (const bar of pane.querySelectorAll('.evo-save')) {
            bar.classList.toggle('is-dirty', isDirty);
            const hint = bar.querySelector('.evo-hint');
            if (hint) hint.textContent = isDirty ? 'Unsaved changes' : 'All changes saved';
            for (const b of bar.querySelectorAll('button')) b.disabled = !isDirty;
        }
        for (const saveBtn of pane.querySelectorAll('button[data-act="save"]')) {
            saveBtn.classList.toggle('evo-btn-accent', isDirty);
        }
    };

    pane.addEventListener('input', (e) => {
        const t = e.target;
        if (!def) return;

        if (t.dataset?.act === 'avatar-url') {
            const url = t.value.trim();
            def.alterEgos[egoIndex]._uiAvatarMode = 'url';
            def.alterEgos[egoIndex].avatar = url ? { url } : null;
            markDirty();
            return;
        }

        const path = t.dataset?.path;
        if (!path) return;
        const kind = t.dataset.kind;
        if (t.type === 'checkbox') setPath(def, path, t.checked);
        else if (kind === 'keywords') setPath(def, path, { keywords: parseKeywords(t.value), mode: getPath(def, path)?.mode || 'ANY' });
        else if (kind === 'nullable') setPath(def, path, t.value.trim() ? t.value : null);
        else if (kind === 'number') setPath(def, path, t.value === '' ? null : Number(t.value));
        else if (path.endsWith('.mode')) setPath(def, path.slice(0, -5), { keywords: getPath(def, path.slice(0, -5))?.keywords || [], mode: t.value });
        else setPath(def, path, t.value);

        const fieldCard = t.closest('.evo-field-card');
        if (fieldCard) {
            const fi = Number(fieldCard.dataset.field);
            const f = def.alterEgos[egoIndex].fields[fi];
            if (f) {
                const tokEl = fieldCard.querySelector(`[data-token-pill="${fi}"]`);
                if (tokEl) tokEl.textContent = `~${estimateTokens(f.content)} tok`;
                const pillsEl = fieldCard.querySelector(`[data-summary-pills="${fi}"]`);
                if (pillsEl) pillsEl.innerHTML = fieldSummaryBadges(f, null);
                if (path.endsWith('.startsOn')) {
                    fieldCard.classList.toggle('is-disabled', !t.checked);
                }
            }
        }
        markDirty();
    });

    pane.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.dataset?.act === 'toggle') {
            await toggle(t.checked);
            return;
        }
        if (!def) return;
        const ego = def.alterEgos[egoIndex];

        if (t.dataset?.act === 'select-ego') {
            egoIndex = Number(t.value) || 0;
            const picked = def.alterEgos[egoIndex];
            if (picked && onLiveSwitch) {
                await onLiveSwitch({ kind: 'ego', id: picked.id, skip: true });
            }
            rerender();
            return;
        }

        if (t.dataset?.act === 'avatar-mode') {
            const mode = t.value;
            ego._uiAvatarMode = mode;
            if (mode === 'inherit') {
                ego.avatar = null;
            } else if (mode === 'character') {
                const firstCharId = charList?.[0]?.id || '';
                ego.avatar = firstCharId ? { character: firstCharId } : null;
            } else if (mode === 'gallery') {
                try { gallery = await owner.avatar.choices(); } catch { gallery = []; }
            }
            markDirty();
            rerender();
            return;
        }

        if (t.dataset?.act === 'avatar-char-ref') {
            ego._uiAvatarMode = 'character';
            ego.avatar = t.value ? { character: t.value } : null;
            markDirty();
            rerender();
            return;
        }

        if (t.dataset?.fieldKwMode !== undefined) {
            const fi = Number(t.dataset.fieldKwMode);
            const f = ego.fields[fi];
            if (f) {
                const mode = t.value === 'ALL' ? 'ALL' : 'ANY';
                f.activating = { keywords: f.activating?.keywords || [], mode };
                f.enabling = { keywords: f.enabling?.keywords || [], mode };
                f.disabling = { keywords: f.disabling?.keywords || [], mode };
                markDirty();
            }
            return;
        }

        if (t.dataset?.liveField && onLiveSwitch) {
            await onLiveSwitch({
                kind: 'field',
                ego: t.dataset.liveEgo,
                id: t.dataset.liveField,
                on: t.checked,
                skip: true,
            });
        }

        if (t.dataset?.act === 'upload' && t.files?.[0]) {
            await upload(t.files[0]);
        }
    });

    pane.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b || !def) return;
        const ego = def.alterEgos[egoIndex];
        const fi = Number(b.closest('.evo-field-card')?.dataset.field);
        switch (b.dataset.act) {
            case 'save': return save();
            case 'revert':
                def = JSON.parse(saved);
                egoIndex = Math.min(egoIndex, def.alterEgos.length - 1);
                return rerender();
            case 'add-ego': {
                const taken = new Set(def.alterEgos.map(x => x.id));
                const name = `Alter Ego ${def.alterEgos.length + 1}`;
                const created = blankAlterEgo(idFor(name, taken), name, [
                    blankField('background', 'Background', ''),
                    blankField('personality', 'Personality', ''),
                    blankField('appearance', 'Appearance', ''),
                ]);
                if (owner.noun === 'persona') created.disguise = true;
                def.alterEgos.push(created);
                egoIndex = def.alterEgos.length - 1;
                markDirty();
                return rerender();
            }
            case 'dup-ego': {
                const copy = structuredClone(ego);
                delete copy._uiAvatarMode;
                copy.id = idFor(`${ego.name} copy`, new Set(def.alterEgos.map(x => x.id)));
                copy.name = `${ego.name} (Copy)`;
                const takenFields = new Set();
                for (const f of copy.fields || []) {
                    f.id = idFor(f.name || f.id || 'field', takenFields);
                    takenFields.add(f.id);
                }
                if (egoIndex === 0 && owner.noun === 'persona') copy.disguise = true;
                def.alterEgos.push(copy);
                egoIndex = def.alterEgos.length - 1;
                markDirty();
                return rerender();
            }
            case 'copy-ego-other': {
                if (!otherOwner) return;
                try {
                    const otherGot = await otherOwner.load();
                    let targetDef = otherGot.definition;
                    if (!targetDef) {
                        targetDef = definitionFromDescription(otherGot.source || '');
                    }
                    targetDef.alterEgos ||= [];
                    const key = String(ego.name || '').trim().toLowerCase();
                    const existingIdx = targetDef.alterEgos.findIndex(x => String(x.name || '').trim().toLowerCase() === key);
                    let choice = null;
                    if (existingIdx >= 0) {
                        choice = onCopyConflict
                            ? await onCopyConflict(ego.name, targetDef.alterEgos[existingIdx])
                            : await askCopyConflict(ego.name, otherOwner);
                        if (choice !== 'replace' && choice !== 'copy') return;
                    }
                    const applied = resolveCopyAlterEgo(targetDef, ego, { ownerNoun: owner.noun, ownerCharId: owner.charId, targetNoun: otherOwner.noun, choice });
                    if (!applied) return;
                    await otherOwner.saveDefinition(targetDef);
                    const destLabel = otherOwner.noun === 'persona' ? `Persona (${otherOwner.name})` : `Character (${otherOwner.name})`;
                    CoreAPI.showToast(applied.mode === 'replace'
                        ? `Replaced "${ego.name}" in ${destLabel}`
                        : `Copied "${applied.ego.name}" to ${destLabel}`, 'success');
                    onChanged?.();
                } catch (err) {
                    CoreAPI.showToast(`Could not copy Alter Ego: ${err.message}`, 'error');
                }
                return;
            }
            case 'del-ego':
                if (def.alterEgos.length <= 1) return;
                if (!confirm(`Delete the Alter Ego "${ego.name}" and its Fields?`)) return;
                def.alterEgos.splice(egoIndex, 1);
                egoIndex = Math.max(0, egoIndex - 1);
                markDirty();
                return rerender();
            case 'add-field': {
                const taken = new Set(ego.fields.map(f => f.id));
                ego.fields.push(blankField(idFor('field', taken), `Custom Field ${ego.fields.length + 1}`));
                markDirty();
                return rerender();
            }
            case 'dup-field': {
                const copy = structuredClone(ego.fields[fi]);
                copy.id = idFor(copy.id, new Set(ego.fields.map(f => f.id)));
                copy.name = `${copy.name} (Copy)`;
                ego.fields.splice(fi + 1, 0, copy);
                markDirty();
                return rerender();
            }
            case 'del-field':
                ego.fields.splice(fi, 1);
                markDirty();
                return rerender();
            case 'up': case 'down': {
                const to = b.dataset.act === 'up' ? fi - 1 : fi + 1;
                if (to < 0 || to >= ego.fields.length) return;
                [ego.fields[fi], ego.fields[to]] = [ego.fields[to], ego.fields[fi]];
                markDirty();
                return rerender();
            }
            case 'expand': return expand(b.dataset.for, b.dataset.label);
            case 'rebuild': {
                const src = sourceDescription();
                if (!src.trim()) {
                    CoreAPI.showToast(`No native ${owner.descLabel} text found to import`, 'info');
                    return;
                }
                def = rebuildFromDescription(def, src);
                markDirty();
                CoreAPI.showToast(`Imported fields from native ${owner.descLabel} — click Save Changes to keep`, 'info');
                return rerender();
            }
            case 'pick-avatar':
                if (gallery?.[Number(b.dataset.choice)]) {
                    ego.avatar = gallery[Number(b.dataset.choice)].avatar;
                    markDirty();
                    rerender();
                }
                return;
        }
    });

    async function upload(file) {
        try {
            def.alterEgos[egoIndex].avatar = await owner.avatar.upload(file);
            def.alterEgos[egoIndex]._uiAvatarMode = avatarModeOf(def.alterEgos[egoIndex].avatar);
            markDirty();
            rerender();
        } catch (e) { CoreAPI.showToast(`Could not upload the picture: ${e.message}`, 'error'); }
    }

    async function save() {
        if (saving) return;
        saving = true;
        try {
            const cleanDef = structuredClone(def);
            for (const e of cleanDef.alterEgos || []) delete e._uiAvatarMode;
            await owner.saveDefinition(cleanDef);
            def = cleanDef;
            saved = JSON.stringify(def);
            markDirty();
            CoreAPI.showToast('Evolutia saved', 'success');
            onChanged?.();
        } catch (e) {
            CoreAPI.showToast(`Could not save: ${e.message}`, 'error');
        } finally {
            saving = false;
        }
    }

    function expand(path, label) {
        const box = pane.querySelector(`textarea[data-path="${CSS.escape(path)}"]`);
        if (!box || !bigEditor) return;
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
        try {
            if (dirty() && def) await save();
            await owner.setOn(want, def, null);
            CoreAPI.showToast(want ? `Evolutia is active for ${owner.name}` : `Evolutia is off for ${owner.name}`, 'success');
            await load({ silent: true });
            onChanged?.();
        } catch (e) {
            CoreAPI.showToast(`Could not switch Evolutia: ${e.message}`, 'error');
            const toggleInput = pane.querySelector('input[data-act="toggle"]');
            if (toggleInput) toggleInput.checked = on;
        }
    }

    load();
    return { dirty, reload: load };
}
