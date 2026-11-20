import { returnTo } from './navigation.js';
import { API } from '../api/endpoints.js';
import { toastSuccess, toastError, toastInfo } from './toast.js';
import { playerPhotoHtml } from './player_photo.js';
import { getCachedUser } from '../auth.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const awardUrl = seasonId => `${location.origin}${location.pathname}#/awards?seasonId=${encodeURIComponent(seasonId)}`;
const dateLabel = value => value ? new Date(value).toLocaleString('en-AU', {timeZone:'Australia/Melbourne',dateStyle:'medium',timeStyle:'short'}) + ' Melbourne' : 'Set a voting deadline';
const deadlineHtml = a => `<p class="awardDeadline"><strong>${a.status==='CLOSED'?'Voting deadline':'Voting closes'}</strong> <time datetime="${esc(a.deadline)}">${esc(dateLabel(a.deadline))}</time></p>`;
const stateLabel = state => ({DRAFT:'Draft',OPEN:'Voting open',CLOSED:'Final'})[state] || 'Unknown';
export function liveSeasonLeaders(rows) {
  const source=Array.isArray(rows)?rows:[];
  return [
    ['Golden Boot','goals','goals'], ['Most Assists','assists','assists'],
    ['Highest Rated','avgRating','avg'], ['Most MOM','potmAwards','awards'],
    ['Most Appearances','matchesPlayed','matches'],
  ].map(([name,metric,unit])=>{
    const eligible=source.filter(r=>metric!=='avgRating' || Number(r.matchesRated)>=10);
    const value=Math.max(0,...eligible.map(r=>Number(r[metric]) || 0));
    return {name,metric,unit,value,winners:value>0?eligible.filter(r=>Number(r[metric])===value).map(r=>String(r.playerName || '')):[]};
  });
}
function leadersHtml(result) {
  if(!result?.ok)return '<section class="awardLeaders"><div class="awardLeaders__head"><h2>Season leaders</h2></div><p class="small">Could not load leaders. Refresh to try again.</p></section>';
  return `<section class="awardLeaders" aria-label="Current season leaders"><div class="awardLeaders__head"><h2>Season leaders</h2><span>Recorded match stats</span></div><dl class="awardLeaders__grid">${liveSeasonLeaders(result.rows).map(a=>`<div><dt>${esc(a.name)}</dt><dd><strong>${esc(a.winners.join(' · ') || (a.metric==='avgRating'?'No qualifying player':'No stats yet'))}</strong><span>${a.winners.length?`${a.metric==='avgRating'?a.value.toFixed(2):a.value} ${a.unit}`:'—'}${a.metric==='avgRating'?'<small>10 rated matches minimum</small>':''}</span></dd></div>`).join('')}</dl></section>`;
}
function dialog(title, subtitle = '', focusTarget = document.activeElement) {
  const el = document.createElement('dialog');
  el.className = 'awardsDialog';
  const titleId = `award-title-${crypto.randomUUID()}`;
  el.setAttribute('aria-labelledby',titleId);
  el.innerHTML = `<header class="awardsDialog__head"><div>${title==='Season awards'?'':'<div class="stepEyebrow">Season awards</div>'}<h2 id="${titleId}">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="awardsClose" type="button" aria-label="Close dialog">×</button></header><div class="awardsDialog__body"></div>`;
  el.querySelector('.awardsClose').onclick = () => el.close();
  const returnFocus=focusTarget;
  const onNavigate=()=>el.close();
  window.addEventListener('hashchange',onNavigate);
  el.addEventListener('close',()=>{window.removeEventListener('hashchange',onNavigate);el.remove();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});},{once:true});
  document.body.append(el);el.showModal();
  return el;
}
async function run(button, task) {
  if (button.disabled) return;
  const text = button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=button.matches('.awardsPageHeader__control')?'…':'Working…';
  try { await task(); } catch(e) { if(e.name!=='AbortError') toastError(e.message || 'Could not complete this action. Try again.'); }
  finally { button.disabled=false;button.removeAttribute('aria-busy');button.textContent=text; }
}
function check(result) { if (!result?.ok) throw new Error(result?.error || 'Could not load awards. Try again.'); return result; }
function resultHtml(a) {
  return `<div class="awardWinner"><span aria-hidden="true">🏆</span><div><small>${a.winners?.length>1?'Joint winners':'Winner'}</small><strong>${esc(a.winners?.join(' · ') || 'No votes cast')}</strong></div></div>${a.results?.length ? `<details class="awardResults"><summary>View results</summary>${a.results.map(r=>`<div><span>${esc(r.playerName)}</span><b>${Number(r.votes) || 0} ${r.votes===1?'vote':'votes'}</b></div>`).join('')}</details>`:''}`;
}
function participation(a) {
  const percent = a.totalEligible ? Math.round(a.totalVotes/a.totalEligible*100) : 0;
  return `<div class="awardTurnout"><span><b>${Number(a.totalVotes) || 0}</b> of ${Number(a.totalEligible) || 0} voted</span><span>${percent}%</span></div><progress class="awardProgress" max="${Math.max(1,Number(a.totalEligible) || 0)}" value="${Number(a.totalVotes) || 0}" aria-label="Voting participation"></progress>`;
}
export function votingProgress(awards) {
  const open=(Array.isArray(awards)?awards:[]).filter(a=>a.status==='OPEN');
  return {open:open.length,voted:open.filter(a=>a.myVote).length,pending:open.filter(a=>a.canVote && !a.myVote).length};
}
function cardLines(c,text,width) {
  const lines=[];let line='';
  for(const letter of String(text)) {
    if(letter==='\n'){lines.push(line);line='';continue;}
    if(line && c.measureText(line+letter).width>width) {
      const space=line.lastIndexOf(' ');
      if(space>0){lines.push(line.slice(0,space));line=line.slice(space+1);}
      else {lines.push(line);line='';}
    }
    line+=letter;
  }
  lines.push(line);return lines;
}
async function votingPoster(season,awards) {
  const canvas=document.createElement('canvas');canvas.width=1080;
  const c=canvas.getContext('2d');
  c.font='bold 34px Arial';
  const seasonLines=cardLines(c,season.name,936);
  const headingBottom=450+seasonLines.length*44;
  const rows=awards.map(a=>{
    c.font='bold 36px Arial';const names=cardLines(c,a.name,820);
    c.font='26px Arial';const dates=cardLines(c,`Closes ${dateLabel(a.deadline)}`,820);
    return {names,dates,height:48+names.length*44+dates.length*36};
  });
  c.font='24px Arial';const linkLines=cardLines(c,awardUrl(season.seasonId),888);
  canvas.height=headingBottom+rows.reduce((sum,row)=>sum+row.height+18,0)+264+linkLines.length*32;
  c.fillStyle='#091b2b';c.fillRect(0,0,1080,canvas.height);
  c.fillStyle='#e3bc66';c.fillRect(0,0,1080,12);
  // The club crest is fixed across appearance themes; the graphic is drawn locally.
  try {
    const crest=new Image();crest.src='./assets/icons/icon-192.png';await crest.decode();
    c.save();c.beginPath();c.arc(116,108,44,0,Math.PI*2);c.clip();
    c.drawImage(crest,72,64,88,88);
    c.restore();
  } catch {c.fillStyle='#091b2b';c.font='bold 24px Arial';c.fillText('MLFC',82,117);}
  c.fillStyle='#fff';c.font='bold 29px Arial';c.fillText('MANOR LAKES FC',184,99);
  c.fillStyle='#e3bc66';c.font='bold 22px Arial';c.fillText('SEASON AWARDS · VOTING OPEN',184,136);
  // Trophy, with handles and a football-pitch arc, gives the invitation a sporting identity.
  c.save();c.translate(840,252);c.strokeStyle='#e3bc66';c.fillStyle='#e3bc66';c.lineWidth=7;
  c.beginPath();c.moveTo(-55,-35);c.lineTo(55,-35);c.lineTo(43,34);c.quadraticCurveTo(0,91,-43,34);c.closePath();c.fill();
  c.beginPath();c.moveTo(-53,-19);c.lineTo(-84,-19);c.quadraticCurveTo(-95,40,-37,43);c.moveTo(53,-19);c.lineTo(84,-19);c.quadraticCurveTo(95,40,37,43);c.moveTo(0,66);c.lineTo(0,102);c.moveTo(-40,107);c.lineTo(40,107);c.stroke();
  c.strokeStyle='#244659';c.lineWidth=2;c.beginPath();c.arc(0,15,148,0,Math.PI*2);c.stroke();c.restore();
  c.fillStyle='#fff';c.font='bold 88px Arial';c.fillText('YOUR CLUB.',72,274);c.fillText('YOUR VOTE.',72,372);
  c.fillStyle='#bcd0df';c.font='bold 34px Arial';seasonLines.forEach((line,i)=>c.fillText(line,72,444+i*44));
  let y=headingBottom;
  rows.forEach(row=>{
    c.fillStyle='#132e40';c.fillRect(72,y,936,row.height);
    c.fillStyle='#e3bc66';c.fillRect(72,y,5,row.height);
    c.strokeStyle='#6ed5ad';c.lineWidth=3;c.strokeRect(102,y+28,25,25);
    c.beginPath();c.moveTo(108,y+39);c.lineTo(116,y+47);c.lineTo(133,y+25);c.stroke();
    c.fillStyle='#fff';c.font='bold 36px Arial';
    row.names.forEach((line,j)=>c.fillText(line,154,y+45+j*44));
    c.fillStyle='#bcd0df';c.font='26px Arial';
    row.dates.forEach((line,j)=>c.fillText(line,154,y+49+row.names.length*44+j*36));
    y+=row.height+18;
  });
  y+=20;c.fillStyle='#6ed5ad';c.fillRect(72,y,936,72);
  c.fillStyle='#091b2b';c.font='bold 30px Arial';c.fillText('CHOOSE YOUR PLAYERS. CAST YOUR VOTES.',102,y+47);
  c.fillStyle='#bcd0df';c.font='24px Arial';c.fillText('All closing times are Melbourne time.',72,y+119);
  c.fillStyle='#fff';c.font='24px Arial';linkLines.forEach((line,i)=>c.fillText(line,72,y+169+i*32));
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Could not create the voting image. Try again.');
  return new File([blob],'mlfc-season-awards-invitation.png',{type:'image/png'});
}
async function shareVoting(data, trigger) {
  const open=data.awards.filter(a=>a.status==='OPEN');
  if(!open.length)return toastInfo('There are no open voting categories to share.');
  const text=`🏆 ${data.season.name} · Season awards\nVoting is open!\n\n${open.map(a=>`${a.name}\nCloses ${dateLabel(a.deadline)}`).join('\n\n')}\n\nChoose your players and vote here:\n${awardUrl(data.season.seasonId)}`;
  const modal=dialog('Share voting image',data.season.name,trigger);
  const host=modal.querySelector('.awardsDialog__body');
  host.innerHTML='<p class="small" role="status">Creating voting image…</p>';
  let file;
  try {file=await votingPoster(data.season,open);}
  catch(error){if(modal.open)modal.close();throw error;}
  if(!modal.open)return;
  const objectUrl=URL.createObjectURL(file);
  modal.addEventListener('close',()=>URL.revokeObjectURL(objectUrl),{once:true});
  let canShare=false;
  try {canShare=Boolean(navigator.share && navigator.canShare?.({files:[file]}));} catch {}
  host.innerHTML=`<img class="awardSharePreview" src="${objectUrl}" alt="${esc(`${data.season.name} season awards voting invitation`)}" /><div class="awardActions">${canShare?'<button class="btn primary" data-share-image type="button">Share image & link</button>':''}<a class="btn ${canShare?'':'primary'}" href="${objectUrl}" download="${file.name}">Download image</a><button class="btn" data-copy-link type="button">Copy voting link</button></div><p class="small">${canShare?'Choose WhatsApp or another app from the share menu.':'Download the image, copy the voting link, and attach both in WhatsApp or your group chat.'}</p><details class="awardInvitationDetails"><summary>Image details & voting link</summary><ul>${open.map(a=>`<li><strong>${esc(a.name)}</strong><br />Closes ${esc(dateLabel(a.deadline))}</li>`).join('')}</ul><a href="${esc(awardUrl(data.season.seasonId))}">${esc(awardUrl(data.season.seasonId))}</a></details>`;
  host.querySelector('[data-copy-link]').onclick=e=>run(e.currentTarget,async()=>{await navigator.clipboard.writeText(awardUrl(data.season.seasonId));toastSuccess('Voting link copied.');});
  host.querySelector('[data-share-image]')?.addEventListener('click',e=>run(e.currentTarget,()=>navigator.share({files:[file],title:`${data.season.name} · Season awards`,text})));
}
export async function openSeasonAwards(seasonId) {
  if (!seasonId) return toastError('Choose a season first.');
  const modal = dialog('Season awards','Categories, nominees and voting');
  const body = modal.querySelector('.awardsDialog__body');
  body.innerHTML='<p class="small" role="status">Preparing season awards…</p>';
  let data;
  const refresh = async () => {
    const [ballot,leaders]=await Promise.all([API.seasonAwards(seasonId,true),API.leaderboardSeason(seasonId).catch(()=>null)]);
    data=check(ballot);
    if(!modal.open)return;
    modal.querySelector('.awardsDialog__head p').textContent=data.season.name;
    body.innerHTML=`${leadersHtml(leaders)}<div class="awardsDeskIntro"><div><h3>Voting categories</h3><p>Add awards at any time. Draft and active awards can be removed. Nominees lock when voting opens; individual choices stay private.</p></div><div class="awardsDeskIntro__actions">${data.awards.some(a=>a.status==='OPEN')?'<button class="btn" data-share-voting type="button">Share voting image</button>':''}<button class="btn primary" data-add type="button">+ Add award</button></div></div><div class="awardAdminList">${data.awards.map(a=>`<article class="awardAdminCard" data-award="${esc(a.awardId)}"><div class="awardCardHead"><div><span class="awardState awardState--${esc(String(a.status).toLowerCase())}">${stateLabel(a.status)}</span><h3>${esc(a.name)}</h3></div><span class="awardEmblem" aria-hidden="true">${a.kind==='BALLONDOR'?'◉':'✦'}</span></div><p class="small">${a.nominees.length} nominees</p>${deadlineHtml(a)}${a.status==='DRAFT'?`<div class="awardNomineeStrip">${a.nominees.slice(0,5).map(n=>`<span>${esc(n.playerName)}</span>`).join('')}${a.nominees.length>5?`<span>+${a.nominees.length-5}</span>`:''}</div><div class="awardActions"><button class="btn" data-edit type="button">Configure</button>${a.kind==='BALLONDOR'?'<button class="btn" data-top20 type="button">Refresh top 20</button>':''}<button class="btn primary" data-command="open" type="button">Open voting</button><button class="btn dangerGhost" data-command="delete" type="button">Remove award</button></div>`:`${participation(a)}${a.status==='CLOSED'?resultHtml(a):''}<div class="awardActions">${a.status==='OPEN'?'<button class="btn primary" data-command="notify" type="button">Notify all</button><button class="btn" data-command="remind" type="button">Remind pending</button>':''}<button class="btn" data-share type="button">Share voter image</button><button class="btn" data-participation type="button">Who voted?</button>${a.status==='OPEN'?'<button class="btn gray" data-command="close" type="button">Close voting</button><button class="btn dangerGhost" data-command="delete" type="button">Remove award</button>':''}</div>`}</article>`).join('')}</div><p class="awardsFootnote">Golden Boot, Highest Rated (10 rated matches), Most Assists, Most Man of the Match and Most Appearances publish automatically after the season ends and all matches finish.</p><button class="btn" data-refresh type="button">Refresh awards & leaders</button>`;
    body.querySelector('[data-add]').onclick=()=>editAward(null,data,refresh);
    body.querySelector('[data-share-voting]')?.addEventListener('click',e=>{
      const button=e.currentTarget;
      run(button,async()=>{
        const fresh=check(await API.seasonAwards(seasonId,true));
        if(modal.open)await shareVoting(fresh,button);
      });
    });
    body.querySelector('[data-refresh]').onclick=e=>run(e.currentTarget,refresh);
    for(const card of body.querySelectorAll('[data-award]')) {
      const a=data.awards.find(a=>a.awardId===card.dataset.award);
      card.querySelector('[data-top20]')?.addEventListener('click',e=>run(e.currentTarget,async()=>{check(await API.awardsSeed(seasonId,true));await refresh();toastSuccess('Top 20 nominees updated.');}));
      card.querySelector('[data-edit]')?.addEventListener('click',()=>editAward(a,data,refresh));
      card.querySelector('[data-share]')?.addEventListener('click',e=>run(e.currentTarget,async()=>{
        const fresh=check(await API.seasonAwards(seasonId,true)).awards.find(x=>x.awardId===a.awardId);
        if(!fresh)throw new Error('This award was removed. Refresh awards to continue.');
        if(modal.open)await shareParticipation(fresh,data.season.name);
      }));
      card.querySelector('[data-participation]')?.addEventListener('click',e=>run(e.currentTarget,async()=>{
        const fresh=check(await API.seasonAwards(seasonId,true)).awards.find(x=>x.awardId===a.awardId);
        if(!fresh)throw new Error('This award was removed. Refresh awards to continue.');
        if(modal.open)showParticipation(fresh,data.season.name);
      }));
      for(const button of card.querySelectorAll('[data-command]'))button.onclick=()=>run(button,async()=>{
        const command=button.dataset.command;
        if(command==='delete' && !confirm(a.status==='OPEN' ? `Remove ${a.name}? Voting for this award will stop and it will disappear from the ballot. Its ${Number(a.totalVotes) || 0} existing votes will be retained. Other awards are unchanged.` : `Remove ${a.name}?`))return;
        if(command==='close' && !confirm(`Close ${a.name} voting and publish the winners?`))return;
        check(await API.awardCommand(a.awardId,command==='remind'?'notify':command,{revision:a.revision,pendingOnly:command==='remind',round:crypto.randomUUID()}));
        toastSuccess(command==='notify'||command==='remind'?'Voting notifications sent.':command==='open'?'Voting opened. Share the link or notify players.':command==='delete'?'Award removed.':'Voting closed. Winners published.');
        await refresh();
      });
    }
  };
  try { check(await API.awardsSeed(seasonId));await refresh(); }
  catch(e) {body.innerHTML=`<div class="emptyState"><b>Awards could not load</b><span>${esc(e.message)}</span><button class="btn" data-retry type="button">Try again</button></div>`;body.querySelector('[data-retry]').onclick=()=>{modal.close();openSeasonAwards(seasonId);};}
}
function editAward(a,data,refresh) {
  const modal=dialog(a?'Configure award':'Create an award',data.season.name);
  const body=modal.querySelector('.awardsDialog__body');
  let selected=new Set((a?.nominees || []).map(n=>n.playerName));
  const deadline=a?.deadline || data.awards.filter(x=>x.status==='OPEN' && Date.parse(x.deadline)>Date.now()).map(x=>x.deadline).sort()[0] || '';
  const localDeadline=deadline ? new Date(Date.parse(deadline)-new Date(deadline).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  body.innerHTML=`<form class="awardForm"><label class="field">Award name<input class="input" name="name" required maxlength="80" value="${esc(a?.name || '')}" placeholder="e.g. Players’ player" /></label><label class="field">Voting closes<input class="input" name="deadline" type="datetime-local" required value="${esc(localDeadline)}" /><small class="small">Your device’s local time. Players see the Melbourne time.</small></label><div class="awardSelectionSummary"><div><strong data-count></strong><p class="small">Choose players who appeared in this season.</p></div><button class="btn" data-nominees type="button">Choose nominees</button></div><div data-selected class="awardNomineeStrip"></div><p class="small">At least two nominees are needed to open voting. Save this draft, then open its voting from the awards desk. Existing awards keep their votes.</p><button class="btn primary" type="submit">Save award</button></form>`;
  const paint=()=>{body.querySelector('[data-count]').textContent=`${selected.size} nominees selected`;body.querySelector('[data-selected]').innerHTML=[...selected].map(n=>`<span>${esc(n)}</span>`).join('');};paint();
  body.querySelector('[data-nominees]').onclick=()=>{
    const picker=dialog('Choose nominees',`${data.players.length} season players`);
    const host=picker.querySelector('.awardsDialog__body');
    const draft=new Set(selected);
    host.innerHTML=`<label class="field">Search players<input class="input" type="search" placeholder="Player name" /></label><div class="awardPicker" role="group" aria-label="Nominees"></div><div class="awardPickerFooter"><span data-picked aria-live="polite"></span><button class="btn primary" data-done type="button">Use selection</button></div>`;
    const draw=()=>{
      const search=host.querySelector('input').value.toLowerCase();
      host.querySelector('.awardPicker').innerHTML=data.players.filter(n=>n.toLowerCase().includes(search)).map(n=>`<label class="awardPick"><input type="checkbox" value="${esc(n)}" ${draft.has(n)?'checked':''} /><span>${esc(n)}</span></label>`).join('') || '<p class="small">No players match your search.</p>';
      host.querySelector('[data-picked]').textContent=`${draft.size} selected`;
      host.querySelectorAll('input[type=checkbox]').forEach(input=>input.onchange=()=>{input.checked?draft.add(input.value):draft.delete(input.value);host.querySelector('[data-picked]').textContent=`${draft.size} selected`;});
    };draw();host.querySelector('input').oninput=draw;
    host.querySelector('[data-done]').onclick=()=>{selected=draft;paint();picker.close();};
  };
  body.querySelector('form').onsubmit=event=>{event.preventDefault();run(body.querySelector('[type=submit]'),async()=>{
    const form=new FormData(event.currentTarget);
    check(await API.awardSave({seasonId:data.season.seasonId,...(a?{awardId:a.awardId,revision:a.revision}:{}),name:form.get('name'),deadline:new Date(form.get('deadline')).toISOString(),nominees:[...selected]}));
    modal.close();toastSuccess('Award saved.');await refresh();
  });};
}
function showParticipation(a,seasonName) {
  const modal=dialog(a.name,'Participation only. Individual choices remain private.');
  modal.querySelector('.awardsDialog__body').innerHTML=`${deadlineHtml(a)}${participation(a)}<div class="awardParticipation">${[['Voted',a.voted],['Not voted',a.pending]].map(([title,names])=>`<section><h3>${title} <small>${names.length}</small></h3>${names.map(n=>`<div>${title==='Voted'?'✓':'○'} ${esc(n)}</div>`).join('') || '<p class="small">No players</p>'}</section>`).join('')}</div><div class="awardActions"><button class="btn primary" type="button" data-share-participation>Share voter image</button></div>`;
  modal.querySelector('[data-share-participation]').onclick=e=>run(e.currentTarget,async()=>{
    const fresh=check(await API.seasonAwards(a.seasonId,true)).awards.find(x=>x.awardId===a.awardId);
    if(!fresh)throw new Error('This award was removed. Refresh awards to continue.');
    if(modal.open)await shareParticipation(fresh,seasonName);
  });
}
async function shareParticipation(a,seasonName) {
  const routeHash=location.hash;
  const canvas=document.createElement('canvas');canvas.width=1200;
  const groups=[a.voted || [],a.pending || []];
  canvas.height=590+Math.max(1,...groups.map(g=>g.length))*48;
  const c=canvas.getContext('2d');c.fillStyle='#0a1726';c.fillRect(0,0,canvas.width,canvas.height);
  c.fillStyle='#e3bc66';c.font='bold 30px Arial';c.fillText('MANOR LAKES FC · SEASON AWARDS',60,70);
  c.fillStyle='#ffffff';c.font='bold 54px Arial';c.fillText(a.name,60,150,1080);
  c.fillStyle='#bcd0df';c.font='28px Arial';c.fillText(seasonName,60,205,1080);c.fillText(`${Number(a.totalVotes) || 0} of ${Number(a.totalEligible) || 0} voted · ${stateLabel(a.status)}`,60,258);
  c.fillStyle='#e3bc66';c.font='24px Arial';c.fillText(`Voting deadline: ${dateLabel(a.deadline)}`,60,310,1080);
  groups.forEach((names,i)=>{const x=60+i*590;c.fillStyle=i?'#e3bc66':'#6ed5ad';c.font='bold 28px Arial';c.fillText(i?'NOT VOTED':'VOTED',x,395);c.font='26px Arial';names.forEach((n,j)=>c.fillText(`${i?'○':'✓'} ${n}`,x,450+j*48,520));});
  c.fillStyle='#bcd0df';c.font='22px Arial';c.fillText(`As of ${dateLabel(new Date().toISOString())} · Individual choices are private`,60,canvas.height-40,1080);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not create the voting card');
  const file=new File([blob],'mlfc-awards-voting.png',{type:'image/png'});
  const text=`🏆 ${a.name} · ${seasonName}\n${Number(a.totalVotes) || 0} of ${Number(a.totalEligible) || 0} have voted.\nVoting deadline: ${dateLabel(a.deadline)}\n${awardUrl(a.seasonId)}`;
  // Provide a second user gesture for mobile file sharing after asynchronous image generation.
  if(location.hash!==routeHash)return;
  const modal=dialog('Share voter image','Voted and pending players, plus the voting deadline.');
  const host=modal.querySelector('.awardsDialog__body');
  const objectUrl=URL.createObjectURL(file);
  modal.addEventListener('close',()=>URL.revokeObjectURL(objectUrl),{once:true});
  host.innerHTML=`<img class="awardSharePreview" src="${objectUrl}" alt="Voting participation card" /><div class="awardActions"><button class="btn primary" data-share type="button">Share image & link</button><button class="btn" data-copy type="button">Copy voting link</button><a class="btn" href="${objectUrl}" download="mlfc-awards-voting.png">Download image</a></div><p class="small">${esc(awardUrl(a.seasonId))}</p>`;
  host.querySelector('[data-copy]').onclick=e=>run(e.currentTarget,async()=>{await navigator.clipboard.writeText(awardUrl(a.seasonId));toastInfo('Voting link copied.');});
  host.querySelector('[data-share]').onclick=e=>run(e.currentTarget,async()=>{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],text,title:a.name});else {await navigator.clipboard.writeText(text);toastInfo('Link copied. Download the image and attach it to your group message.');}});
}
function ballotContents(a,user) {
  const voted=Boolean(a.myVote);
  const subtitle=a.status==='OPEN'?(voted?`Your vote: ${a.myVote}`:`${a.nominees.length} nominees · ${a.canVote?'Choose a player':'View category'}`):a.status==='CLOSED'?(a.winners?.join(' · ') || 'Voting closed'):'Voting not open yet';
  return `<summary class="awardCategory"><span class="awardCategory__mark ${voted?'awardCategory__mark--voted':''}" aria-hidden="true">${voted?'✓':'✦'}</span><span class="awardCategory__title"><h2>${esc(a.name)}</h2><span>${esc(subtitle)}</span></span><span class="awardState awardState--${voted && a.status==='OPEN'?'voted':esc(String(a.status).toLowerCase())}">${voted && a.status==='OPEN'?'Voted':stateLabel(a.status)}</span><span class="awardCategory__chevron" aria-hidden="true">⌄</span></summary><div class="awardBallot__body">${a.status==='DRAFT'?'<p class="small">Nominees are being prepared. Check back when voting opens.</p>':`${deadlineHtml(a)}${participation(a)}${a.status==='CLOSED'?resultHtml(a):`<p class="awardBallot__hint">${a.canVote?'Choose one player. You can change your vote until voting closes.':'Voting is available to players who completed a match in this season before the ballot opened.'}</p><form><div class="awardNominees" role="radiogroup" aria-label="${esc(a.name)} nominees">${a.nominees.map(n=>{const self=n.playerName.toLowerCase()===String(user?.name).toLowerCase();const disabled=!a.canVote || self;return `<label class="awardNominee ${disabled?'awardNominee--disabled':''}"><input type="radio" name="candidate" value="${esc(n.playerName)}" aria-label="${esc(n.playerName)}${self?' (you)':''}" ${a.myVote===n.playerName?'checked':''} ${disabled?'disabled':''} required />${playerPhotoHtml(n.playerName,n.photoUrl || '')}<span><strong>${esc(n.playerName)}</strong>${self?'<small>You</small>':n.overall?`<small>${Number(n.overall)} OVR${n.position?` · ${esc(n.position)}`:''}</small>`:''}</span><i aria-hidden="true">✓</i></label>`;}).join('')}</div>${a.canVote?`<div class="awardVoteFooter"><span>${a.myVote?`Saved: ${esc(a.myVote)}`:'Your choice stays private.'}</span><button class="btn primary" type="submit">${a.myVote?'Update vote':'Confirm vote'}</button></div>`:''}</form>`}`}</div>`;
}
function ballotProgressHtml(awards) {
  const {open,voted,pending}=votingProgress(awards);
  return open?`<div class="awardBallotProgress" role="status"><strong>${voted} voted <span>·</span> ${pending} pending</strong><span>Open a category to ${pending?'vote':'view details'}.</span></div>`:'';
}
export async function renderAwardsPage(root,query,routeToken,navigation={}) {
  const seasonId=query.get('seasonId') || '';
  root.classList.add('awardsPage');
  const previousHash=String(navigation.previousHash || '');
  const previousPath=previousHash.split('?')[0];
  const validPrevious=['#/match','#/admin','#/leaderboard','#/season','#/captain'].includes(previousPath);
  if(validPrevious)root.dataset.awardsReturnHash=previousHash;
  const backHash=root.dataset.awardsReturnHash || '#/match';
  const generation=crypto.randomUUID();
  root.dataset.awardsGeneration=generation;
  root.innerHTML='<section class="card" role="status">Loading season awards…</section>';
  let request=0;
  const pendingVotes=new Set();
  const refresh=async({savedId='',focusSaved=false,restoreRefreshFocus=false}={})=>{
    const currentRequest=++request;
    const [ballot,leaders]=await Promise.all([API.seasonAwards(seasonId),API.leaderboardSeason(seasonId).catch(()=>null)]);
    if(!root.isConnected || root.dataset.awardsGeneration!==generation || currentRequest!==request)return;
    const data=check(ballot);
    const user=getCachedUser();
    const existing=[...root.querySelectorAll('.awardBallot')];
    let openId=existing.find(card=>card.open)?.dataset.id;
    if(!existing.length)openId=data.awards.find(a=>a.status==='OPEN' && a.canVote && !a.myVote)?.awardId;
    if(openId===savedId)openId=null;
    const choices=new Map(existing.filter(card=>card.dataset.id!==savedId).map(card=>{
      const choice=card.querySelector('input:checked')?.value;
      const saved=card.querySelector('input[checked]')?.value;
      return [card.dataset.id,choice!==saved?choice:null];
    }));
    const active=document.activeElement;
    const focusCard=active?.closest('.awardBallot')?.dataset.id;
    const focusValue=active?.matches('input[type=radio]')?active.value:null;
    const focusRefresh=active?.matches('[data-refresh]') || (restoreRefreshFocus && active===document.body);
    const leadersOpen=root.querySelector('.awardLeadersPanel')?.open;
    root.innerHTML=`<header class="awardsPageHeader"><a class="awardsPageHeader__control pageBack" href="${esc(backHash)}" data-awards-back aria-label="Back to previous screen"><span aria-hidden="true">‹</span><span class="awardsPageHeader__controlLabel">Back</span></a><div class="awardsPageHeader__title"><h1>Season awards</h1><p>${esc(data.season.name)}</p></div><button class="awardsPageHeader__control" data-refresh type="button" aria-label="Refresh awards and leaders" title="Refresh awards and leaders">↻</button></header><details class="awardLeadersPanel" ${leadersOpen?'open':''}><summary>Season leaders <span>Recorded match stats</span></summary>${leadersHtml(leaders)}</details>${ballotProgressHtml(data.awards)}<div class="awardBallots">${data.awards.length?data.awards.map(a=>`<details class="card awardBallot" data-id="${esc(a.awardId)}" ${a.awardId===openId?'open':''}>${ballotContents(a,user)}</details>`).join(''):'<div class="card emptyState"><b>No awards configured yet</b><span>Your admin will notify you when voting opens.</span></div>'}</div>`;
    root.querySelector('[data-awards-back]').onclick=event=>{event.preventDefault();returnTo(backHash,previousHash);};
    root.querySelector('[data-refresh]').onclick=e=>{
      const button=e.currentTarget;
      const restoreRefreshFocus=document.activeElement===button;
      run(button,()=>refresh({restoreRefreshFocus}));
    };
    for(const card of root.querySelectorAll('.awardBallot')) {
      card.ontoggle=()=>{if(card.open)root.querySelectorAll('.awardBallot[open]').forEach(other=>{if(other!==card)other.open=false;});};
      const choice=choices.get(card.dataset.id);
      const input=[...card.querySelectorAll('input')].find(input=>input.value===choice && !input.disabled);
      if(input)input.checked=true;
      const form=card.querySelector('form');
      const button=form?.querySelector('[type=submit]');
      if(!button)continue;
      button.disabled=pendingVotes.has(card.dataset.id);
      form.onsubmit=e=>{
        e.preventDefault();
        const candidate=new FormData(form).get('candidate');
        if(!candidate || button.disabled || pendingVotes.has(card.dataset.id))return;
        const focusOnSave=card.contains(document.activeElement);
        pendingVotes.add(card.dataset.id);
        run(button,async()=>{
          try {
            check(await API.awardVote(card.dataset.id,candidate));
            pendingVotes.delete(card.dataset.id);
            toastSuccess('Vote saved.');
            await refresh({savedId:card.dataset.id,focusSaved:focusOnSave && (document.activeElement===document.body || card.contains(document.activeElement))});
          } finally {
            pendingVotes.delete(card.dataset.id);
            const current=[...root.querySelectorAll('.awardBallot')].find(el=>el.dataset.id===card.dataset.id);
            const retry=current?.querySelector('[type=submit]');
            if(retry && root.dataset.awardsGeneration===generation)retry.disabled=false;
          }
        });
      };
    }
    const targetId=focusSaved?savedId:focusCard;
    const target=[...root.querySelectorAll('.awardBallot')].find(card=>card.dataset.id===targetId);
    if(target){
      const focusInput=!focusSaved && focusValue?[...target.querySelectorAll('input')].find(input=>input.value===focusValue):null;
      (focusInput || target.querySelector('summary')).focus({preventScroll:true});
      if(focusSaved)target.querySelector('summary').scrollIntoView({block:'nearest'});
    } else if(focusRefresh)root.querySelector('[data-refresh]').focus({preventScroll:true});
  };
  try{await refresh();}catch(e){if(root.dataset.awardsGeneration!==generation)return;root.innerHTML=`<section class="card emptyState"><b>Could not load the ballot</b><span>${esc(e.message)}</span><div class="awardActions"><a class="btn" href="${esc(backHash)}">Back</a><button class="btn" type="button">Try again</button></div></section>`;root.querySelector('button').onclick=()=>renderAwardsPage(root,query,routeToken,navigation);}
}
