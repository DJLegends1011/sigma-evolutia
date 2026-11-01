// Display Identity (ADR 0005): each reply shows the Alter Ego whose prompt wrote it, plus optional Alter Ego /
// Disguise / active Field pill badges. Sigma has no door for a message's name or avatar, so this draws them on
// the message element message.enhance hands over, and puts the card's own back whenever there is no other to show.
import { resolveAvatarThumb } from './owners.js';

const NAME = '.chat-conv-msg-name';
const AVATAR = 'img.chat-conv-msg-avatar';

export function createIdentity(ctx) {
    const { CoreAPI } = ctx;
    let chatId = null, charId = null, identities = {}, badges = {}, reading = 0;

    function draw(el, seq) {
        const who = identities[seq];
        const badge = badges[seq];
        const name = el.querySelector(NAME);
        const img = el.querySelector(AVATAR);
        if (name) {
            el.dataset.evoName ??= name.textContent;
            name.textContent = who?.name ?? el.dataset.evoName;

            let badgeEl = el.querySelector('.evo-msg-badge');
            if (badge?.text) {
                if (!badgeEl) {
                    badgeEl = document.createElement('span');
                    name.insertAdjacentElement('afterend', badgeEl);
                }
                badgeEl.className = `evo-msg-badge${badge.disguise ? ' is-disguise' : ''}`;
                badgeEl.textContent = badge.text;
            } else if (badgeEl) {
                badgeEl.remove();
            }
        }
        if (img) {
            el.dataset.evoSrc ??= img.getAttribute('src') || '';
            const src = resolveAvatarThumb(who?.avatar, CoreAPI, 192) || el.dataset.evoSrc;
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        }
    }

    function drawAll() {
        if (typeof document === 'undefined') return;
        for (const el of document.querySelectorAll('.chat-conv-msg[data-seq]')) draw(el, Number(el.dataset.seq));
    }

    async function refresh() {
        const mine = ++reading;
        if (!chatId) { identities = {}; badges = {}; drawAll(); return; }
        try {
            const state = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${charId ? `?charId=${encodeURIComponent(charId)}` : ''}`);
            if (mine !== reading) return;
            // the character's replies and the user's messages, each by its own side's Alter Egos
            identities = { ...(state.on ? state.identities : {}), ...(state.persona?.identities || {}) };
            badges = { ...(state.on ? state.badges : {}), ...(state.persona?.badges || {}) };
        } catch {
            if (mine === reading) { identities = {}; badges = {}; }
        }
        drawAll();
    }

    ctx.hooks.add('message.enhance', ({ chatId: shown, seq, el }) => { if (shown === chatId) draw(el, seq); });
    ctx.events.on('conversation.changed', (e) => { chatId = e.chatId; charId = e.charId; refresh(); });

    let timer = null;
    const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
    for (const name of ['message.created', 'message.updated', 'message.deleted']) {
        ctx.events.on(name, (e) => { if (e.chatId === chatId) refreshSoon(); });
    }
    ctx.events.on('character.updated', ({ ids }) => { if (ids.includes(charId)) refreshSoon(); });
    ctx.events.on('persona.changed', () => refreshSoon());

    return { refresh, refreshSoon };
}
