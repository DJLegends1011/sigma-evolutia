// The Evolutia window in a conversation: the chat's state now, Manual Switches, and what the next prompt carries.

const PHASE = { on: 'on', off: 'off', entering: 'switching on', exiting: 'switching off' };

export function mountPanel(body, ctx) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    let character = null, skip = false, last = null;

    const follower = ctx.chats.follow({
        read: (chatId) => ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${character ? `?charId=${encodeURIComponent(character.id)}` : ''}`),
        apply: (state) => { last = state; render(); },
        fail: (e) => { body.innerHTML = `<p class="evo-error">Could not read Evolutia's state: ${esc(e.message)}</p>`; },
    });

    // One side's state: the character's, or the user's (side 'persona') under its own heading.
    function sideHtml(st, side, title) {
        const tag = side === 'persona' ? ' data-side="persona"' : '';
        return `
            <div class="evo-now">
                <span class="evo-label">${esc(title)}</span>
                <strong>${esc(st.ego.name)}</strong>${st.egoMove ? ` <span class="evo-pill evo-entering">→ ${esc(st.egoMove.name)} after the next reply</span>` : ''}
            </div>
            ${st.egos.map(e => `
                <section class="evo-panel-ego ${e.id === st.ego.id ? 'is-active' : ''}">
                    <div class="evo-panel-ego-head">
                        <span>${esc(e.name)}${e.id === st.ego.id ? ' <span class="evo-hint">(active)</span>' : ''}</span>
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
                </section>`).join('')}`;
    }

    function render() {
        const s = last;
        if (!follower.chatId()) { body.innerHTML = '<p class="evo-muted">Open a chat to see its Evolutia state.</p>'; return; }
        if (!s?.on && !s?.persona) {
            body.innerHTML = `<p class="evo-muted">Evolutia is off for ${esc(character?.name || 'this character')} and for your persona. Switch it on in the card's Evolutia tab, or for a persona in Settings › Chat.</p>`;
            return;
        }
        const text = [s.evolutia, s.persona?.evolutia].filter(Boolean).join('\n\n');
        const actions = [s.on && s.actionBlock, s.persona?.actionBlock].filter(Boolean).join('\n');
        const tokens = Math.ceil((text.length + actions.length) / 4);
        body.innerHTML = `
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

    async function manual(sw) {
        try {
            await ctx.server.call(`/chats/${encodeURIComponent(follower.chatId())}/switch`, 'POST', { ...sw, skip: sw.skip || skip });
            await follower.reload();
        } catch (e) { CoreAPI.showToast(`Could not switch: ${e.message}`, 'error'); }
    }

    body.addEventListener('change', (e) => { if (e.target.matches('[data-skip]')) skip = e.target.checked; });
    body.addEventListener('click', (e) => {
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
