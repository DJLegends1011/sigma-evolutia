// Evolutia, the client half: the card's Evolutia tab, the Persona Side in Settings › Chat, the conversation
// window, Switch Alter Ego, the card badge, Display Identity and the settings.
import { mountEditor } from './editor.js';
import { cardOwner } from './owners.js';
import { mountPanel } from './panel.js';
import { createIdentity } from './identity.js';
import { mountPersonaSettings } from './persona-settings.js';

let unmountPersonaSettings = () => {};

export default {
    init(ctx) {
        const { CoreAPI } = ctx;
        const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));

        ctx.ui.contribute('character.card.badge', {
            id: 'on',
            render: (row) => (row.ext?.evolutia?.on ? { icon: 'fa-masks-theater', label: 'Evolutia', tone: 'accent' } : null),
        });

        // the full-screen editor long text opens in, one for every card's tab
        const bigEditor = ctx.ui.dialog({ id: 'expand', label: 'Edit', icon: 'fa-expand', className: 'expand-field-modal', size: true });
        ctx.ui.contribute('character.details.tab', {
            id: 'evolutia',
            label: 'Evolutia',
            icon: 'fa-masks-theater',
            render: (pane, { character }) => { mountEditor(pane, cardOwner(character, ctx), ctx, { bigEditor }); },
        });

        // the Persona Side's block in Settings › Chat
        unmountPersonaSettings = mountPersonaSettings(ctx, { bigEditor });

        const identity = createIdentity(ctx);

        let view = null;
        ctx.ui.addChatWindow({
            id: 'evolutia',
            label: 'Evolutia',
            icon: 'fa-masks-theater',
            min: { w: 24, h: 30 },
            size: { w: 30, h: 70 },
            render(body) { view = mountPanel(body, ctx); },
            onOpen: ({ chatId, character }) => view?.show(chatId, character),
            onClose: () => view?.rest(),
        });
        ctx.events.on('conversation.changed', async ({ chatId, charId }) => {
            if (!view?.isOpen() || !chatId) return;
            const character = charId ? (CoreAPI.getCharacterById(charId) || await CoreAPI.ensureCharacterById(charId)) : null;
            view.show(chatId, character);
        });
        for (const name of ['message.created', 'message.updated', 'message.deleted']) {
            ctx.events.on(name, ({ chatId }) => { if (view?.isOpen() && chatId === view.chatId()) view.reloadSoon(); });
        }
        ctx.events.on('character.updated', () => { if (view?.isOpen()) view.reloadSoon(); });
        ctx.events.on('persona.changed', () => { if (view?.isOpen()) view.reloadSoon(); });

        // Switch Alter Ego: a Manual Switch at the newest message, for the character's side or the user's (Persona Side)
        const picker = ctx.ui.dialog({ id: 'switch-ego', label: 'Switch Alter Ego', icon: 'fa-masks-theater' });
        // while a change waits, the active Alter Ego cancels it ("stay") and the coming one finishes it now
        const egoButtons = (st, side) => st.egos.map(e => {
            const active = e.id === st.ego.id, coming = e.id === st.egoMove?.id, waiting = !!st.egoMove;
            const label = active ? (waiting ? ' (active): stay, cancel the change' : ' (active)') : coming ? ' (changing): finish it now' : '';
            return `<button type="button" class="cl-btn ${active ? '' : 'cl-btn-secondary'}" data-ego="${esc(e.id)}" data-side="${side}"${coming ? ' data-finish' : ''} ${active && !waiting ? 'disabled' : ''}>
                ${esc(e.name)}${label}</button>`;
        }).join('');
        ctx.ui.addAction('chat', {
            id: 'switch-ego',
            label: 'Switch Alter Ego',
            icon: 'fa-masks-theater',
            async run({ chatId, character }) {
                let state;
                try { state = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${character ? `?charId=${encodeURIComponent(character.id)}` : ''}`); } catch (e) {
                    CoreAPI.showToast(`Could not read Evolutia's state: ${e.message}`, 'error');
                    return;
                }
                const charSide = state.on && state.egos.length > 1;
                const youSide = state.persona && state.persona.egos.length > 1;
                if (!charSide && !youSide) { CoreAPI.showToast('Nothing to switch: neither this character nor your persona has more than one Alter Ego', 'info'); return; }
                const body = picker.open({ title: 'Switch Alter Ego' });
                body.innerHTML = `
                    <div class="evo-picker">
                        ${charSide ? `<span class="evo-label">${esc(character?.name || 'Character')}</span>${egoButtons(state, 'char')}` : ''}
                        ${youSide ? `<span class="evo-label">You (${esc(state.persona.name)})</span>${egoButtons(state.persona, 'persona')}` : ''}
                        <label class="evo-switch"><input type="checkbox" class="cl-switch-input" data-skip><span class="cl-switch" aria-hidden="true"></span><span>Skip the Actions</span></label>
                    </div>`;
                // one handler per open: the dialog's body is reused
                body.onclick = async (e) => {
                    const b = e.target.closest('button[data-ego]');
                    if (!b) return;
                    try {
                        await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/switch`, 'POST', {
                            kind: 'ego', id: b.dataset.ego, skip: b.hasAttribute('data-finish') || body.querySelector('[data-skip]').checked,
                            ...(b.dataset.side === 'persona' ? { side: 'persona' } : {}),
                        });
                        await picker.close();
                        identity.refreshSoon();
                        if (view?.isOpen()) view.reloadSoon();
                    } catch (err) { CoreAPI.showToast(`Could not switch: ${err.message}`, 'error'); }
                };
            },
        });

        ctx.ui.addSettingsSection((el) => {
            el.innerHTML = `
                <div class="settings-row">
                    <label>Window</label>
                    <input type="number" class="glass-input evo-num" min="1" max="50" data-evo-set="window" value="${esc(ctx.settings.get('window'))}">
                    <span class="settings-hint">How many recent messages Activating Triggers look back over. Enabling and Disabling Triggers read only the newest message.</span>
                </div>
                <div class="settings-row">
                    <label>Action Tries</label>
                    <input type="number" class="glass-input evo-num" min="1" max="10" data-evo-set="tries" value="${esc(ctx.settings.get('tries'))}">
                    <span class="settings-hint">How many replies an Entry or Exit Action is asked of before Evolutia gives up, when its Confirm keywords never appear.</span>
                </div>
                <div class="settings-row">
                    <label>Action Template</label>
                    <input class="glass-input" data-evo-set="template" value="${esc(ctx.settings.get('template'))}">
                    <span class="settings-hint" style="overflow-wrap:anywhere;">How an Action is worded next to the reply; <code>{{action}}</code> is the Action. A card can override each of these in its Evolutia tab.</span>
                </div>`;
            el.addEventListener('change', (e) => {
                const key = e.target.dataset.evoSet;
                if (!key) return;
                ctx.settings.set(key, e.target.type === 'number' ? Math.max(1, Number(e.target.value) || 1) : e.target.value);
            });
        });
    },

    // the host undoes what went through ctx; the Settings block is Evolutia's own markup
    dispose() { unmountPersonaSettings(); },
};
