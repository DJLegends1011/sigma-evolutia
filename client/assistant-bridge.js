// Client bridge for Project Σ's Chat Assistant (#casBody) and Creator Studio (#ccsBody):
// turns fenced ```cl-evolutia-edits``` blocks into interactive Evolutia Review Cards with 1-click Apply.

const approxTokens = (s) => Math.max(0, Math.ceil(String(s || '').trim().length / 4));

export function mountAssistantBridge(ctx, { getChatId, getCharId, onApplied } = {}) {
    if (typeof document === 'undefined') return () => {};
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));

    // Ensure Evolutia's Saved Prompt chips are seeded into assistant-prompts & creator-studio-prompts
    ctx.server.call('/seed-prompts', 'POST', {}).catch(() => {});

    function triggerKeywords(raw, modeProp) {
        const isObj = raw && typeof raw === 'object' && !Array.isArray(raw);
        const rawList = Array.isArray(raw) ? raw : (isObj && Array.isArray(raw.keywords) ? raw.keywords : []);
        const list = rawList.map(x => String(x ?? '').trim()).filter(Boolean);
        const mode = String((isObj ? raw.mode : modeProp) || 'ANY').toUpperCase() === 'ALL' ? 'ALL' : 'ANY';
        return { list, mode };
    }

    function triggerPillsHtml(label, raw, modeProp) {
        const { list, mode } = triggerKeywords(raw, modeProp);
        if (!list.length) return '';
        const modeTag = mode === 'ALL' ? ' (ALL)' : '';
        return `<div class="evo-prop-meta">${esc(label)}${esc(modeTag)}: ${list.map(k => `<code class="evo-kw-pill">${esc(k)}</code>`).join(' ')}</div>`;
    }

    // `["user"]` / `["user", "char"]` (or a flags object) back to readable labels; [] when it names none.
    function sourcesLabels(raw) {
        if (Array.isArray(raw)) {
            const names = raw.map(x => String(x ?? '').trim().toLowerCase()).filter(x => x === 'user' || x === 'char');
            return [...new Set(names)];
        }
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && ('user' in raw || 'char' in raw)) {
            return [raw.user !== false && 'user', raw.char !== false && 'char'].filter(Boolean);
        }
        return [];
    }

    // a subtle `Reads: user` note for a trigger-sources value
    function readsNoteHtml(raw) {
        const labels = sourcesLabels(raw);
        return labels.length && labels.length < 3
            ? `<div class="evo-prop-meta evo-muted">Reads: ${esc(labels.join(', '))}</div>`
            : '';
    }

    // the sources a Field op names: a trigger bucket's own, else the op's
    function fieldSourcesRaw(f) {
        for (const b of [f.activating, f.enabling, f.disabling]) {
            if (b && typeof b === 'object' && !Array.isArray(b) && b.sources !== undefined) return b.sources;
        }
        return f.sources;
    }

    function fieldTriggersHtml(f) {
        return [
            triggerPillsHtml('Activating', f.activating, f.activatingMode),
            triggerPillsHtml('Enabling', f.enabling, f.enablingMode),
            triggerPillsHtml('Disabling', f.disabling, f.disablingMode),
            readsNoteHtml(fieldSourcesRaw(f)),
        ].filter(Boolean).join('');
    }

    function summarizeOpHtml(op) {
        const sideLabel = op.side === 'persona' ? 'Persona' : 'Character';
        const sideTone = op.side === 'persona' ? 'is-persona' : 'is-char';
        const kind = String(op.op || 'upsert-field');

        if (kind === 'upsert-ego') {
            const fields = Array.isArray(op.fields) ? op.fields : [];
            const entryRaw = op.entry !== undefined ? op.entry : op.activating;
            const entryMode = op.entryMode ?? op.activatingMode;
            const entryObj = entryRaw && typeof entryRaw === 'object' && !Array.isArray(entryRaw) ? entryRaw : null;
            const entryConfirmRaw = op.entryConfirm !== undefined ? op.entryConfirm : entryObj?.confirm;
            const exitConfirmRaw = op.exitConfirm !== undefined ? op.exitConfirm : op.exit?.confirm;
            const entrySourcesRaw = op.entrySources !== undefined ? op.entrySources : entryObj?.sources;
            return `
                <div class="evo-prop-item">
                    <div class="evo-prop-item-head">
                        <span class="evo-prop-badge ${sideTone}">${esc(sideLabel)}</span>
                        <span class="evo-prop-op">Alter Ego</span>
                        <strong class="evo-prop-title">${esc(op.name || 'Alter Ego')}</strong>
                        ${op.disguise ? '<span class="evo-badge is-disguise">Disguise</span>' : ''}
                        <span class="evo-token-pill">${fields.length} field${fields.length === 1 ? '' : 's'}</span>
                    </div>
                    ${triggerPillsHtml('Entry', entryRaw, entryMode)}
                    ${readsNoteHtml(entrySourcesRaw)}
                    ${triggerPillsHtml('Confirmed by', entryConfirmRaw)}
                    ${triggerPillsHtml('Exit confirmed by', exitConfirmRaw)}
                    ${op.entryAction ? `<div class="evo-prop-meta">Entry Action: <em>${esc(op.entryAction)}</em></div>` : ''}
                    ${op.exitAction ? `<div class="evo-prop-meta">Exit Action: <em>${esc(op.exitAction)}</em></div>` : ''}
                    ${fields.length ? `<div class="evo-prop-fields">${fields.map((f) => {
                        const trigHtml = fieldTriggersHtml(f);
                        return `
                        <details class="evo-prop-field">
                            <summary>
                                <span>## ${esc(f.name || 'Field')}</span>
                                <span class="evo-muted">${f.startsOn === false ? 'starts OFF' : 'starts ON'} · ~${approxTokens(f.content)} tok</span>
                                ${trigHtml}
                            </summary>
                            ${f.entryAction ? `<div class="evo-prop-meta">Entry Action: <em>${esc(f.entryAction)}</em></div>` : ''}
                            ${f.exitAction ? `<div class="evo-prop-meta">Exit Action: <em>${esc(f.exitAction)}</em></div>` : ''}
                            <div class="evo-prop-field-body">${esc(f.content || '')}</div>
                        </details>`;
                    }).join('')}</div>` : ''}
                </div>`;
        }

        if (kind === 'upsert-field') {
            return `
                <div class="evo-prop-item">
                    <div class="evo-prop-item-head">
                        <span class="evo-prop-badge ${sideTone}">${esc(sideLabel)}</span>
                        <span class="evo-prop-op">Field (${esc(op.ego || 'main')})</span>
                        <strong class="evo-prop-title">## ${esc(op.name || 'Field')}</strong>
                        <span class="evo-token-pill">${op.startsOn === false ? 'starts OFF' : 'starts ON'} · ~${approxTokens(op.content)} tok</span>
                    </div>
                    ${fieldTriggersHtml(op)}
                    ${op.entryAction ? `<div class="evo-prop-meta">Entry Action: <em>${esc(op.entryAction)}</em></div>` : ''}
                    ${op.exitAction ? `<div class="evo-prop-meta">Exit Action: <em>${esc(op.exitAction)}</em></div>` : ''}
                    <div class="evo-prop-field-body">${esc(op.content || '')}</div>
                </div>`;
        }

        if (kind === 'delete-field') {
            return `
                <div class="evo-prop-item">
                    <div class="evo-prop-item-head">
                        <span class="evo-prop-badge ${sideTone}">${esc(sideLabel)}</span>
                        <span class="evo-prop-op is-danger">Delete Field</span>
                        <strong class="evo-prop-title">## ${esc(op.name || op.id || '')} (${esc(op.ego || 'main')})</strong>
                    </div>
                </div>`;
        }

        if (kind === 'switch') {
            return `
                <div class="evo-prop-item">
                    <div class="evo-prop-item-head">
                        <span class="evo-prop-badge ${sideTone}">${esc(sideLabel)}</span>
                        <span class="evo-prop-op">Live Switch</span>
                        <strong class="evo-prop-title">${esc(op.field ? `${op.field} → ${op.on === false ? 'OFF' : 'ON'}` : `Alter Ego → ${op.ego || op.name}`)}</strong>
                    </div>
                </div>`;
        }

        return `<div class="evo-prop-item"><pre>${esc(JSON.stringify(op, null, 2))}</pre></div>`;
    }

    function upgradeBlock(codeEl) {
        const block = codeEl.closest('.cl-code-block') || codeEl.closest('pre');
        if (!block || block.dataset.evoUpgraded === '1') return;
        block.dataset.evoUpgraded = '1';

        const rawJson = (codeEl.textContent || '').trim();
        let parsed;
        try {
            parsed = JSON.parse(rawJson);
            if (!Array.isArray(parsed)) parsed = [parsed];
        } catch (err) {
            return;
        }

        const card = document.createElement('div');
        card.className = 'evo-prop-card';
        let editing = false;
        let applied = false;
        let currentJson = JSON.stringify(parsed, null, 2);

        function renderCard() {
            let ops = [];
            let parseErr = null;
            try {
                const p = JSON.parse(currentJson);
                ops = Array.isArray(p) ? p : [p];
            } catch (e) {
                parseErr = e.message;
            }

            card.innerHTML = `
                <div class="evo-prop-head">
                    <div class="evo-prop-head-title">
                        <i class="fa-solid fa-masks-theater"></i>
                        <span>Evolutia Proposal</span>
                        <span class="evo-token-pill">${ops.length} change${ops.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="evo-prop-head-actions">
                        <button type="button" class="cl-btn cl-btn-secondary cl-btn-sm" data-evo-prop="edit" ${applied ? 'disabled' : ''}>
                            <i class="fa-solid ${editing ? 'fa-eye' : 'fa-code'}"></i> ${editing ? 'Preview' : 'Edit JSON'}
                        </button>
                        <button type="button" class="cl-btn ${applied ? 'cl-btn-secondary' : 'cl-btn-primary'} cl-btn-sm" data-evo-prop="apply" ${applied || parseErr ? 'disabled' : ''}>
                            <i class="fa-solid ${applied ? 'fa-check' : 'fa-wand-magic-sparkles'}"></i> ${applied ? 'Applied to Evolutia' : 'Apply to Evolutia'}
                        </button>
                    </div>
                </div>
                ${parseErr ? `<div class="evo-error" style="padding:8px 12px;">Invalid JSON: ${esc(parseErr)}</div>` : ''}
                ${editing
                    ? `<div class="evo-prop-editor"><textarea class="glass-input evo-textarea" rows="10" data-evo-prop="json">${esc(currentJson)}</textarea></div>`
                    : `<div class="evo-prop-list">${ops.map(summarizeOpHtml).join('')}</div>`
                }`;
        }

        card.addEventListener('input', (e) => {
            if (e.target.dataset.evoProp === 'json') {
                currentJson = e.target.value;
            }
        });

        card.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-evo-prop]');
            if (!btn) return;
            const act = btn.dataset.evoProp;
            if (act === 'edit') {
                editing = !editing;
                renderCard();
                return;
            }
            if (act === 'apply' && !applied) {
                let ops;
                try {
                    const p = JSON.parse(currentJson);
                    ops = Array.isArray(p) ? p : [p];
                } catch (err) {
                    CoreAPI.showToast(`Invalid Evolutia JSON: ${err.message}`, 'error');
                    return;
                }
                btn.disabled = true;
                try {
                    // a proposal in Creator Studio is about the studio's character, never the last chat's:
                    // the server reads it from the studio session shown in the studio's own picker
                    const inStudio = !!block.closest('#ccsBody');
                    const res = await ctx.server.call('/assistant-apply', 'POST', inStudio
                        ? { surface: 'creator', studioSessionId: document.getElementById('ccsSessionSel')?.value || null, ops }
                        : { chatId: getChatId?.() || null, charId: getCharId?.() || null, ops });
                    applied = true;
                    editing = false;
                    renderCard();
                    CoreAPI.showToast(res.summary?.join(' · ') || 'Applied to Evolutia', 'success');
                    onApplied?.(res);
                } catch (err) {
                    btn.disabled = false;
                    CoreAPI.showToast(`Could not apply Evolutia changes: ${err.message}`, 'error');
                }
            }
        });

        renderCard();
        block.replaceWith(card);
    }

    function scan() {
        const codes = document.querySelectorAll('#casBody code.language-cl-evolutia-edits, #ccsBody code.language-cl-evolutia-edits');
        for (const c of codes) upgradeBlock(c);
    }

    const Obs = typeof MutationObserver !== 'undefined'
        ? MutationObserver
        : (typeof window !== 'undefined' ? window.MutationObserver : null);
    if (!Obs || !document.body) return () => {};
    const observer = new Obs(() => scan());
    observer.observe(document.body, { childList: true, subtree: true });
    scan();

    return () => observer.disconnect();
}
