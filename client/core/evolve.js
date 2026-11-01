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

function stripKeywordFromText(keyword, text) {
    const kw = keyword.trim();
    if (!kw || !text) return text;
    const re = kw.match(/^\/(.+)\/([a-z]*)$/);
    if (re) {
        try {
            let flags = re[2] || '';
            if (!flags.includes('i')) flags += 'i';
            if (!flags.includes('g')) flags += 'g';
            return text.replace(new RegExp(re[1], flags), '');
        } catch { return text; }
    }
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escRe(kw)})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    return text.replace(pattern, '$1');
}

export function stripTriggerKeywords(trigger, text) {
    let out = String(text ?? '');
    for (const kw of trigger?.keywords || []) {
        out = stripKeywordFromText(kw, out);
    }
    return out.replace(/[ \t]{2,}/g, ' ').trim();
}

// Checks whether a message triggers any stripTriggers-enabled Field or Alter Ego on this side;
// returns the stripped text and the equivalent Manual Switches so deriveTimeline still sees the transition.
export function stripTriggeredMessage(def, st, role, text, side = 'char') {
    if (!def || !st || !text) return { text, manual: [] };
    let nextText = String(text);
    const manual = [];
    const sideTag = side === 'persona' ? { side: 'persona' } : {};
    const ego = egoById(def, st.ego);
    if (ego) {
        for (const f of ego.fields) {
            if (!f.stripTriggers || !f.sources?.[role]) continue;
            if (triggerMatches(f.disabling, nextText)) {
                nextText = stripTriggerKeywords(f.disabling, nextText) || nextText;
                manual.push({ kind: 'field', ego: ego.id, id: f.id, on: false, ...sideTag });
            } else if (triggerMatches(f.enabling, nextText)) {
                nextText = stripTriggerKeywords(f.enabling, nextText) || nextText;
                manual.push({ kind: 'field', ego: ego.id, id: f.id, on: true, ...sideTag });
            }
        }
    }
    for (const other of def.alterEgos) {
        if (other.id === st.ego || other.id === st.egoMove?.to) continue;
        if (other.stripTriggers && other.entrySources?.[role] && triggerMatches(other.entry, nextText)) {
            nextText = stripTriggerKeywords(other.entry, nextText) || nextText;
            manual.push({ kind: 'ego', id: other.id, ...sideTag });
            break;
        }
    }
    return { text: nextText, manual };
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
    // the change already waiting: skipped, it happens now; asked again, it keeps waiting
    if (st.egoMove?.to === toId) {
        if (skip) { st.ego = toId; st.egoMove = null; }
        return;
    }
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

// Whether a change takes effect in the reply asked to narrate it (ADR 0007): on unless switched off.
const withAction = (x) => x?.withAction !== false;

// What the prompt says when its history ends at message k (-1 for none).
export function promptFor(def, messages, timeline, k, opts) {
    const st = timeline[k + 1];
    const from = egoById(def, st.ego);
    const to = st.egoMove ? egoById(def, st.egoMove.to) : null;
    // an Alter Ego change already in effect for the reply narrating it shows the new Alter Ego
    const ego = to && withAction(to) ? to : from;
    const parts = [], actions = [], rows = [];
    if (ego.disguise) {
        const asName = ego.promptName || ego.displayName || ego.name;
        parts.push(`${opts.charName} is currently disguised / presenting in-scene as: ${asName}. Stay consistent with ${asName}'s identity, appearance, and voice in the scene.`);
    } else if (ego.promptName) {
        parts.push(`${opts.charName} is currently going by: ${ego.promptName}.`);
    }
    for (const f of ego.fields) {
        const phase = st.fields[ego.id][f.id].phase;
        const gated = f.activating.keywords.length > 0;
        const admitted = !gated || triggerMatches(f.activating, windowText(messages, k, opts.window, f.sources));
        const present = phase === 'on' || (phase === 'entering' && withAction(f)) || (phase === 'exiting' && !withAction(f));
        const inPrompt = present && admitted;
        if (inPrompt) parts.push(`## ${f.name}\n${f.content}`);
        rows.push({ ego: ego.id, id: f.id, inPrompt });
        if (phase === 'entering') actions.push(f.entryAction);
        if (phase === 'exiting') actions.push(f.exitAction);
    }
    if (to) {
        if (from.exitAction) actions.push(from.exitAction);
        if (to.entryAction) actions.push(to.entryAction);
    }
    return {
        evolutia: parts.join('\n\n'),
        actionBlock: actions.map(a => opts.template.replace('{{action}}', () => a)).join('\n'),
        rows,
    };
}

// The Display Identity of message i: the Alter Ego whose prompt wrote it (null avatar: the card's own).
export function identityFor(def, timeline, i, opts) {
    const ego = egoById(def, timeline[i].ego);
    return { name: ego.displayName || opts.charName, avatar: ego.avatar || null };
}

// Optional header badge for message i: shown when a non-default or disguise Alter Ego is active,
// or when non-default Fields (startsOn === false) have been switched on.
export function badgeFor(def, timeline, i) {
    const st = timeline[i];
    if (!st) return null;
    const ego = egoById(def, st.ego);
    if (!ego) return null;
    const isAltEgo = ego.id !== def.alterEgos[0]?.id;
    const disguise = !!ego.disguise;
    const extraFields = ego.fields
        .filter(f => !f.startsOn && st.fields[ego.id]?.[f.id]?.phase === 'on')
        .map(f => f.name);
    if (!isAltEgo && !disguise && !extraFields.length) return null;
    const parts = [];
    if (disguise) parts.push('Disguise');
    else if (isAltEgo) parts.push(ego.name);
    if (extraFields.length) parts.push(...extraFields.slice(0, 2));
    return { text: parts.join(' · '), disguise };
}
