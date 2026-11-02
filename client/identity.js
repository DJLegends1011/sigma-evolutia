// Display Identity (ADR 0005): each reply shows the Alter Ego whose prompt wrote it, plus optional Alter Ego /
// Disguise / active Field pill badges. Sigma has no door for a message's name or avatar, so this draws them on
// the message element message.enhance hands over, and puts the card's own back whenever there is no other to show.
import { resolveAvatarThumb } from './owners.js';

const NAME = '.chat-conv-msg-name';
const FRAME = '.chat-conv-msg-avatar-frame';
const NATIVE_AVATAR = 'img.chat-conv-msg-avatar:not([data-evo-synth-avatar])';
const SYNTH_AVATAR = 'img.chat-conv-msg-avatar[data-evo-synth-avatar]';
const TEXT = '.chat-conv-msg-text';

// The avatar half of draw: paints the Alter Ego's portrait over the message's own, and puts the
// original back when there is no identity to show. Sigma renders the portrait as an <img>, or as a
// plain glyph (<i> in .chat-conv-msg-avatar-frame) when a persona has no picture — so a synthesized
// <img> is put into the frame (its markup remembered in dataset.evoAvatarHtml) and swapped back out
// later. Pure DOM against el, which lets tests drive it with a lightweight mock element.
export function drawAvatar(el, src, doc = (typeof document !== 'undefined' ? document : el?.ownerDocument)) {
    const img = el?.querySelector(NATIVE_AVATAR);
    if (img) {
        el.dataset.evoSrc ??= img.getAttribute('src') || '';
        const target = src || el.dataset.evoSrc;
        if (img.getAttribute('src') !== target) img.setAttribute('src', target);
        return;
    }
    const frame = el?.querySelector(FRAME);
    if (!frame) return;
    if (src) {
        el.dataset.evoAvatarHtml ??= frame.innerHTML;
        let synth = frame.querySelector(SYNTH_AVATAR);
        if (!synth) {
            synth = doc.createElement('img');
            synth.className = 'chat-conv-msg-avatar';
            synth.setAttribute('data-evo-synth-avatar', '1');
            synth.setAttribute('src', src);
            synth.setAttribute('alt', '');
            synth.setAttribute('loading', 'lazy');
            frame.replaceChildren(synth);
        } else if (synth.getAttribute('src') !== src) {
            synth.setAttribute('src', src);
        }
    } else if (el.dataset.evoAvatarHtml !== undefined) {
        frame.innerHTML = el.dataset.evoAvatarHtml;
        delete el.dataset.evoAvatarHtml;
    }
}

export function createIdentity(ctx) {
    const { CoreAPI } = ctx;
    let chatId = null, charId = null, identities = {}, badges = {}, stripped = {}, reading = 0;

    function draw(el, seq) {
        const who = identities[seq];
        const badge = badges[seq];
        const strippedText = stripped[seq];
        const name = el.querySelector(NAME);
        const textEl = el.querySelector(TEXT);
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
        drawAvatar(el, resolveAvatarThumb(who?.avatar, CoreAPI, 192) || '');
        if (textEl && typeof CoreAPI?.formatChatText === 'function') {
            if (strippedText != null) {
                el.dataset.evoOrigHtml ??= textEl.innerHTML;
                if (el.dataset.evoStripped !== strippedText) {
                    el.dataset.evoStripped = strippedText;
                    const formatted = CoreAPI.formatChatText(strippedText);
                    textEl.innerHTML = typeof CoreAPI.safePurify === 'function' ? CoreAPI.safePurify(formatted) : formatted;
                }
            } else if (el.dataset.evoOrigHtml !== undefined) {
                textEl.innerHTML = el.dataset.evoOrigHtml;
                delete el.dataset.evoOrigHtml;
                delete el.dataset.evoStripped;
            }
        }
    }

    function drawAll() {
        if (typeof document === 'undefined') return;
        for (const el of document.querySelectorAll('.chat-conv-msg[data-seq]')) draw(el, Number(el.dataset.seq));
    }

    async function refresh() {
        const mine = ++reading;
        if (!chatId) { identities = {}; badges = {}; stripped = {}; drawAll(); return; }
        try {
            const state = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${charId ? `?charId=${encodeURIComponent(charId)}` : ''}`);
            if (mine !== reading) return;
            // the character's replies and the user's messages, each by its own side's Alter Egos
            identities = { ...(state.on ? state.identities : {}), ...(state.persona?.identities || {}) };
            badges = { ...(state.on ? state.badges : {}), ...(state.persona?.badges || {}) };
            stripped = state.stripped || {};
        } catch {
            if (mine === reading) { identities = {}; badges = {}; stripped = {}; }
        }
        drawAll();
    }

    ctx.hooks.add('message.render', (html, { chatId: shown, seq, format }) => {
        if (shown === chatId && stripped[seq] != null && typeof format === 'function') {
            return format(stripped[seq]);
        }
        return html;
    });
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
