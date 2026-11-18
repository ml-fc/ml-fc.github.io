import { API } from '../api/endpoints.js';
import { esc } from './awards.js';

let clockTimer=null;
const trophyIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8v6a4 4 0 0 1-8 0V3Z"/><path d="M8 5H5v3a4 4 0 0 0 4 4m7-7h3v3a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6v3"/></svg>';
function winnersHtml(awards) {
  return `<div class="seasonHonours__grid">${awards.map(a=>`<div class="seasonHonour"><small>${esc(a.name)}</small><strong>${esc(a.winners?.join(' · ') || 'No qualifying winner')}</strong><span>${a.metric==='avgRating'?Number(a.value).toFixed(2)+' avg · 10 rated matches minimum':a.metric?`${Number(a.value) || 0} ${({goals:'goals',assists:'assists',potmAwards:'awards',matchesPlayed:'appearances'})[a.metric] || ''}`:'Players’ vote'}</span></div>`).join('')}</div>`;
}
function seasonHtml(s,index) {
  return `<details class="seasonHonours card" ${index===0?'open':''}><summary><span><small>Season honours · ${esc(s.endDate)}</small><strong>${esc(s.name)}</strong></span><span class="seasonHonours__expand" aria-hidden="true">+</span></summary><div class="seasonHonours__body"><div class="seasonHonours__numbers"><span><b>${Number(s.matchCount) || 0}</b> matches</span><span><b>${Number(s.playerCount) || 0}</b> players</span><span><b>${Number(s.goals) || 0}</b> goals</span></div>${winnersHtml([...s.awards,...s.ballots.map(a=>({name:a.name,winners:a.winners}))])}<details class="seasonHonours__stats"><summary>Full season statistics</summary><div class="seasonStatsScroll" tabindex="0" role="region" aria-label="Season player statistics"><table><thead><tr><th>Player</th><th>Played</th><th>Goals</th><th>Assists</th><th>Rating</th><th>MOM</th></tr></thead><tbody>${s.rows.map(r=>`<tr><th scope="row">${esc(r.playerName)}</th><td>${Number(r.matchesPlayed) || 0}</td><td>${Number(r.goals) || 0}</td><td>${Number(r.assists) || 0}</td><td>${r.matchesRated?Number(r.avgRating).toFixed(2):'—'}</td><td>${Number(r.potmAwards) || 0}</td></tr>`).join('')}</tbody></table></div></details></div></details>`;
}
export async function mountSeasonHonours(root) {
  let host=root.querySelector('[data-season-home]');
  if(!host){host=document.createElement('div');host.dataset.seasonHome='';root.prepend(host);}
  let history=root.querySelector('[data-season-history]');
  if(!history){history=document.createElement('section');history.dataset.seasonHistory='';history.setAttribute('aria-label','Previous season honours');root.append(history);}
  if(clockTimer)clearInterval(clockTimer);
  host.innerHTML='<div class="seasonCountdown small" role="status">Loading season…</div>';
  let offset=0;
  try {
    const data=await API.seasonHonours();
    if(!data?.ok)throw new Error(data?.error || 'Could not load season honours');
    if(!host.isConnected || !history.isConnected)return;
    host.innerHTML=data.current?`<section class="seasonCountdown" aria-label="Current season"><div class="seasonCountdown__main"><strong>${esc(data.current.name)}</strong><div class="seasonCountdown__status"><span data-season-label>Ends in</span><time data-season-clock datetime="${esc(data.current.deadline)}" role="timer" aria-live="off"></time></div></div><a class="seasonCountdown__awards" href="#/awards?seasonId=${encodeURIComponent(data.current.seasonId)}" aria-label="View season awards">${trophyIcon}<span>Awards</span><span aria-hidden="true">›</span></a></section>`:'';
    history.innerHTML=`<div data-honours>${data.seasons.map(seasonHtml).join('')}</div>${data.hasMore?'<button class="btn seasonOlder" data-older type="button">Show older seasons</button>':''}`;
    if(data.current){
      const tick=()=>{
        if(!host.isConnected){clearInterval(clockTimer);clockTimer=null;return;}
        const left=Math.max(0,Date.parse(data.current.deadline)-Date.now());
        const days=Math.floor(left/86400000),hours=Math.floor(left%86400000/3600000),minutes=Math.floor(left%3600000/60000);
        const ended=data.current.ended || !left;
        const clock=host.querySelector('[data-season-clock]');
        host.querySelector('[data-season-label]').textContent=ended?'Season ended':'Ends in';
        clock.textContent=ended?'Final results settling':`${days}d ${hours}h ${minutes}m`;
        clock.setAttribute('aria-label',ended?'Final results settling':`${days} days, ${hours} hours, ${minutes} minutes`);
      };tick();clockTimer=setInterval(tick,30000);
    }
    offset=data.seasons.length;
    const older=history.querySelector('[data-older]');
    if(older)older.onclick=async()=>{
      older.disabled=true;older.textContent='Loading…';
      try{const next=await API.seasonHonours(offset);if(!next?.ok)throw new Error('Could not load older seasons');if(!history.isConnected)return;history.querySelector('[data-honours]').insertAdjacentHTML('beforeend',next.seasons.map(s=>seasonHtml(s,1)).join(''));offset+=next.seasons.length;if(!next.hasMore)older.remove();}
      catch{older.textContent='Could not load. Try again.';}
      finally{older.disabled=false;if(older.textContent==='Loading…')older.textContent='Show older seasons';}
    };
  } catch {host.innerHTML='<button class="btn seasonOlder" type="button">Retry season honours</button>';host.querySelector('button').onclick=()=>mountSeasonHonours(root);}
}
export function updateSeasonCreation(root,season) {
  const button=root.querySelector('#createMatch');
  if(!button)return;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const ended=!season || season.status==='CLOSED' || season.endDate<today;
  button.disabled=ended;button.title=ended?'This season has ended. Create a new season to add matches.':'';
  let note=root.querySelector('[data-season-ended]');
  if(!note){note=document.createElement('p');note.className='small';note.dataset.seasonEnded='';button.after(note);}
  note.textContent=ended?'This season has ended. Existing matches can still be completed. Create a new season to add matches.':'';
}
