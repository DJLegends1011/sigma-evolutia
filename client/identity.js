// Display Identity (ADR 0005): each reply shows the Alter Ego whose prompt wrote it. Sigma has no door for a
// message's name or avatar, so this draws them on the message element message.enhance hands over, and puts
// the card's own back whenever there is no other to show. Everything that knows Sigma's markup is here.

const NAME = '.chat-conv-msg-name';
const AVATAR = 'img.chat-conv-msg-avatar';

export function createIdentity(ctx) {
    const { CoreAPI } = ctx;
    let chatId = null, charId = null, identities = {}, reading = 0;

    function draw(el, seq) {
        const who = identities[seq];
        const name = el.querySelector(NAME);
        const img = el.querySelector(AVATAR);
        if (name) {
            el.dataset.evoName ??= name.textContent;
            name.textContent = who?.name ?? el.dataset.evoName;
        }
        if (img) {
            el.dataset.evoSrc ??= img.getAttribute('src') || '';
            const src = who?.avatar?.media ? CoreAPI.thumbUrl('media', who.avatar.media, 192)
                : who?.avatar?.persona ? CoreAPI.thumbUrl('persona', who.avatar.persona, 192)
                : el.dataset.evoSrc;
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        }
    }

    function drawAll() {
        for (const el of document.querySelectorAll('.chat-conv-msg[data-seq]')) draw(el, Number(el.dataset.seq));
    }

    async function refresh() {
        const mine = ++reading;
        if (!chatId) { identities = {}; drawAll(); return; }
        try {
            const state = await ctx.server.call(`/chats/${encodeURIComponent(chatId)}/state${charId ? `?charId=${encodeURIComponent(charId)}` : ''}`);
            if (mine !== reading) return;
            // the character's replies and the user's messages, each by its own side's Alter Egos
            identities = { ...(state.on ? state.identities : {}), ...(state.persona?.identities || {}) };
        } catch { if (mine === reading) identities = {}; }
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
