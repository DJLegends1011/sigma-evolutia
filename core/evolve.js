// Field State worked out from a chat's messages (ADR 0004), and what {{evolutia}} and the Action block say.
// Pure: no DOM, no database. Shared by the server and the client.

const egoById = (def, id) => def.alterEgos.find(e => e.id === id);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function keywordMatches(keyword, text) {
    const kw = keyword.trim();
    if (!kw || !text) return false;
    const re = kw.match(/^\/(.+)\/([a-z]*)$/);
    if (re) {
        try { return new RegExp(re[1], re[2].includes('i') ? re[2] : re[2] + 'i').test(text); }
        catch { return false; }
    }
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escRe(kw)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

export function triggerMatches(trigger, text) {
    if (!trigger?.keywords?.length) return false;
    const hit = (k) => keywordMatches(k, text);
    return trigger.mode === 'ALL' ? trigger.keywords.every(hit) : trigger.keywords.some(hit);
}

// The last n messages ending at message end, keeping only the Trigger Sources asked for.
function windowText(messages, end, n, sources) {
    const out = [];
    for (let i = end; i >= 0 && out.length < n; i--) out.push(messages[i]);
    return out.filter(m => sources[m.role]).map(m => m.text).join('\n');
}

function initialState(def) {
    const fields = {};
    for (const ego of def.alterEgos) {
        fields[ego.id] = {};
        for (const f of ego.fields) fields[ego.id][f.id] = { phase: f.startsOn ? 'on' : 'off', since: -1, tries: 0 };
    }
    return { ego: def.alterEgos[0].id, egoMove: null, fields, changes: [] };
}

// timeline[0] is the state before any message; timeline[i + 1] the state after message i.
export function deriveTimeline(def, messages, opts) {
    const timeline = [initialState(def)];
    messages.forEach((_, i) => timeline.push(step(def, timeline[i], messages, i, opts)));
    return timeline;
}

function switchField(st, ego, f, on, i, skip = false) {
    const fs = st.fields[ego.id][f.id];
    if (on) {
        if (fs.phase === 'exiting') fs.phase = 'on';
        else if (fs.phase === 'off') { fs.phase = f.entryAction && !skip ? 'entering' : 'on'; fs.since = i; fs.tries = 0; }
    } else {
        if (fs.phase === 'entering') fs.phase = 'off';
        else if (fs.phase === 'on') { fs.phase = f.exitAction && !skip ? 'exiting' : 'off'; fs.since = i; fs.tries = 0; }
    }
}

function switchEgo(def, st, toId, i, skip = false) {
    if (st.egoMove?.to === toId) return;
    if (st.egoMove && toId === st.ego) { st.egoMove = null; return; }
    if (toId === st.ego || !egoById(def, toId)) return;
    const from = egoById(def, st.ego), to = egoById(def, toId);
    if (!skip && (from.exitAction || to.entryAction)) st.egoMove = { to: toId, since: i, tries: 0 };
    else { st.ego = toId; st.egoMove = null; }
}

// The state after message i, from the state before it.
function step(def, prev, messages, i, opts) {
    const st = structuredClone(prev);
    st.changes = [];
    const msg = messages[i];

    // A reply was written: an Action asked for before it is done if the reply confirms it (or it has
    // no Confirm Keywords); otherwise it is asked again, and given up after opts.tries replies.
    const confirmed = (confirm) => !confirm?.keywords?.length || triggerMatches(confirm, msg.text);
    if (msg.role === 'char') {
        for (const e of def.alterEgos) for (const f of e.fields) {
            const fs = st.fields[e.id][f.id];
            if (fs.since >= i || (fs.phase !== 'entering' && fs.phase !== 'exiting')) continue;
            const entering = fs.phase === 'entering';
            if (confirmed(entering ? f.entryConfirm : f.exitConfirm)) fs.phase = entering ? 'on' : 'off';
            else if (++fs.tries >= opts.tries) fs.phase = entering ? 'off' : 'on';
        }
        if (st.egoMove && st.egoMove.since < i) {
            const from = egoById(def, st.ego), to = egoById(def, st.egoMove.to);
            const confirm = { keywords: [...(from.exitConfirm?.keywords || []), ...(to.entryConfirm?.keywords || [])] };
            if (confirmed(confirm)) { st.ego = to.id; st.egoMove = null; }
            else if (++st.egoMove.tries >= opts.tries) st.egoMove = null;
        }
    }

    for (const sw of msg.manual || []) {
        if (sw.kind === 'ego') { switchEgo(def, st, sw.id, i, sw.skip); continue; }
        const e = egoById(def, sw.ego), f = e?.fields.find(x => x.id === sw.id);
        if (f) switchField(st, e, f, sw.on, i, sw.skip);
    }

    const ego = egoById(def, st.ego);
    for (const f of ego.fields) {
        const text = f.sources[msg.role] ? msg.text : '';
        if (triggerMatches(f.disabling, text)) switchField(st, ego, f, false, i);
        else if (triggerMatches(f.enabling, text)) switchField(st, ego, f, true, i);
    }

    // The first other Alter Ego whose Entry Trigger matches takes over.
    for (const other of def.alterEgos) {
        if (other.id === st.ego || other.id === st.egoMove?.to) continue;
        if (triggerMatches(other.entry, other.entrySources[msg.role] ? msg.text : '')) { switchEgo(def, st, other.id, i); break; }
    }
    return st;
}

// What the prompt says when its history ends at message k (-1 for none).
export function promptFor(def, messages, timeline, k, opts) {
    const st = timeline[k + 1];
    const ego = egoById(def, st.ego);
    const parts = [], actions = [];
    if (ego.promptName) parts.push(`${opts.charName} is currently going by: ${ego.promptName}.`);
    for (const f of ego.fields) {
        const phase = st.fields[ego.id][f.id].phase;
        const gated = f.activating.keywords.length > 0;
        const admitted = !gated || triggerMatches(f.activating, windowText(messages, k, opts.window, f.sources));
        if ((phase === 'on' || phase === 'exiting') && admitted) parts.push(`## ${f.name}\n${f.content}`);
        if (phase === 'entering') actions.push(f.entryAction);
        if (phase === 'exiting') actions.push(f.exitAction);
    }
    if (st.egoMove) {
        const to = egoById(def, st.egoMove.to);
        if (ego.exitAction) actions.push(ego.exitAction);
        if (to.entryAction) actions.push(to.entryAction);
    }
    return {
        evolutia: parts.join('\n\n'),
        actionBlock: actions.map(a => opts.template.replace('{{action}}', () => a)).join('\n'),
    };
}

// The Display Identity of message i: the Alter Ego whose prompt wrote it (null avatar: the card's own).
export function identityFor(def, timeline, i, opts) {
    const ego = egoById(def, timeline[i].ego);
    return { name: ego.displayName || opts.charName, avatar: ego.avatar || null };
}
