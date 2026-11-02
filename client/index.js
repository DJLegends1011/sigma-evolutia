// Evolutia, the client half: the card's Evolutia tab, the Persona Side in Settings › Chat, the conversation
// window, Switch Alter Ego (on both composer and chat menus), the card badge, Display Identity, settings,
// and cross-extension commands/handle.
import { mountEditor } from './editor.js';
import { cardOwner, resolveAvatarThumb } from './owners.js';
import { mountPanel } from './panel.js';
import { createIdentity } from './identity.js';
import { mountPersonaSettings } from './persona-settings.js';
import { mountAssistantBridge } from './assistant-bridge.js';

let unmountPersonaSettings = () => {};
let unmountAssistantBridge = () => {};

export default {
    init(ctx) {
        const { CoreAPI } = ctx;
        const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
        let activeChatId = null;
        let activeCharacter = null;

        ctx.ui.contribute('character.card.badge', {
            id: 'on',
            render: (row) => (row.ext?.evolutia?.on ? { icon: 'fa-masks-theater', label: 'Evolutia', tone: 'accent' } : null),
        });

        // the full-screen editor long text opens in, one for every card's tab
        const bigEditor = ctx.ui.dialog({ id: 'expand', label: 'Edit', icon: 'fa-expand', className: 'expand-field-modal', size: true });
        const identity = createIdentity(ctx);

        let view = null;
        ctx.ui.contribute('character.details.tab', {
            id: 'evolutia',
            label: 'Evolutia',
            icon: 'fa-masks-theater',
            render: (pane, { character }) => {
                mountEditor(pane, cardOwner(character, ctx), ctx, {
                    bigEditor,
                    onChanged: () => { identity.refreshSoon(); if (view?.isOpen()) view.reloadSoon(); },
                });
            },
        });

        // the Persona Side's block in Settings › Chat
        unmountPersonaSettings = mountPersonaSettings(ctx, { bigEditor });

        // Assistant & Creator Studio bridge (`cl-evolutia-edits` review cards + Saved Prompts seeding)
        unmountAssistantBridge = mountAssistantBridge(ctx, {
            getChatId: () => activeChatId,
            getCharId: () => activeCharacter?.id || null,
            onApplied: () => {
                identity.refreshSoon();
                if (view?.isOpen()) view.reloadSoon();
            },
        });

        ctx.ui.addChatWindow({
            id: 'evolutia',
            label: 'Evolutia',
            icon: 'fa-masks-theater',
            min: { w: 28, h: 35 },
            size: { w: 36, h: 72 },
            render(body) { view = mountPanel(body, ctx, { bigEditor, identity }); },
            onOpen: ({ chatId, character }) => {
                activeChatId = chatId;
                activeCharacter = character || activeCharacter;
                view?.show(chatId, character);
            },
            onClose: () => view?.rest(),
        });
        ctx.events.on('conversation.changed', async ({ chatId, charId }) => {
            activeChatId = chatId || null;
            const character = charId ? (CoreAPI.getCharacterById(charId) || await CoreAPI.ensureCharacterById(charId)) : null;
            activeCharacter = character;
            if (!view?.isOpen() || !chatId) return;
            view.show(chatId, character);
        });
        for (const name of ['message.created', 'message.updated', 'message.deleted']) {
            ctx.events.on(name, ({ chatId }) => { if (view?.isOpen() && chatId === view.chatId()) view.reloadSoon(); });
        }
        ctx.events.on('character.updated', () => { if (view?.isOpen()) view.reloadSoon(); });
        ctx.events.on('persona.changed', () => { if (view?.isOpen()) view.reloadSoon(); });

        // Switch Alter Ego: visual avatar card grid for both the character's side and the user's (Persona Side).
        // Available on both the composer bar (1-click) and the chat menu.
        const picker = ctx.ui.dialog({ id: 'switch-ego', label: 'Switch Alter Ego', icon: 'fa-masks-theater', size: true, min: { w: 360, h: 260 } });
        // while a change waits, the active Alter Ego cancels it ("stay") and the coming one finishes it now
        const egoButtons = (st, side) => `<div class="evo-quick-ego-grid">${st.egos.map(e => {
            const active = e.id === st.ego.id, coming = e.id === st.egoMove?.id, waiting = !!st.egoMove;
            const sub = active ? (waiting ? 'Active · click to stay & cancel' : 'Active') : coming ? 'Changing · click to finish now' : (e.disguise ? 'Disguise' : '');
            const thumb = resolveAvatarThumb(e.avatar, CoreAPI, 96);
            const icon = side === 'persona' ? 'fa-user-astronaut' : 'fa-masks-theater';
            return `<button type="button" class="evo-quick-ego-btn cl-btn ${active ? 'is-active' : 'cl-btn-secondary'}" data-ego="${esc(e.id)}" data-side="${side}"${coming ? ' data-finish' : ''} ${active && !waiting ? 'disabled' : ''}>
                ${thumb ? `<img src="${esc(thumb)}" alt="">` : `<span class="evo-quick-ego-icon"><i class="fa-solid ${icon}"></i></span>`}
                <span class="evo-quick-ego-meta">
                    <span class="evo-quick-ego-name">${esc(e.name)}</span>
                    ${sub ? `<span class="evo-quick-ego-sub">${esc(sub)}</span>` : ''}
                </span>
            </button>`;
        }).join('')}</div>`;

        async function openSwitchEgoDialog({ chatId = activeChatId, character = activeCharacter } = {}) {
            if (!chatId) {
                CoreAPI.showToast('Open a chat first to switch Alter Egos', 'info');
                return;
            }
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
        }

        ctx.ui.addAction('chat', {
            id: 'switch-ego',
            label: 'Switch Alter Ego',
            icon: 'fa-masks-theater',
            run: ({ chatId, character }) => openSwitchEgoDialog({ chatId, character }),
        });

        ctx.ui.addAction('composer', {
            id: 'switch-ego',
            label: 'Switch Alter Ego',
            icon: 'fa-masks-theater',
            run: ({ chatId, character }) => openSwitchEgoDialog({ chatId, character: character || activeCharacter }),
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

        // Cross-extension commands & global handle (for Vocalia and other companion extensions)
        ctx.commands.register('get-state', async ({ chatId = activeChatId, charId = activeCharacter?.id } = {}) => {
            if (!chatId) return null;
            return ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${charId ? `?charId=${encodeURIComponent(charId)}` : ''}`);
        }, { title: 'Evolutia: Get Chat State' });

        ctx.commands.register('switch-ego', async ({ chatId = activeChatId, id, side = 'char', skip = false } = {}) => {
            if (!chatId || !id) throw new Error('chatId and id are required');
            const res = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/switch`, 'POST', {
                kind: 'ego', id, skip: !!skip, ...(side === 'persona' ? { side: 'persona' } : {}),
            });
            identity.refreshSoon();
            if (view?.isOpen()) view.reloadSoon();
            return res;
        }, { title: 'Evolutia: Switch Alter Ego' });

        ctx.commands.register('switch-field', async ({ chatId = activeChatId, ego, id, on = true, side = 'char', skip = false } = {}) => {
            if (!chatId || !ego || !id) throw new Error('chatId, ego, and id are required');
            const res = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/switch`, 'POST', {
                kind: 'field', ego, id, on: !!on, skip: !!skip, ...(side === 'persona' ? { side: 'persona' } : {}),
            });
            identity.refreshSoon();
            if (view?.isOpen()) view.reloadSoon();
            return res;
        }, { title: 'Evolutia: Switch Field' });

        ctx.commands.register('open-switcher', async (opts = {}) => openSwitchEgoDialog(opts), { title: 'Evolutia: Open Alter Ego Switcher' });

        const afterSyncHandler = async () => {
            await ctx.server.call('/rebuild-cards', 'POST', {});
            identity.refreshSoon();
            if (view?.isOpen()) view.reloadSoon();
        };
        ctx.commands.register('after-sync', afterSyncHandler, { title: 'Evolutia: Rebuild Cards After Sync' });
        try { ctx.commands.register('afterSync', afterSyncHandler, { title: 'Evolutia: Rebuild Cards After Sync' }); } catch { /* host requires lowercase */ }

        if (typeof window !== 'undefined') {
            window.__SIGMA_EVOLUTIA__ = Object.freeze({
                version: '0.3.1',
                getState: (opts = {}) => ctx.commands.run('evolutia.get-state', opts),
                switchEgo: (opts = {}) => ctx.commands.run('evolutia.switch-ego', opts),
                switchField: (opts = {}) => ctx.commands.run('evolutia.switch-field', opts),
                openQuickSwitcher: (opts = {}) => openSwitchEgoDialog(opts),
                afterSync: () => afterSyncHandler(),
            });
        }
    },

    // the host undoes what went through ctx; the Settings block and window handle are Evolutia's own
    dispose() {
        unmountPersonaSettings();
        unmountAssistantBridge();
        if (typeof window !== 'undefined' && window.__SIGMA_EVOLUTIA__) {
            delete window.__SIGMA_EVOLUTIA__;
        }
    },
};
