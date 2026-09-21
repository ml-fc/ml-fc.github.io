import { playerPhotoHtml } from "./player_photo.js";

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
    const positionY = lines === 1 ? 48 : 12 + (lines - 1 - line) * 44 / (lines - 1);
    for (let i = 0; i < count; i++) result[outfield[offset++]] = { positionX: 100 * (i + 1) / (count + 1), positionY };
  }
  return result;
}

export function randomGoalkeeperPositions(players, random = Math.random) {
  if (!players.length) return Object.create(null);
  const goalkeeperIndex = Math.min(players.length - 1, Math.floor(random() * players.length));
  const goalkeeper = players[goalkeeperIndex];
  return defaultPositions([goalkeeper, ...players.filter((_, index) => index !== goalkeeperIndex)]);
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
  const upper = g => Boolean(g && g.team === 'ORANGE');
  const defaults = () => Object.assign({}, ...groups.map(g => defaultPositions(g.players)));
  const unassignedNames = () => [...new Set(options.pool || [])].filter(name => !owner(name));

  function point(name) {
    const group = owner(name);
    const position = positions[name] || defaults()[name] || {positionX:50, positionY:50};
    return {
      x: upper(group) ? 100 - position.positionX : position.positionX,
      y: upper(group) ? 50 - position.positionY / 2 : 50 + position.positionY / 2
    };
  }

  function playerMarker(name, group, preview = false) {
    const p = point(name);
    const captain = group.captain === name;
    const portrait = playerPhotoHtml(name, options.photos?.[name], 'playerPhoto playerPhoto--field');
    if (preview) return `<span class="fieldPlayer fieldPlayer--preview ${upper(group)?'fieldPlayer--orange':''}" style="left:${p.x}%;top:${p.y}%">${portrait}${captain?'<em aria-label="Captain">C</em>':''}<span>${esc(name)}</span></span>`;
    return `<button type="button" class="fieldPlayer ${upper(group)?'fieldPlayer--orange':''} ${selected===name?'isSelected':''}" data-name="${esc(name)}" style="left:${p.x}%;top:${p.y}%" aria-label="${esc(name)}, ${esc(group.label)}${captain?', captain':''}" ${canMove(name)?'':'disabled'}>${portrait}${captain?'<em aria-hidden="true">C</em>':''}<span>${esc(name)}</span></button>`;
  }

  function pitchMarkup(preview = false) {
    return `<div class="${preview?'fieldPreviewPitch':'sharedPitch'}" aria-label="${preview?'Team field preview':'Shared team field'}">
      <div class="teamField__circle" aria-hidden="true"></div>
      ${groups.flatMap(group => group.players.map(name => playerMarker(name, group, preview))).join('')}
      ${!groups.some(group => group.players.length) ? '<span class="teamField__empty">No players assigned</span>' : ''}
    </div>`;
  }

  function attackLabel(group) {
    if (!group) return '<span></span>';
    return `<span class="attackLane ${upper(group)?'attackLane--orange':'attackLane--blue'}"><b>${upper(group)?'↓':'↑'}</b> ${esc(group.label)} attacks</span>`;
  }

  function place(name, x, y) {
    if (!canMove(name)) return;
    const old = owner(name);
    const target = options.onAssign ? (groups.find(group => upper(group) === (y < 50)) || groups[0]) : old;
    if (!target) return;
    positions[name] = {positionX:clamp(upper(target) ? 100-x : x), positionY:clamp(upper(target) ? (50-y)*2 : (y-50)*2)};
    selected = name;
    root.dataset.selected = name;
    if (old !== target) options.onAssign(name, target.team);
    else { options.onChange?.(); draw(); }
  }

  function close() {
    root.dataset.fieldOpen = '';
    root.querySelector('dialog')?.close();
    root.querySelector('[data-open]')?.focus();
  }

  function draw() {
    const isOpen = root.dataset.fieldOpen === '1';
    const scrollTop = root.querySelector('.fieldRoster')?.scrollTop || Number(root.dataset.rosterScroll || 0);
    const unassigned = unassignedNames();
    const upperGroup = groups.find(upper);
    const lowerGroup = groups.find(group => !upper(group));
    root.querySelector('dialog')?.close();
    root.innerHTML = `<div class="fieldPreviewHeader">
        <button type="button" class="btn primary" data-open>Open team field</button>
        <span class="small">${groups.map(group => `${esc(group.label)}: ${group.players.length}`).join(' · ')} · ${unassigned.length} unassigned</span>
      </div>
      <button type="button" class="fieldPreview" data-open aria-label="Open team field editor">
        ${pitchMarkup(true)}
        <span class="fieldPreview__hint">Tap field to edit</span>
      </button>
      <dialog class="fieldDialog" aria-label="Team assignment and positions"><div class="fieldWorkspace">
        <header class="fieldWorkspace__head"><strong>Team field</strong><span class="small">${editable ? 'Scroll the list vertically; drag a name sideways onto the pitch. Drop players back to unassign.' : 'Saved positions'}</span><button class="btn gray tiny" data-close>Done</button></header>
        <div class="fieldWorkspace__tools">${options.onAuto && editable ? '<button class="btn gray tiny" data-auto>Auto team</button>' : ''}${editable ? '<button class="btn gray tiny" data-reset>Auto positions</button>' : ''}${options.onClear && editable ? '<button class="btn gray tiny" data-clear>Clear teams</button>' : ''}<span class="small">${unassigned.length} unassigned</span></div>
        <div class="fieldWorkspace__body">
          <aside class="fieldRoster" aria-label="Unassigned players"><div class="fieldRoster__head"><strong>Unassigned</strong><span>Drop here</span></div><table><tbody>${unassigned.map(name => `<tr class="${selected===name?'isSelected':''}"><td><button type="button" data-name="${esc(name)}" ${canMove(name)?'':'disabled'}>${esc(name)}</button></td></tr>`).join('')}</tbody></table>${!unassigned.length?'<p class="fieldRoster__empty">Everyone is on the field.<br>Drop a player here to unassign.</p>':''}</aside>
          <div class="pitchStage">${attackLabel(upperGroup)}${pitchMarkup(false)}${attackLabel(lowerGroup)}</div>
        </div>
        <footer class="fieldWorkspace__foot"><div class="fieldActions"><strong>${esc(selected || 'Select a player')}</strong>${selected && canMove(selected) && owner(selected) && options.onCaptain?'<button class="btn gray tiny" data-captain>Make captain</button>':''}${selected && canMove(selected) && owner(selected) && options.onRemove?'<button class="btn gray tiny" data-remove>Unassign</button>':''}${selected && canMove(selected) && !owner(selected) && options.onAssign?groups.map(group=>`<button class="btn gray tiny" data-assign="${esc(group.team)}">${esc(group.label)}</button>`).join(''):''}</div><span class="small" role="status" data-field-status>${esc(pending)}</span>${options.onSave && editable?'<button class="btn primary" data-save>Save changes</button>':''}</footer>
      </div></dialog>`;

    const dialog = root.querySelector('dialog');
    if (isOpen) dialog.showModal();
    const roster = root.querySelector('.fieldRoster');
    roster.scrollTop = scrollTop;
    roster.onscroll = () => { root.dataset.rosterScroll = String(roster.scrollTop); };
    const bind = (selector, action) => root.querySelectorAll(selector).forEach(button => { button.onclick = action; });
    bind('[data-open]', () => { root.dataset.fieldOpen='1'; dialog.showModal(); });
    bind('[data-close]', close);
    dialog.oncancel = event => { event.preventDefault(); close(); };
    bind('[data-auto]', options.onAuto);
    bind('[data-clear]', options.onClear);
    bind('[data-save]', () => { close(); options.onSave(); });
    bind('[data-captain]', () => options.onCaptain(selected, owner(selected).team));
    bind('[data-remove]', () => options.onRemove(selected));
    bind('[data-reset]', () => {
      for (const group of groups) {
        const randomized = randomGoalkeeperPositions(group.players);
        for (const name of group.players) if (canMove(name)) positions[name] = randomized[name];
      }
      options.onChange?.(); draw();
    });
    root.querySelectorAll('[data-assign]').forEach(button => { button.onclick = () => options.onAssign(selected, button.dataset.assign); });

    const pitch = root.querySelector('.sharedPitch');
    const coords = event => { const rect=pitch.getBoundingClientRect(); return {x:(event.clientX-rect.left)/rect.width*100, y:(event.clientY-rect.top)/rect.height*100}; };
    const inside = (event, element) => { const rect=element.getBoundingClientRect(); return event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom; };
    pitch.onclick = event => { if (suppressClick || event.target.closest('[data-name]') || !selected) return; const p=coords(event); place(selected,p.x,p.y); };

    root.querySelectorAll('[data-name]').forEach(button => {
      const name = button.dataset.name;
      button.onclick = () => {
        if (suppressClick || !canMove(name)) return;
        selected=name; root.dataset.selected=name; draw();
        root.querySelectorAll('.fieldPlayer').forEach(element => { if (element.dataset.name===name) element.focus({preventScroll:true}); });
      };
      button.onkeydown = event => {
        const delta={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[event.key];
        if (!delta || !owner(name) || !canMove(name)) return;
        event.preventDefault(); const p=point(name); place(name,p.x+delta[0],p.y+delta[1]);
        root.querySelectorAll('.fieldPlayer').forEach(element => { if (element.dataset.name===name) element.focus({preventScroll:true}); });
      };
      let drag;
      button.onpointerdown = event => { if (!canMove(name) || event.button!==0) return; drag={x:event.clientX,y:event.clientY,moved:false,scrolling:false,touchList:event.pointerType==='touch' && !owner(name)}; button.setPointerCapture(event.pointerId); };
      button.onpointermove = event => {
        if (!drag) return;
        const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
        if (drag.touchList && !drag.moved && Math.abs(dy)>5 && Math.abs(dy)>Math.abs(dx)) drag.scrolling=true;
        if (drag.scrolling) return;
        if (Math.hypot(dx,dy)>8) drag.moved=true;
        if (!drag.moved) return;
        roster.classList.toggle('isDropTarget', Boolean(owner(name)) && inside(event, roster));
        const p=coords(event);
        const marker=[...root.querySelectorAll('.fieldPlayer')].find(element => element.dataset.name===name);
        if (!marker && inside(event,pitch)) {
          let ghost=pitch.querySelector('.fieldDragGhost');
          if (!ghost) { ghost=document.createElement('span'); ghost.className='fieldDragGhost'; ghost.textContent=name; pitch.append(ghost); }
          ghost.style.left=`${p.x}%`; ghost.style.top=`${p.y}%`;
        }
        if (marker && inside(event,pitch)) {
          if (!options.onAssign) p.y=upper(owner(name))?Math.min(46.5,p.y):Math.max(53.5,p.y);
          marker.style.left=`${Math.max(4,Math.min(96,p.x))}%`; marker.style.top=`${Math.max(4,Math.min(96,p.y))}%`;
          if (options.onAssign) marker.classList.toggle('fieldPlayer--orange',p.y<50 && groups.some(upper));
        }
        button.classList.add('isDragging');
      };
      button.onpointerup = event => {
        if (!drag) return;
        const moved=drag.moved; drag=null; roster.classList.remove('isDropTarget');
        if (!moved) return;
        suppressClick=true;
        if (options.onRemove && owner(name) && inside(event,roster)) options.onRemove(name);
        else if (inside(event,pitch)) { const p=coords(event); place(name,p.x,p.y); }
        else draw();
        setTimeout(()=>{suppressClick=false;},0);
      };
      button.onpointercancel = () => {
        const moved=drag?.moved; drag=null; roster.classList.remove('isDropTarget');
        button.classList.remove('isDragging');
        pitch.querySelector('.fieldDragGhost')?.remove();
        if (moved && owner(name)) { const p=point(name); button.style.left=`${p.x}%`; button.style.top=`${p.y}%`; button.classList.toggle('fieldPlayer--orange',upper(owner(name))); }
      };
    });
  }

  draw();
  return {status(message){pending=message;const el=root.querySelector('[data-field-status]');if(el)el.textContent=message;}};
}
