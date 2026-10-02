import { createIconScene } from "./icon_scene.js";
import { sampleIconMotion } from "./icon_motion.js";
// Original illustrated tributes: articulated limbs, contact poses and a finite replay clock.
export const ICON_MOVE_DURATION = 9000;
const LOOKS = {
  cristiano: ['#c52336','#075c41','#d7a27c','7','BICYCLE KICK','SIUUU!'],
  messi: ['#1459a3','#a71939','#dfae8b','10','LEFT-FOOT MAGIC','TO THE SKY'],
  neymar: ['#f4d72e','#18449b','#b98058','10','RAINBOW FLICK','JOGA BONITO'],
  r9: ['#f6d82e','#1d489b','#b98259','9','DOUBLE STEPOVER','O FENÔMENO'],
  maradona: ['#94d9f5','#f5f7fa','#c89473','10','THE SLALOM','EL DIEGO'],
  ronaldinho: ['#164c9b','#a71c35','#a46a43','10','ELASTICO','KEEP SMILING'],
  pele: ['#f2cd35','#1a4799','#825238','10','FLYING VOLLEY','O REI'],
};
// time, hip x/y, torso angle, left/right ankle x/y (relative to hip), ball x/y.
const MOVES = {
  cristiano:[[0,230,206,0,-16,42,18,42,340,72],[.2,251,181,-25,-23,35,22,28,320,80],[.34,263,155,-65,-32,27,24,37,314,95],[.42,270,145,-100,-36,25,30,45,309.1,107.6],[.49,277,172,-115,-30,22,27,37,383,92],[.65,288,219,-65,-22,22,27,20,554,144],[.76,295,206,0,-18,42,18,42,560,233]],
  messi:[[0,92,206,8,-15,42,20,39,118,246],[.14,155,194,-9,21,42,-18,39,174,239],[.27,212,209,12,-18,39,22,42,239,247],[.4,274,195,-12,23,41,-16,39,297,240],[.54,350,206,9,-18,40,24,40,379,247],[.62,376,206,-8,45,22,-16,42,417.5,221.5],[.76,391,206,0,-18,42,18,42,555,226]],
  neymar:[[0,214,206,0,-11,42,12,42,215,245],[.18,224,204,-8,-9,24,8,30,219,235],[.3,237,197,10,-23,30,10,38,215,193],[.43,264,192,8,-22,37,24,34,260,103],[.57,303,206,5,-16,42,26,36,336,199],[.65,340,206,-8,-18,42,44,22,386.6,221.7],[.76,356,206,0,-18,42,18,42,555,207]],
  r9:[[0,149,206,4,-18,41,26,38,183,247],[.14,167,206,-8,35,34,-18,42,194,247],[.25,179,206,8,-19,42,36,33,204,247],[.34,190,206,-7,35,35,-16,42,215,247],[.52,324,202,12,-26,37,29,38,367,246],[.63,375,206,-8,-18,42,44,22,421.6,221.7],[.76,394,206,0,-20,42,20,42,555,218]],
  maradona:[[0,80,205,9,-18,42,20,38,107,246],[.12,141,187,-13,23,42,-17,40,164,233],[.25,208,209,15,-18,40,23,40,237,249],[.39,270,189,-15,23,42,-18,39,291,235],[.53,352,207,11,-18,40,26,39,380,247],[.63,379,206,-8,45,22,-18,42,420.5,221.5],[.76,394,206,0,-18,42,18,42,555,224]],
  ronaldinho:[[0,220,206,0,-18,42,22,40,249,247],[.24,232,206,-8,-18,42,44,31,279.9,230.6],[.32,237,206,8,-18,42,5,39,236.5,245.3],[.52,332,202,12,-23,38,26,38,369,246],[.64,375,206,-8,-18,42,44,22,421.6,221.7],[.76,389,206,0,-20,42,20,42,555,206]],
  pele:[[0,251,206,0,-18,42,18,42,142,88],[.22,272,184,-12,-20,34,25,31,239,150],[.4,291,162,-20,-18,43,48,12,340.2,156.9],[.53,305,181,-10,-20,38,30,30,425,144],[.68,319,206,0,-18,42,18,42,555,192],[.76,324,206,0,-18,42,18,42,560,233]],
};
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const u = clamp(value); return u*u*(3-2*u); };
function contactTime(slug) {
  return { cristiano:.42, pele:.4, messi:.62, ronaldinho:.64, neymar:.65 }[slug] || .63;
}
// Monotone cubic Hermite: continuous velocity through poses, with no overshoot at turns.
function interpolate(keys, time) {
  let index = keys.findIndex(key => key[0] >= time);
  if (index < 1) index = time <= keys[0][0] ? 1 : keys.length - 1;
  const a = keys[index-1], b = keys[index], duration = b[0]-a[0], u = clamp((time-a[0])/duration);
  function tangent(i, field) {
    if (i === 0) return (keys[1][field]-keys[0][field])/(keys[1][0]-keys[0][0]);
    if (i === keys.length-1) return 0;
    const left=(keys[i][field]-keys[i-1][field])/(keys[i][0]-keys[i-1][0]);
    const right=(keys[i+1][field]-keys[i][field])/(keys[i+1][0]-keys[i][0]);
    return left*right <= 0 ? 0 : 2*left*right/(left+right);
  }
  return a.map((v,field) => field === 0 ? time :
    (2*u*u*u-3*u*u+1)*v+(u*u*u-2*u*u+u)*duration*tangent(index-1,field)+
    (-2*u*u*u+3*u*u)*b[field]+(u*u*u-u*u)*duration*tangent(index,field));
}
export function sampleIconPose(slug, time) {
  if (!MOVES[slug]) slug = "messi";
  const keys=MOVES[slug] || MOVES.messi, t=clamp(time), action=Math.min(.76,t), contact=contactTime(slug);
  const pose=interpolate(keys,action);
  // Stance feet move backwards relative to the hip; the swing foot clears the turf.
  const runStart={messi:0,maradona:0,r9:.34,ronaldinho:.33,neymar:.54}[slug];
  if(runStart !== undefined && t<contact) {
    const weight=smooth((t-runStart)/.045)*(1-smooth((t-contact+.075)/.075));
    const travel=(pose[1]-keys[0][1])/46, angle=pose[3]*Math.PI/180;
    for(let side=0;side<2;side++) {
      const phase=((travel+side*.5)%1+1)%1;
      const stride=phase<.62 ? 19-phase/.62*33 : -14+smooth((phase-.62)/.38)*33;
      const lift=phase<.62 ? 0 : Math.sin((phase-.62)/.38*Math.PI)*15;
      const dx=stride,dy=250-pose[2]-lift;
      const fx=dx*Math.cos(angle)+dy*Math.sin(angle),fy=-dx*Math.sin(angle)+dy*Math.cos(angle);
      pose[4+side*2]+=(fx-pose[4+side*2])*weight;
      pose[5+side*2]+=(fy-pose[5+side*2])*weight;
    }
  }
  if(t>contact) {
    const hit=keys.find(key=>Math.abs(key[0]-contact)<.001), flight=clamp((t-contact)/(.76-contact));
    const arc=slug==='cristiano'?38:slug==='pele'?25:15;
    pose[8]=hit[8]+(630-hit[8])*flight;
    pose[9]=hit[9]+(232-hit[9])*flight-4*arc*flight*(1-flight);
    // Small, damped bounce inside the net, rather than a frozen ball after the shot.
    if(t>.76){const settle=(t-.76)/.24;pose[8]=630-8*(1-Math.exp(-settle*5));pose[9]=242-10*Math.abs(Math.cos(settle*8))*Math.exp(-settle*5);}
  }
  return pose;
}
export function createIconMove(host, { onFinish = () => {}, onProgress = () => {} } = {}) {
  const limb = side => `<g stroke-linecap="round" stroke-linejoin="round" fill="none"><path data-arm-${side} stroke="var(--skin)" stroke-width="9"/><path data-sleeve-${side} stroke="var(--kit)" stroke-width="13"/><path data-leg-${side} stroke="var(--skin)" stroke-width="11"/><path data-sock-${side} stroke="var(--kit)" stroke-width="9"/><path data-boot-${side} stroke="#f7efba" stroke-width="7"/></g>`;
  host.innerHTML = `<svg viewBox="0 0 600 300" role="img" aria-label="Illustrated signature football move">
    <defs>
      <linearGradient id="iconSky" x2="0" y2="1"><stop stop-color="#071526"/><stop offset="1" stop-color="#284654"/></linearGradient>
      <linearGradient id="iconGrass" x2="0" y2="1"><stop stop-color="#245e52"/><stop offset="1" stop-color="#0b302e"/></linearGradient>
      <pattern id="iconCrowd" width="17" height="14" patternUnits="userSpaceOnUse"><circle cx="5" cy="4" r="1.4" fill="#d8e8ed" opacity=".4"/><circle cx="13" cy="10" r="1" fill="#e7bf68" opacity=".5"/></pattern>
      <pattern id="iconNet" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#d1f4ee" opacity=".35"/></pattern>
      <radialGradient id="iconBall"><stop stop-color="#fff"/><stop offset="1" stop-color="#c6d7da"/></radialGradient>
    </defs>
    <path fill="url(#iconSky)" d="M0 0H600V300H0Z"/>
    <path fill="#fff" opacity=".045" d="M30 12 285 215H0ZM570 12 315 215H600Z"/>
    <path d="M0 88Q300 132 600 88V191H0Z" fill="url(#iconCrowd)"/>
    <path d="M0 169H600V300H0Z" fill="url(#iconGrass)"/>
    <path d="M0 210H600M0 261H600M40 300 194 169M390 300 347 169" stroke="#fff" opacity=".12" fill="none"/>
    <path d="M0 182H600" stroke="var(--celebration-accent)" opacity=".45" stroke-width="3"/>
    <g data-net><path d="M514 245V122H574L593 147V253Z" fill="url(#iconNet)" stroke="#cfebe6" stroke-width="2"/><path d="M514 122 535 147H593M535 147V252M574 122V245H514" fill="none" stroke="#fff" opacity=".55"/></g>
    <g data-defenders fill="#66818d" stroke="#8ba5ad" stroke-linecap="round"><g transform="translate(210 203)"><circle cy="-54" r="9"/><path d="M-12-40H12L17-8H-17Z"/><path d="M-9 0-21 39M9 0 23 39M-12-35-26-16M12-35 25-12" fill="none" stroke-width="9"/></g><g transform="translate(310 191) scale(.9)"><circle cy="-54" r="9"/><path d="M-12-40H12L17-8H-17Z"/><path d="M-9 0-21 39M9 0 23 39M-12-35-26-16M12-35 25-12" fill="none" stroke-width="9"/></g></g>
    <path data-trail fill="none" stroke="var(--celebration-accent)" stroke-width="3" stroke-linecap="round" opacity=".5"/>
    <ellipse data-shadow cy="250" rx="28" ry="6" fill="#031b23" opacity=".55"/>
    <g data-player>${limb('a')}${limb('b')}
      <path d="M-15-42Q0-49 15-42L17-7Q0-1-17-7Z" fill="var(--kit)" stroke="#ffffff45"/>
      <path data-stripe d="M-6-44H5V-5H-6Z" fill="var(--shorts)"/>
      <path d="M-17-8H17L16 9H3L0 2-3 9H-16Z" fill="var(--shorts)"/>
      <path d="M-5-47V-53H5V-47" fill="var(--skin)"/>
      <g data-head><ellipse cy="-63" rx="10" ry="12" fill="var(--skin)"/><path data-hair fill="#201c20"/><path d="M4-62h2M4-56h3" stroke="#493026" stroke-width="1.5" stroke-linecap="round"/></g>
      <text data-number y="-19" text-anchor="middle" fill="#fff" stroke="#0002" stroke-width=".5" font-size="20" font-family="Arial" font-weight="900"/>
    </g>
    <ellipse data-ball-shadow rx="8" ry="3" cy="251" fill="#001820" opacity=".5"/>
    <g data-ball><circle r="8" fill="url(#iconBall)" stroke="#fff"/><path d="M0-4 4-1 2 4H-2L-4-1ZM-7-4-4-6M5 6 7 3" fill="#142a3a" stroke="#142a3a"/></g>
    <g data-impact stroke="var(--celebration-accent)" stroke-width="2" fill="none"><circle r="16"/><path d="M-24 0H-31M24 0H31M0-24V-31M0 24V31"/></g>
    <g data-confetti></g>
    <text data-label x="22" y="30" fill="#f0e8cc" font-family="monospace" font-size="13" letter-spacing="2"/>
    <text data-goal x="300" y="78" text-anchor="middle" fill="var(--celebration-accent)" font-size="32" font-family="Arial" font-weight="900" opacity="0"/>
    <path d="M22 282H578" stroke="#ffffff25" stroke-width="2"/><path data-progress d="M22 282H22" stroke="var(--celebration-accent)" stroke-width="3"/>
  </svg>`;
  const fallback = host.querySelector("svg");
  const canvas = document.createElement("canvas");
  canvas.className = "iconMoveCanvas";
  canvas.setAttribute("role", "img");
  const caption = document.createElement("div");
  caption.className = "iconMoveCaption";
  const moveLabel = document.createElement("span"), finishLabel = document.createElement("strong");
  const phaseLabel = document.createElement("small");
  caption.append(moveLabel, phaseLabel, finishLabel);
  host.prepend(canvas);
  host.append(caption);
  const scene = createIconScene(canvas);
  canvas.hidden = !scene;
  fallback.toggleAttribute("hidden", Boolean(scene));
  caption.hidden = !scene;
  canvas.addEventListener("iconcontextlost", () => { fallback.removeAttribute("hidden"); caption.hidden = true; });
  const elements = Object.fromEntries([...host.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name.slice(5), el])));
  const get = name => elements[name];
  const attr=(name,key,value)=>get(name).setAttribute(key,value);
  let frame=0;
  let progress=0,paused=false,speed=1,previous=0,renderFrame=null,ended=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function stop(){cancelAnimationFrame(frame);}
  const resetClock=()=>{previous=performance.now();};
  document.addEventListener('visibilitychange',resetClock);
  function tick(now) {
    const active=!paused && !document.hidden;
    if(active)progress=Math.min(1,progress+(now-previous)*speed/ICON_MOVE_DURATION);
    previous=now;
    if(active){if(!reduced.matches)renderFrame?.(progress);onProgress(progress);}
    if(progress<1)frame=requestAnimationFrame(tick);
    else if(!ended){ended=true;onFinish();}
  }
  function play(slug){
    stop();
    progress=0;paused=false;ended=false;
    const look=LOOKS[slug] || LOOKS.messi;
    moveLabel.textContent = look[4];
    finishLabel.textContent = look[5];
    canvas.setAttribute("aria-label", `${look[4]}. Animated 3D football tribute.`);
    ['kit','shorts','skin'].forEach((name,i)=>host.style.setProperty(`--${name}`,look[i]));
    get('number').textContent=look[3];get('label').textContent=look[4];get('goal').textContent=look[5];
    fallback.setAttribute('aria-label',`${look[4]}, followed by ${look[5]}. Illustrated tribute.`);
    attr('stripe','opacity',['messi','maradona','ronaldinho'].includes(slug)?1:0);
    attr('hair','d',slug==='r9'?'M-7-71Q0-77 7-71L5-68H-6Z':slug==='ronaldinho'?'M-10-61Q-15-80 1-77Q15-76 10-61L13-44 5-49 6-69H-8Z':slug==='maradona'?'M-11-60Q-18-74-9-77Q-5-84 2-78Q16-82 13-64L8-66 5-73-9-69Z':'M-10-65Q-13-78 1-77Q14-76 10-65L5-71-9-69Z');
    attr('hair','fill',slug==='neymar'?'#e5d5a3':'#201c20');
    get('defenders').style.display=['messi','maradona','r9','ronaldinho'].includes(slug)?'':'none';
    const ns='http://www.w3.org/2000/svg';get('confetti').replaceChildren();
    const particles=Array.from({length:28},(_,i)=>{const el=document.createElementNS(ns,'rect');el.setAttribute('width',i%2?3:5);el.setAttribute('height',7);el.setAttribute('fill',i%3===0?'#fff':i%3===1?look[0]:'var(--celebration-accent)');get('confetti').append(el);return el;});
    function draw(t){
      let [,x,y,angle,lx,ly,rx,ry,bx,by]=sampleIconPose(slug,t);
      const finish=Math.max(0,(t-.76)/.24),jump=Math.sin(Math.min(1,finish*1.6)*Math.PI);
      if(finish){
        if(slug==='cristiano'){y-=jump*32;lx+=(-25-lx)*smooth(finish*5);rx+=(25-rx)*smooth(finish*5);angle=Math.sin(Math.min(1,finish/.65)*Math.PI)*12;}
        if(slug==='neymar'||slug==='ronaldinho'){x+=Math.sin(finish*14)*6;angle=Math.sin(finish*14)*7;lx=-20+Math.sin(finish*14)*5;rx=20+Math.sin(finish*14)*5;}
        if(slug==='pele'){y-=jump*27;}
      }
      attr('player','transform',`translate(${x} ${y}) rotate(${angle})`);attr('shadow','cx',x);attr('shadow','rx',Math.max(13,28-(206-y)*.12));
      // Two-segment legs: bend the knees while keeping each boot on its keyed contact point.
      for(const [side,fx,fy,hip] of [['a',lx,ly,-9],['b',rx,ry,9]]){
        const dx=fx-hip,dy=fy-3,len=Math.max(1,Math.hypot(dx,dy)),bend=Math.sqrt(Math.max(0,27*27-len*len/4));
        const kx=(hip+fx)/2+dy/len*bend*.65,ky=(3+fy)/2-dx/len*bend*.65;
        attr(`leg-${side}`,'d',`M${hip} 3L${kx} ${ky}L${fx} ${fy}`);
        attr(`sock-${side}`,'d',`M${kx*.4+fx*.6} ${ky*.4+fy*.6}L${fx} ${fy}`);
        attr(`boot-${side}`,'d',`M${fx-2} ${fy}l9 1`);
      }
      let arms=[[-29,-23,-34,-36],[29,-23,35,-15]];
      if(finish){
        arms=slug==='messi'?[[-24,-60,-24,-81],[24,-60,24,-81]]:slug==='cristiano'?[[-29,-27,-44,-12],[29,-27,44,-12]]:slug==='pele'?[[-25,-58,-26,-80],[25,-25,32,-15]]:slug==='ronaldinho'?[[-25,-35,-35,-49],[25,-35,35,-49]]:slug==='neymar'?[[-24,-53,-18,-66],[24,-53,18,-66]]:[[-29,-40,-48,-43],[29,-40,48,-43]];
      }
      for(const [i,side] of ['a','b'].entries()){const [ex,ey,hx,hy]=arms[i],sx=i?14:-14;attr(`arm-${side}`,'d',`M${sx}-39L${ex} ${ey}L${hx} ${hy}`);attr(`sleeve-${side}`,'d',`M${sx}-39L${sx+(ex-sx)*.45} ${-39+(ey+39)*.45}`);}
      attr('ball','transform',`translate(${bx} ${by}) rotate(${t*950})`);attr('ball-shadow','cx',bx);attr('ball-shadow','opacity',Math.max(.08,1-(251-by)/160)*.5);
      // Short velocity streak behind the shot, never a trail detached from the ball.
      attr('trail','d',t>.63&&t<.76?`M${bx-28} ${by+5}Q${bx-12} ${by+1} ${bx-9} ${by}`:'');
      const contact=contactTime(slug);
      const impact=Math.max(0,1-Math.abs(t-contact)/.04);attr('impact','transform',`translate(${bx} ${by}) scale(${1+(1-impact)*.8})`);attr('impact','opacity',impact*.8);
      attr('net','transform',`translate(${finish?Math.sin(finish*24)*Math.exp(-finish*8)*3:0} 0)`);
      attr('goal','opacity',Math.min(1,finish*6));
      particles.forEach((el,i)=>{const age=Math.max(0,finish-i*.006);el.setAttribute('opacity',finish>0?Math.min(1,age*12):0);el.setAttribute('transform',`translate(${30+(i*79%540)+Math.sin(age*8+i)*12} ${-20+age*(210+i%5*25)}) rotate(${age*220+i*31})`);});
      attr('progress','d',`M22 282H${22+t*556}`);
      const motion=sampleIconMotion(slug,t);
      phaseLabel.textContent=motion.phase;
      finishLabel.style.opacity=String(smooth((t-.79)/.08));
      host.style.setProperty("--move-progress", String(t));
      scene?.render({t,look,slug});
    }
    renderFrame=draw;
    draw(reduced.matches?.9:0);
    previous=performance.now();
    frame=requestAnimationFrame(tick);
  }
  return {play,stop,
    pause(value){paused=Boolean(value);},
    speed(value){speed=value===.5?.5:1;},
    seek(value){progress=clamp(value);ended=progress>=1;renderFrame?.(reduced.matches?.9:progress);onProgress(progress);stop();previous=performance.now();frame=requestAnimationFrame(tick);},
    dispose(){stop();document.removeEventListener('visibilitychange',resetClock);scene?.dispose();renderFrame=null;}
  };
}
