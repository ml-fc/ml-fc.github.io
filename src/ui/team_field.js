const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = n => Math.max(7, Math.min(93, n));
export function defaultPositions(players) {
  const result = {};
  const outfield = players.slice(1);
  const lines = Math.max(1, Math.ceil(outfield.length / 4));
  if (players.length) result[players[0]] = { positionX: 50, positionY: 86 };
  let offset = 0;
  for (let line = 0; line < lines; line++) {
    const count = Math.ceil((outfield.length - offset) / (lines - line));
    for (let i = 0; i < count; i++) result[outfield[offset++]] = { positionX: 100 * (i + 1) / (count + 1), positionY: 16 + (lines - 1 - line) * 56 / lines };
  }
  return result;
}
export function positionMap(rows = []) {
  return Object.fromEntries(rows.filter(r => Number.isFinite(r.positionX) && Number.isFinite(r.positionY)).map(r => [r.playerName, {positionX:r.positionX, positionY:r.positionY}]));
}
export function positionRows(groups, positions) {
  return groups.flatMap(g => {
    const defaults = defaultPositions(g.players);
    return g.players.map(playerName => ({playerName, team:g.team, ...(positions[playerName] || defaults[playerName])}));
  });
}
// One field surface for assignment, captain selection and free positioning.
export function mountTeamField(root, options) {
  let active = options.groups.some(g => g.team === root.dataset.activeTeam) ? root.dataset.activeTeam : options.groups[0]?.team;
  let selected = '';
  let pending = '';
  let drag = null;
  let suppressClick = false;
  const positions = options.positions;
  const editable = !options.disabled;
  function group() { return options.groups.find(g => g.team === active); }
  function changed() { options.onChange?.(); }
  function move(name, x, y) { positions[name] = {positionX:clamp(x),positionY:clamp(y)}; changed(); }
  function draw() {
    const g = group();
    if (!g) return;
    const defaults = defaultPositions(g.players);
    root.innerHTML = `<div class="fieldTabs" role="group" aria-label="Team">${options.groups.map(t => `<button type="button" class="btn ${active === t.team ? 'primary' : 'gray'}" data-tab="${esc(t.team)}" aria-pressed="${active === t.team}">${esc(t.label)} · ${t.players.length}</button>`).join('')}</div>
      <p class="small">${editable ? 'Drag players, or select a player then tap the field. Arrow keys move the selected player.' : 'Saved team positions'}</p>
      ${options.pool && editable ? `<label class="field__label">Add to ${esc(g.label)}<select class="input" data-pool><option value="">Choose an unassigned player</option>${options.pool.filter(p => !options.groups.some(t => t.players.includes(p))).map(p => `<option>${esc(p)}</option>`).join('')}</select></label>` : ''}
      <div class="teamField ${g.team === 'ORANGE' ? 'teamField--orange' : ''}" role="group" aria-label="${esc(g.label)} field"><div class="teamField__circle" aria-hidden="true"></div>${g.players.map(p => {
        const pos = positions[p] || defaults[p];
        return `<button type="button" class="fieldPlayer ${selected === p ? 'isSelected' : ''}" data-player="${esc(p)}" style="left:${clamp(pos.positionX)}%;top:${clamp(pos.positionY)}%" aria-label="${esc(p)}${p === g.captain ? ', captain' : ''}" aria-pressed="${selected === p}" ${editable ? '' : 'disabled'}><i>${p === g.captain ? 'C' : '•'}</i><span>${esc(p)}</span></button>`;
      }).join('')}${!g.players.length ? '<span class="teamField__empty">Add players to build your team</span>' : ''}</div>
      <div class="fieldActions">${selected ? `<strong>${esc(selected)}</strong>` : '<span class="small">Select a player on the field</span>'}${selected && options.onCaptain && editable ? '<button class="btn gray tiny" data-captain>Make captain</button>' : ''}${selected && options.onRemove && editable ? '<button class="btn gray tiny" data-remove>Unassign</button>' : ''}${selected && options.onTransfer && editable ? '<button class="btn gray tiny" data-transfer>Move to other team</button>' : ''}${editable ? '<button class="btn gray tiny" data-reset>Auto positions</button>' : ''}</div><span class="small" role="status" data-field-status>${esc(pending)}</span>`;
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { active = b.dataset.tab; root.dataset.activeTeam = active; selected = ''; draw(); });
    const pool = root.querySelector('[data-pool]');
    if (pool) pool.onchange = () => { if (pool.value) options.onAssign(pool.value, active); };
    const field = root.querySelector('.teamField');
    field.onclick = e => {
      if (!editable) return;
      if (suppressClick) { suppressClick = false; return; }
      const player = e.target.closest('[data-player]');
      if (player) { selected = player.dataset.player; draw(); root.querySelectorAll('[data-player]').forEach(b => { if (b.dataset.player === selected) b.focus({preventScroll:true}); }); }
      else if (selected) { const r = field.getBoundingClientRect(); move(selected, (e.clientX-r.left)/r.width*100, (e.clientY-r.top)/r.height*100); draw(); }
    };
    root.querySelectorAll('[data-player]').forEach(b => {
      b.onkeydown = e => {
        const delta = {ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[e.key];
        if (!delta || !editable) return;
        e.preventDefault(); selected = b.dataset.player;
        const p = positions[selected] || defaults[selected]; move(selected,p.positionX+delta[0],p.positionY+delta[1]);
        b.style.left = `${positions[selected].positionX}%`; b.style.top = `${positions[selected].positionY}%`;
      };
      b.onpointerdown = e => {
        if (!editable || e.button !== 0) return;
        drag = {name:b.dataset.player,x:e.clientX,y:e.clientY,moved:false}; b.setPointerCapture(e.pointerId);
      };
      b.onpointermove = e => {
        if (!drag) return;
        if (Math.hypot(e.clientX-drag.x,e.clientY-drag.y) < 5 && !drag.moved) return;
        drag.moved = true;
        const r = field.getBoundingClientRect();
        const x = clamp((e.clientX-r.left)/r.width*100), y = clamp((e.clientY-r.top)/r.height*100);
        b.style.left = `${x}%`; b.style.top = `${y}%`; drag.position = {positionX:x,positionY:y};
      };
      b.onpointerup = () => {
        if (!drag) return;
        if (drag.moved) { selected = drag.name; positions[selected] = drag.position; suppressClick = true; changed(); drag = null; draw(); setTimeout(() => { suppressClick = false; }, 0); }
        drag = null;
      };
      b.onpointercancel = () => { drag = null; draw(); };
    });
    const bind = (selector, fn) => { const b = root.querySelector(selector); if (b) b.onclick = fn; };
    bind('[data-captain]', () => options.onCaptain(selected,active));
    bind('[data-remove]', () => options.onRemove(selected));
    bind('[data-transfer]', () => options.onTransfer(selected,active));
    bind('[data-reset]', () => { for (const p of g.players) delete positions[p]; changed(); draw(); });
  }
  draw();
  return { status(message) { pending = message; root.querySelector('[data-field-status]').textContent = message; } };
}
