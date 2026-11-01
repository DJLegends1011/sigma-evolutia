// The Evolutia window in a conversation: the chat's state now, Manual Switches, and what the next prompt carries.

const PHASE = { on: 'on', off: 'off', entering: 'switching on', exiting: 'switching off' };

export function mountPanel(body, ctx) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    let character = null, skip = false, last = null;

    const follower = ctx.chats.follow({
        read: (chatId) => character
            ? ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state?charId=${encodeURIComponent(character.id)}`)
            : Promise.resolve({ on: false }),
        apply: (state) => { last = state; render(); },
        fail: (e) => { body.innerHTML = `<p class="evo-error">Could not read Evolutia's state: ${esc(e.message)}</p>`; },
    });

    function render() {
        const s = last;
        if (!follower.chatId()) { body.innerHTML = '<p class="evo-muted">Open a chat to see its Evolutia state.</p>'; return; }
        if (!s?.on) {
            body.innerHTML = `<p class="evo-muted">Evolutia is off for ${esc(character?.name || 'this character')}. Switch it on in the card's Evolutia tab.</p>`;
            return;
        }
        const tokens = Math.ceil(((s.evolutia || '').length + (s.actionBlock || '').length) / 4);
        body.innerHTML = `
            <div class="evo-panel">
                <div class="evo-now">
                    <span class="evo-label">Alter Ego</span>
                    <strong>${esc(s.ego.name)}</strong>${s.egoMove ? ` <span class="evo-pill evo-entering">→ ${esc(s.egoMove.name)} after the next reply</span>` : ''}
                </div>
                <label class="evo-switch evo-skip"><input type="checkbox" class="cl-switch-input" data-skip ${skip ? 'checked' : ''}><span class="cl-switch" aria-hidden="true"></span>
                    <span>Manual Switches skip their Actions</span></label>
                ${s.egos.map(e => `
                    <section class="evo-panel-ego ${e.id === s.ego.id ? 'is-active' : ''}">
                        <div class="evo-panel-ego-head">
                            <span>${esc(e.name)}${e.id === s.ego.id ? ' <span class="evo-hint">(active)</span>' : ''}</span>
                            ${e.id === s.ego.id || e.id === s.egoMove?.id ? '' : `<button type="button" class="cl-btn cl-btn-secondary evo-small" data-ego="${esc(e.id)}">Switch to</button>`}
                        </div>
                        ${e.fields.map(f => {
                            const isOn = f.phase === 'on' || f.phase === 'entering';
                            return `<div class="evo-panel-field">
                                <span class="evo-panel-name">${esc(f.name)}</span>
                                <span class="evo-pill evo-${f.phase}">${PHASE[f.phase]}</span>
                                ${f.inPrompt ? '<i class="fa-solid fa-check evo-in" title="In the prompt"></i>' : ''}
                                <button type="button" class="cl-btn cl-btn-secondary evo-small" data-ego-id="${esc(e.id)}" data-field="${esc(f.id)}" data-on="${!isOn}">Turn ${isOn ? 'off' : 'on'}</button>
                            </div>`;
                        }).join('') || '<p class="evo-hint">No Fields.</p>'}
                    </section>`).join('')}
                <details class="evo-preview">
                    <summary>Next prompt <span class="evo-hint">~${tokens} tokens</span></summary>
                    <span class="evo-label">In place of the Description</span>
                    <pre>${esc(s.evolutia || '(empty)')}</pre>
                    <span class="evo-label">Next to the reply</span>
                    <pre>${esc(s.actionBlock || '(no Actions)')}</pre>
                </details>
            </div>`;
    }

    async function manual(sw) {
        try {
            await ctx.server.call(`/chats/${encodeURIComponent(follower.chatId())}/switch`, 'POST', { ...sw, skip });
            await follower.reload();
        } catch (e) { CoreAPI.showToast(`Could not switch: ${e.message}`, 'error'); }
    }

    body.addEventListener('change', (e) => { if (e.target.matches('[data-skip]')) skip = e.target.checked; });
    body.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.field) manual({ kind: 'field', ego: b.dataset.egoId, id: b.dataset.field, on: b.dataset.on === 'true' });
        else if (b.dataset.ego) manual({ kind: 'ego', id: b.dataset.ego });
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
