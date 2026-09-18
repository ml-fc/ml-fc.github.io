const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = n => Math.max(7, Math.min(93, n));
export function defaultPositions(players) {
  const result = Object.create(null);
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
// Positions stay relative to each team's attacking direction for API/share compatibility.
export function mountTeamField(root, options) {
  const positions = options.positions;
  const groups = options.groups;
  let selected = root.dataset.selected || '';
  let pending = '';
  let suppressClick = false;
  const editable = !options.disabled;
  const owner = name => groups.find(g => g.players.includes(name));
  const canMove = name => editable && (!owner(name) || !options.editableTeams || options.editableTeams.includes(owner(name).team));
  const upper = g => g.team === 'ORANGE';
  const defaults = () => Object.assign({}, ...groups.map(g => defaultPositions(g.players)));
  function point(name) {
    const g = owner(name), p = positions[name] || defaults()[name];
    return {x:upper(g) ? 100-p.positionX : p.positionX, y:upper(g) ? 50-p.positionY/2 : 50+p.positionY/2};
  }
  function place(name,x,y) {
    if (!canMove(name)) return;
    const old = owner(name);
    const target = options.onAssign ? (groups.find(g => upper(g) === (y < 50)) || groups[0]) : old;
    if (!target) return;
    positions[name] = {positionX:clamp(upper(target) ? 100-x : x),positionY:clamp(upper(target) ? (50-y)*2 : (y-50)*2)};
    selected = name; root.dataset.selected = name;
    if (old !== target) options.onAssign(name,target.team);
    else { options.onChange?.(); draw(); }
  }
  function close() { root.dataset.fieldOpen = ''; root.querySelector('dialog')?.close(); root.querySelector('[data-open]')?.focus(); }
  function draw() {
    const isOpen = root.dataset.fieldOpen === '1';
    const scrollTop = root.querySelector('.fieldRoster')?.scrollTop || Number(root.dataset.rosterScroll || 0);
    const names = [...new Set([...(options.pool || []),...groups.flatMap(g => g.players)])];
    root.querySelector('dialog')?.close();
    root.innerHTML = `<button type="button" class="btn primary" data-open>Open team field</button>
      <span class="small">${groups.map(g => `${esc(g.label)}: ${g.players.length}`).join(' · ')}</span>
      <dialog class="fieldDialog" aria-label="Team assignment and positions"><div class="fieldWorkspace">
      <header class="fieldWorkspace__head"><strong>Team field</strong><span class="small">${editable ? 'Drag a player, or select a name then tap the pitch.' : 'Saved positions'}</span><button class="btn gray tiny" data-close>Done</button></header>
      <div class="fieldWorkspace__tools">${options.onAuto && editable ? '<button class="btn gray tiny" data-auto>Auto teams</button>' : ''}${editable ? '<button class="btn gray tiny" data-reset>Auto positions</button>' : ''}${options.onClear && editable ? '<button class="btn gray tiny" data-clear>Clear teams</button>' : ''}<span class="small">${names.filter(n => !owner(n)).length} unassigned</span></div>
      <div class="fieldWorkspace__body"><aside class="fieldRoster" aria-label="Player list"><table><thead><tr><th>Player</th><th>Team</th></tr></thead><tbody>${names.map(n => { const g=owner(n); return `<tr class="${selected===n?'isSelected':''}"><td><button type="button" data-name="${esc(n)}" ${canMove(n)?'':'disabled'}>${esc(n)}</button></td><td><span class="fieldRoster__team ${g?.team==='ORANGE'?'isOrange':''}">${g?esc(g.label):'—'}</span></td></tr>`; }).join('')}</tbody></table>${!names.length?'<p class="small">No available players yet.</p>':''}</aside>
      <div class="sharedPitch" aria-label="Shared team field"><div class="teamField__circle" aria-hidden="true"></div>${groups.map(g => `<span class="attackDirection ${upper(g)?'attackDirection--upper':''}">${esc(g.label)} · ${g.players.length} ${upper(g)?'↓':'↑'} attacks</span>`).join('')}${groups.flatMap(g => g.players.map(n => {const p=point(n);return `<button type="button" class="fieldPlayer ${upper(g)?'fieldPlayer--orange':''} ${selected===n?'isSelected':''}" data-name="${esc(n)}" style="left:${p.x}%;top:${p.y}%" aria-label="${esc(n)}, ${esc(g.label)}${g.captain===n?', captain':''}" ${canMove(n)?'':'disabled'}><i>${g.captain===n?'C':'•'}</i><span>${esc(n)}</span></button>`;})).join('')}</div></div>
      <footer class="fieldWorkspace__foot"><div class="fieldActions"><strong>${esc(selected || 'Select a player')}</strong>${selected && canMove(selected) && owner(selected) && options.onCaptain?'<button class="btn gray tiny" data-captain>Make captain</button>':''}${selected && canMove(selected) && owner(selected) && options.onRemove?'<button class="btn gray tiny" data-remove>Unassign</button>':''}${selected && canMove(selected) && !owner(selected) && options.onAssign?groups.map(g=>`<button class="btn gray tiny" data-assign="${esc(g.team)}">${esc(g.label)}</button>`).join(''):''}</div><span class="small" role="status" data-field-status>${esc(pending)}</span>${options.onSave && editable?'<button class="btn primary" data-save>Save changes</button>':''}</footer>
      </div></dialog>`;
    const dialog=root.querySelector('dialog');
    if(isOpen) dialog.showModal();
    const roster=root.querySelector('.fieldRoster');
    roster.scrollTop=scrollTop;
    roster.onscroll=()=>{root.dataset.rosterScroll=String(roster.scrollTop);};
    const bind=(s,f)=>{const b=root.querySelector(s);if(b)b.onclick=f;};
    bind('[data-open]',()=>{root.dataset.fieldOpen='1';dialog.showModal();});
    bind('[data-close]',close);
    dialog.oncancel=e=>{e.preventDefault();close();};
    bind('[data-auto]',options.onAuto);
    bind('[data-clear]',options.onClear);
    bind('[data-save]',()=>{close();options.onSave();});
    bind('[data-captain]',()=>options.onCaptain(selected,owner(selected).team));
    bind('[data-remove]',()=>options.onRemove(selected));
    bind('[data-reset]',()=>{for(const g of groups)for(const n of g.players)if(canMove(n))delete positions[n];options.onChange?.();draw();});
    root.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>options.onAssign(selected,b.dataset.assign));
    const pitch=root.querySelector('.sharedPitch');
    const coords=e=>{const r=pitch.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*100,y:(e.clientY-r.top)/r.height*100};};
    pitch.onclick=e=>{if(suppressClick || e.target.closest('[data-name]') || !selected)return;const p=coords(e);place(selected,p.x,p.y);};
    root.querySelectorAll('[data-name]').forEach(b=>{
      const name=b.dataset.name;
      b.onclick=()=>{if(suppressClick||!canMove(name))return;selected=name;root.dataset.selected=name;draw();root.querySelectorAll('[data-name]').forEach(el=>{if(el.dataset.name===name && el.classList.contains('fieldPlayer'))el.focus({preventScroll:true});});};
      b.onkeydown=e=>{const d={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[e.key];if(!d||!owner(name)||!canMove(name))return;e.preventDefault();const p=point(name);place(name,p.x+d[0],p.y+d[1]);root.querySelectorAll('.fieldPlayer').forEach(el=>{if(el.dataset.name===name)el.focus({preventScroll:true});});};
      let drag;
      b.onpointerdown=e=>{if(!canMove(name)||e.button!==0)return;drag={x:e.clientX,y:e.clientY,moved:false};b.setPointerCapture(e.pointerId);};
      b.onpointermove=e=>{if(!drag)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;if(!drag.moved)return;const p=coords(e);const marker=[...root.querySelectorAll('.fieldPlayer')].find(el=>el.dataset.name===name);if(!marker){let ghost=pitch.querySelector('.fieldDragGhost');if(!ghost){ghost=document.createElement('span');ghost.className='fieldDragGhost';ghost.textContent=name;pitch.append(ghost);}ghost.style.left=`${p.x}%`;ghost.style.top=`${p.y}%`;}if(marker){if(!options.onAssign){p.y=upper(owner(name))?Math.min(46.5,p.y):Math.max(53.5,p.y);}marker.style.left=`${Math.max(4,Math.min(96,p.x))}%`;marker.style.top=`${Math.max(4,Math.min(96,p.y))}%`;if(options.onAssign)marker.classList.toggle('fieldPlayer--orange',p.y<50 && groups.some(g=>upper(g)));}b.classList.add('isDragging');};
      b.onpointerup=e=>{if(!drag)return;const moved=drag.moved;drag=null;if(!moved)return;suppressClick=true;const p=coords(e);if(p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100)place(name,p.x,p.y);else if(options.onRemove && owner(name) && e.clientX<pitch.getBoundingClientRect().left)options.onRemove(name);else draw();setTimeout(()=>{suppressClick=false;},0);};
      b.onpointercancel=()=>{drag=null;draw();};
    });
  }
  draw();
  return {status(message){pending=message;const el=root.querySelector('[data-field-status]');if(el)el.textContent=message;}};
}
