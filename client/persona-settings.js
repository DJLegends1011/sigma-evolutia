// The Persona Side's place in Settings › Chat (ADR 0006): a block below the Personas list, with a persona picker
// and the editor in a dialog. Sigma has no extension slot there, so the block is put beside the list (which Sigma
// redraws wholesale) and taken out again when Evolutia is switched off.
import { mountEditor } from './editor.js';
import { personaOwner } from './owners.js';

export function mountPersonaSettings(ctx, { bigEditor }) {
    const { CoreAPI } = ctx;
    const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
    const personasGroup = document.getElementById('personaList')?.closest('.settings-group');
    if (!personasGroup) { ctx.log('Settings › Chat has no Personas list here; the persona block is skipped'); return () => {}; }

    const block = document.createElement('div');
    block.className = 'settings-group evo-persona-settings';
    block.innerHTML = `
        <div class="settings-group-title"><i class="fa-solid fa-masks-theater"></i> Evolutia for personas</div>
        <p class="settings-hint">Fields, Triggers and Alter Egos for <em>you</em>, as a card has them for its character. A chat uses its own persona, else the active one.</p>
        <div class="settings-row">
            <label>Persona</label>
            <select class="cl-select-fluid" data-evo-persona></select>
        </div>
        <div class="settings-row">
            <button type="button" class="settings-action-btn" data-evo-open><i class="fa-solid fa-pen"></i> Open the Evolutia editor</button>
            <span class="settings-hint" data-evo-state></span>
        </div>`;
    personasGroup.after(block);
    const select = block.querySelector('[data-evo-persona]');
    const state = block.querySelector('[data-evo-state]');
    let personas = [];

    async function refresh() {
        try {
            const res = await CoreAPI.apiRequest('/personas');
            const body = await res.json();
            personas = body.personas || [];
            const keep = select.value || body.activeId;
            select.innerHTML = personas.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === body.activeId ? ' (active)' : ''}</option>`).join('');
            if (personas.some(p => p.id === keep)) select.value = keep;
            CoreAPI.initCustomSelect(select);
            await showState();
        } catch (e) { state.textContent = `Could not read the personas: ${e.message}`; }
    }
    async function showState() {
        const id = select.value;
        if (!id) { state.textContent = 'No personas yet: make one above.'; return; }
        try {
            const got = await ctx.server.call(`/personas/${encodeURIComponent(id)}`);
            state.textContent = got.on ? 'Evolutia is on for this persona.' : 'Evolutia is off for this persona.';
        } catch { state.textContent = ''; }
    }

    const editorDialog = ctx.ui.dialog({ id: 'persona-editor', label: 'Evolutia', icon: 'fa-masks-theater', size: true, onClose: () => refresh() });
    block.querySelector('[data-evo-open]').addEventListener('click', () => {
        const persona = personas.find(p => p.id === select.value);
        if (!persona) return;
        const body = editorDialog.open({ title: `Evolutia: ${persona.name}` });
        body.classList.add('evo-dialog-body');
        mountEditor(body, personaOwner(persona, ctx), ctx, { bigEditor });
    });
    select.addEventListener('input', showState);
    ctx.events.on('persona.changed', () => refresh());

    refresh();
    return () => block.remove();
}
