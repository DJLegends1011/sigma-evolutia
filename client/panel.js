// The Evolutia Chat Window: defaults to the glassmorphic Persona & Character card editors
// (just like v0.1.0), plus a Prompt & State tab for live timeline inspection and prompt preview.
import { mountEditor } from './editor.js';
import { cardOwner, personaOwner, resolveAvatarThumb } from './owners.js';

const PHASE = { on: 'on', off: 'off', entering: 'switching on', exiting: 'switching off' };

export function mountPanel(body, ctx, { bigEditor, identity } = {}) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    let character = null, skip = false, last = null;
    let activeTab = 'persona'; // 'persona' | 'char' | 'state'

    const follower = ctx.chats.follow({
        read: (chatId) => ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${character ? `?charId=${encodeURIComponent(character.id)}` : ''}`),
        apply: (state) => {
            const firstLoad = !last;
            last = state;
            if (firstLoad || activeTab === 'state') {
                render();
            } else {
                updateTabLabels();
            }
        },
        fail: (e) => { body.innerHTML = `<div class="evo-window"><div class="evo-card"><span class="evo-error">Could not read Evolutia's state: ${esc(e.message)}</span></div></div>`; },
    });

    function getTabNames(s) {
        const pEgoName = s?.persona?.ego?.name || s?.persona?.name || s?.personaMeta?.name || 'Persona';
        const cEgoName = s?.ego?.name || character?.name || 'Character';
        return { pEgoName, cEgoName };
    }

    function updateTabLabels() {
        const { pEgoName, cEgoName } = getTabNames(last);
        const pBtn = body.querySelector('button[data-evo-tab="persona"] span');
        const cBtn = body.querySelector('button[data-evo-tab="char"] span');
        if (pBtn) pBtn.textContent = `Persona (${pEgoName})`;
        if (cBtn) cBtn.textContent = `Character (${cEgoName})`;
    }

    function tabsHtml(s) {
        const { pEgoName, cEgoName } = getTabNames(s);
        return `
            <div class="evo-tabs">
                <button type="button" class="evo-tab-btn ${activeTab === 'persona' ? 'is-active' : ''}" data-evo-tab="persona">
                    <i class="fa-solid fa-user-astronaut"></i> <span>Persona (${esc(pEgoName)})</span>
                </button>
                <button type="button" class="evo-tab-btn ${activeTab === 'char' ? 'is-active' : ''}" data-evo-tab="char">
                    <i class="fa-solid fa-masks-theater"></i> <span>Character (${esc(cEgoName)})</span>
                </button>
                <button type="button" class="evo-tab-btn ${activeTab === 'state' ? 'is-active' : ''}" data-evo-tab="state">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> <span>Prompt & State</span>
                </button>
            </div>`;
    }

    function sideHtml(st, side, title) {
        const tag = side === 'persona' ? ' data-side="persona"' : '';
        return `
            <div class="evo-card">
                <div class="evo-row-between">
                    <span class="evo-label">${esc(title)}: <strong>${esc(st.ego.name)}</strong></span>
                    <div>
                        ${st.ego.disguise ? '<span class="evo-pill is-disguise">Disguise</span>' : ''}
                        ${st.egoMove ? `<span class="evo-pill evo-entering">→ ${esc(st.egoMove.name)} after next reply</span>` : ''}
                    </div>
                </div>
                ${st.egos.map(e => {
                    const thumb = resolveAvatarThumb(e.avatar, CoreAPI, 64);
                    return `
                    <section class="evo-panel-ego ${e.id === st.ego.id ? 'is-active' : ''}">
                        <div class="evo-panel-ego-head">
                            <span class="evo-panel-ego-title">
                                ${thumb ? `<img class="evo-panel-ego-thumb" src="${esc(thumb)}" alt="">` : '<i class="fa-solid fa-masks-theater"></i>'}
                                <span>${esc(e.name)}${e.id === st.ego.id ? ' <span class="evo-hint">(active)</span>' : ''}${e.disguise ? ' <span class="evo-pill is-disguise">Disguise</span>' : ''}</span>
                            </span>
                            ${e.id === st.egoMove?.id ? `<button type="button" class="glass-btn glass-btn-sm"${tag} data-ego="${esc(e.id)}" data-finish>Finish now</button>`
                                : e.id === st.ego.id ? (st.egoMove ? `<button type="button" class="glass-btn glass-btn-sm"${tag} data-ego="${esc(e.id)}">Stay</button>` : '')
                                : `<button type="button" class="glass-btn glass-btn-sm"${tag} data-ego="${esc(e.id)}">Switch to</button>`}
                        </div>
                        ${e.fields.map(f => {
                            const isOn = f.phase === 'on' || f.phase === 'entering';
                            return `<div class="evo-panel-field">
                                <span class="evo-panel-name">${esc(f.name)}</span>
                                <span class="evo-pill evo-${f.phase}">${PHASE[f.phase]}</span>
                                ${f.inPrompt ? '<i class="fa-solid fa-check evo-in" title="In the prompt"></i>' : ''}
                                <button type="button" class="glass-btn glass-btn-sm"${tag} data-ego-id="${esc(e.id)}" data-field="${esc(f.id)}" data-on="${!isOn}">Turn ${isOn ? 'off' : 'on'}</button>
                            </div>`;
                        }).join('') || '<span class="evo-hint">No Fields.</span>'}
                    </section>`;
                }).join('')}
            </div>`;
    }

    function renderStateBody(s) {
        const text = [s?.evolutia, s?.persona?.evolutia].filter(Boolean).join('\n\n');
        const actions = [s?.on && s?.actionBlock, s?.persona?.actionBlock].filter(Boolean).join('\n');
        const tokens = Math.ceil((text.length + actions.length) / 4);
        return `
            <div class="evo-window">
                <div class="evo-card">
                    <div class="evo-row-between">
                        <span class="evo-label">Next Prompt Injection</span>
                        <span class="evo-token-pill">~${tokens} tok</span>
                    </div>
                    <label class="evo-switch-label">
                        <input type="checkbox" class="cl-switch-input" data-skip ${skip ? 'checked' : ''}>
                        <span class="cl-switch" aria-hidden="true"></span>
                        <span>Manual Switches skip Entry / Exit Actions</span>
                    </label>
                    ${s?.on ? `<span class="evo-label">Character ({{evolutia}})</span><pre class="evo-code-preview">${esc(s.evolutia || '(empty)')}</pre>` : ''}
                    ${s?.persona ? `<span class="evo-label">Persona ({{evolutia_persona}})</span><pre class="evo-code-preview">${esc(s.persona.evolutia || '(empty)')}</pre>` : ''}
                    <span class="evo-label">Pending Entry / Exit Actions (Depth 0)</span>
                    <pre class="evo-code-preview">${esc(actions || '(no pending Actions)')}</pre>
                </div>
                ${s?.on ? sideHtml(s, 'char', character?.name || 'Character') : ''}
                ${s?.persona ? sideHtml(s.persona, 'persona', `Persona (${s.persona.name})`) : ''}
            </div>`;
    }

    async function manual(sw) {
        try {
            await ctx.server.call(`/chats/${encodeURIComponent(follower.chatId())}/switch`, 'POST', { ...sw, skip: sw.skip || skip });
            await follower.reload();
            identity?.refreshSoon();
        } catch (e) { CoreAPI.showToast(`Could not switch: ${e.message}`, 'error'); }
    }

    async function render() {
        const s = last;
        if (!follower.chatId()) {
            body.innerHTML = '<div class="evo-window"><div class="evo-card"><span class="evo-muted">Open a chat to manage Evolutia.</span></div></div>';
            return;
        }
        body.innerHTML = `<div class="evo-window">${tabsHtml(s)}<div class="evo-tab-pane"></div></div>`;
        const pane = body.querySelector('.evo-tab-pane');

        if (activeTab === 'state') {
            pane.innerHTML = renderStateBody(s);
            return;
        }

        if (activeTab === 'char') {
            const charId = character?.id || s?.charId;
            const charObj = character || (charId ? (CoreAPI.getCharacterById(charId) || await CoreAPI.ensureCharacterById(charId)) : null);
            if (!charObj) {
                pane.innerHTML = '<div class="evo-card"><span class="evo-muted">No character found for this chat.</span></div>';
                return;
            }
            const owner = cardOwner(charObj, ctx);
            owner.charId = charObj.id;
            mountEditor(pane, owner, ctx, {
                bigEditor,
                liveSide: s?.on ? s : null,
                onLiveSwitch: (sw) => manual(sw),
                onChanged: async () => { await follower.reload(); identity?.refreshSoon(); },
            });
            return;
        }

        if (activeTab === 'persona') {
            const pMeta = s?.persona || s?.personaMeta;
            if (!pMeta?.id) {
                pane.innerHTML = '<div class="evo-card"><span class="evo-muted">No active persona found. Select or create a persona in Settings › Chat first.</span></div>';
                return;
            }
            mountEditor(pane, personaOwner({ id: pMeta.id, name: pMeta.name || 'Persona' }, ctx), ctx, {
                bigEditor,
                liveSide: s?.persona || null,
                onLiveSwitch: (sw) => manual({ ...sw, side: 'persona' }),
                onChanged: async () => { await follower.reload(); identity?.refreshSoon(); },
            });
        }
    }

    body.addEventListener('change', (e) => { if (e.target.matches('[data-skip]')) skip = e.target.checked; });
    body.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('button[data-evo-tab]');
        if (tabBtn) {
            activeTab = tabBtn.dataset.evoTab;
            render();
            return;
        }
        if (activeTab !== 'state') return;
        const b = e.target.closest('button');
        if (!b) return;
        const side = b.dataset.side === 'persona' ? { side: 'persona' } : {};
        if (b.dataset.field) manual({ kind: 'field', ego: b.dataset.egoId, id: b.dataset.field, on: b.dataset.on === 'true', ...side });
        else if (b.dataset.ego) manual({ kind: 'ego', id: b.dataset.ego, ...side, ...(b.hasAttribute('data-finish') ? { skip: true } : {}) });
    });

    return {
        show(chatId, char) {
            if (chatId !== follower.chatId()) last = null;
            character = char;
            return follower.show(chatId);
        },
        setCharacter(char) { character = char; return follower.reload(); },
        reloadSoon: () => follower.reloadSoon(),
        rest: () => follower.rest(),
        isOpen: () => follower.isOpen(),
        chatId: () => follower.chatId(),
    };
}
