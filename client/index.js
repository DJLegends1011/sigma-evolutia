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

        // Switch Alter Ego: a Manual Switch at the newest message
        const picker = ctx.ui.dialog({ id: 'switch-ego', label: 'Switch Alter Ego', icon: 'fa-masks-theater' });
        ctx.ui.addAction('chat', {
            id: 'switch-ego',
            label: 'Switch Alter Ego',
            icon: 'fa-masks-theater',
            when: ({ character }) => !!character,
            async run({ chatId, character }) {
                let state;
                try { state = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state?charId=${encodeURIComponent(character.id)}`); } catch (e) {
                    CoreAPI.showToast(`Could not read Evolutia's state: ${e.message}`, 'error');
                    return;
                }
                if (!state.on) { CoreAPI.showToast(`Evolutia is off for ${character.name}`, 'info'); return; }
                const body = picker.open({ title: `Switch ${character.name}'s Alter Ego` });
                body.innerHTML = `
                    <div class="evo-picker">
                        ${state.egos.map(e => `<button type="button" class="cl-btn ${e.id === state.ego.id ? '' : 'cl-btn-secondary'}" data-ego="${esc(e.id)}" ${e.id === state.ego.id ? 'disabled' : ''}>
                            ${esc(e.name)}${e.id === state.ego.id ? ' (active)' : ''}</button>`).join('')}
                        <label class="evo-switch"><input type="checkbox" class="cl-switch-input" data-skip><span class="cl-switch" aria-hidden="true"></span><span>Skip the Actions</span></label>
                    </div>`;
                body.addEventListener('click', async (e) => {
                    const b = e.target.closest('button[data-ego]');
                    if (!b) return;
                    try {
                        await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/switch`, 'POST', { kind: 'ego', id: b.dataset.ego, skip: body.querySelector('[data-skip]').checked });
                        await picker.close();
                        identity.refreshSoon();
                        if (view?.isOpen()) view.reloadSoon();
                    } catch (err) { CoreAPI.showToast(`Could not switch: ${err.message}`, 'error'); }
                });
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
