// The Evolutia window in a conversation: live state + Manual Switches + Next Prompt preview,
// plus embedded Character & Persona Field/Alter Ego editors right inside the chat window.
import { mountEditor } from './editor.js';
import { cardOwner, personaOwner, resolveAvatarThumb } from './owners.js';

const PHASE = { on: 'on', off: 'off', entering: 'switching on', exiting: 'switching off' };

export function mountPanel(body, ctx, { bigEditor, identity } = {}) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    let character = null, skip = false, last = null, activeTab = 'state'; // 'state' | 'char' | 'persona'

    const follower = ctx.chats.follow({
        read: (chatId) => ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${character ? `?charId=${encodeURIComponent(character.id)}` : ''}`),
        apply: (state) => {
            last = state;
            if (activeTab === 'state') render();
        },
        fail: (e) => { body.innerHTML = `<p class="evo-error">Could not read Evolutia's state: ${esc(e.message)}</p>`; },
    });

    function tabsHtml(s) {
        const charLabel = character?.name || 'Character';
        const pLabel = s?.persona?.name || s?.personaMeta?.name || 'Persona';
        return `
            <div class="evo-tabs">
                <button type="button" class="evo-tab-btn ${activeTab === 'state' ? 'is-active' : ''}" data-evo-tab="state">
                    <i class="fa-solid fa-sliders"></i> Live State
                </button>
                <button type="button" class="evo-tab-btn ${activeTab === 'char' ? 'is-active' : ''}" data-evo-tab="char">
                    <i class="fa-solid fa-masks-theater"></i> ${esc(charLabel)}
                </button>
                <button type="button" class="evo-tab-btn ${activeTab === 'persona' ? 'is-active' : ''}" data-evo-tab="persona">
                    <i class="fa-solid fa-user-astronaut"></i> ${esc(pLabel)}
                </button>
            </div>`;
    }

    // One side's state: the character's, or the user's (side 'persona') under its own heading.
    function sideHtml(st, side, title) {
        const tag = side === 'persona' ? ' data-side="persona"' : '';
        return `
            <div class="evo-now">
                <span class="evo-label">${esc(title)}</span>
                <strong>${esc(st.ego.name)}</strong>
                ${st.ego.disguise ? '<span class="evo-pill is-disguise">Disguise</span>' : ''}
                ${st.egoMove ? ` <span class="evo-pill evo-entering">→ ${esc(st.egoMove.name)} after the next reply</span>` : ''}
            </div>
            ${st.egos.map(e => {
                const thumb = resolveAvatarThumb(e.avatar, CoreAPI, 64);
                return `
                <section class="evo-panel-ego ${e.id === st.ego.id ? 'is-active' : ''}">
                    <div class="evo-panel-ego-head">
                        <span class="evo-panel-ego-title">
                            ${thumb ? `<img class="evo-panel-ego-thumb" src="${esc(thumb)}" alt="">` : ''}
                            <span>${esc(e.name)}${e.id === st.ego.id ? ' <span class="evo-hint">(active)</span>' : ''}${e.disguise ? ' <span class="evo-pill is-disguise">Disguise</span>' : ''}</span>
                        </span>
                        ${e.id === st.egoMove?.id ? `<button type="button" class="cl-btn cl-btn-secondary evo-small"${tag} data-ego="${esc(e.id)}" data-finish>Finish now</button>`
                            : e.id === st.ego.id ? (st.egoMove ? `<button type="button" class="cl-btn cl-btn-secondary evo-small"${tag} data-ego="${esc(e.id)}">Stay</button>` : '')
                            : `<button type="button" class="cl-btn cl-btn-secondary evo-small"${tag} data-ego="${esc(e.id)}">Switch to</button>`}
                    </div>
                    ${e.fields.map(f => {
                        const isOn = f.phase === 'on' || f.phase === 'entering';
                        return `<div class="evo-panel-field">
                            <span class="evo-panel-name">${esc(f.name)}</span>
                            <span class="evo-pill evo-${f.phase}">${PHASE[f.phase]}</span>
                            ${f.inPrompt ? '<i class="fa-solid fa-check evo-in" title="In the prompt"></i>' : ''}
                            <button type="button" class="cl-btn cl-btn-secondary evo-small"${tag} data-ego-id="${esc(e.id)}" data-field="${esc(f.id)}" data-on="${!isOn}">Turn ${isOn ? 'off' : 'on'}</button>
                        </div>`;
                    }).join('') || '<p class="evo-hint">No Fields.</p>'}
                </section>`;
            }).join('')}`;
    }

    function renderStateBody(s) {
        if (!s?.on && !s?.persona) {
            return `<p class="evo-muted">Evolutia is off for ${esc(character?.name || 'this character')} and for your persona. Use the <strong>${esc(character?.name || 'Character')}</strong> or <strong>${esc(s?.personaMeta?.name || 'Persona')}</strong> tab above to switch it on and edit Fields right here.</p>`;
        }
        const text = [s.evolutia, s.persona?.evolutia].filter(Boolean).join('\n\n');
        const actions = [s.on && s.actionBlock, s.persona?.actionBlock].filter(Boolean).join('\n');
        const tokens = Math.ceil((text.length + actions.length) / 4);
        return `
            <div class="evo-panel">
                <label class="evo-switch evo-skip"><input type="checkbox" class="cl-switch-input" data-skip ${skip ? 'checked' : ''}><span class="cl-switch" aria-hidden="true"></span>
                    <span>Manual Switches skip their Actions</span></label>
                ${s.on ? sideHtml(s, 'char', character?.name || 'Character') : `<p class="evo-hint">Evolutia is off for ${esc(character?.name || 'this character')}.</p>`}
                ${s.persona ? `<h4 class="evo-section">You (${esc(s.persona.name)})</h4>${sideHtml(s.persona, 'persona', 'Alter Ego')}` : ''}
                <details class="evo-preview">
                    <summary>Next prompt <span class="evo-hint">~${tokens} tokens</span></summary>
                    ${s.on ? `<span class="evo-label">In place of the Description</span><pre>${esc(s.evolutia || '(empty)')}</pre>` : ''}
                    ${s.persona ? `<span class="evo-label">In place of your persona's description</span><pre>${esc(s.persona.evolutia || '(empty)')}</pre>` : ''}
                    <span class="evo-label">Next to the reply</span>
                    <pre>${esc(actions || '(no Actions)')}</pre>
                </details>
            </div>`;
    }

    async function render() {
        const s = last;
        if (!follower.chatId()) { body.innerHTML = '<p class="evo-muted">Open a chat to see its Evolutia state.</p>'; return; }
        body.innerHTML = `${tabsHtml(s)}<div class="evo-tab-pane"></div>`;
        const pane = body.querySelector('.evo-tab-pane');

        if (activeTab === 'state') {
            pane.innerHTML = renderStateBody(s);
            return;
        }

        if (activeTab === 'char') {
            const charId = character?.id || s?.charId;
            const charObj = character || (charId ? (CoreAPI.getCharacterById(charId) || await CoreAPI.ensureCharacterById(charId)) : null);
            if (!charObj) {
                pane.innerHTML = '<p class="evo-muted">No character found for this chat.</p>';
                return;
            }
            mountEditor(pane, cardOwner(charObj, ctx), ctx, {
                bigEditor,
                onChanged: () => { follower.reloadSoon(); identity?.refreshSoon(); },
            });
            return;
        }

        if (activeTab === 'persona') {
            const pMeta = s?.persona || s?.personaMeta;
            if (!pMeta?.id) {
                pane.innerHTML = '<p class="evo-muted">No active persona found. Create or select a persona in Settings › Chat first.</p>';
                return;
            }
            mountEditor(pane, personaOwner({ id: pMeta.id, name: pMeta.name || 'Persona' }, ctx), ctx, {
                bigEditor,
                onChanged: () => { follower.reloadSoon(); identity?.refreshSoon(); },
            });
        }
    }

    async function manual(sw) {
        try {
            await ctx.server.call(`/chats/${encodeURIComponent(follower.chatId())}/switch`, 'POST', { ...sw, skip: sw.skip || skip });
            await follower.reload();
            identity?.refreshSoon();
        } catch (e) { CoreAPI.showToast(`Could not switch: ${e.message}`, 'error'); }
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
        show(chatId, char) { character = char; return follower.show(chatId); },
        setCharacter(char) { character = char; return follower.reload(); },
        reloadSoon: () => follower.reloadSoon(),
        rest: () => follower.rest(),
        isOpen: () => follower.isOpen(),
        chatId: () => follower.chatId(),
    };
}
