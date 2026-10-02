// Metres, seconds and joint targets shared by the renderer and animation checks.
// Every pose is sampled from time; replay and slow motion never accumulate drift.
const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, u) => a + (b - a) * u;
export const blend = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
export const ease = v => { const u = clamp(v); return u * u * (3 - 2 * u); };
export const ICON_PROFILES = {
  cristiano: { height: 1.08, build: 1.02, number: '7', name: 'RONALDO', contact: .44, move: 'BICYCLE KICK', finish: 'SIUUU!' },
  messi: { height: .95, build: 1, number: '10', name: 'MESSI', contact: .59, move: 'LEFT-FOOT MAGIC', finish: 'TO THE SKY' },
  neymar: { height: 1, build: .93, number: '10', name: 'NEYMAR JR', contact: .61, move: 'RAINBOW FLICK', finish: 'JOGA BONITO' },
  r9: { height: 1.03, build: 1.12, number: '9', name: 'RONALDO', contact: .59, move: 'DOUBLE STEPOVER', finish: 'O FENÔMENO' },
  maradona: { height: .93, build: 1.12, number: '10', name: 'MARADONA', contact: .61, move: 'THE SLALOM', finish: 'EL DIEGO' },
  ronaldinho: { height: 1.04, build: 1.03, number: '10', name: 'RONALDINHO', contact: .61, move: 'ELASTICO', finish: 'KEEP SMILING' },
  pele: { height: 1, build: 1, number: '10', name: 'PELÉ', contact: .44, move: 'FLYING VOLLEY', finish: 'O REI' },
};

// Cubic interpolation carries velocity across keyframes, with bounded slopes at turns.
function curve(keys, time) {
  let i = keys.findIndex(key => key[0] >= time);
  if (i < 1) i = time <= keys[0][0] ? 1 : keys.length - 1;
  const a = keys[i - 1], b = keys[i], dt = b[0] - a[0], u = clamp((time - a[0]) / dt);
  function slope(j, field) {
    if (!j || j === keys.length - 1) return 0;
    const l = (keys[j][field] - keys[j-1][field]) / (keys[j][0] - keys[j-1][0]);
    const r = (keys[j+1][field] - keys[j][field]) / (keys[j+1][0] - keys[j][0]);
    return l*r <= 0 ? 0 : 2*l*r/(l+r);
  }
  return a.slice(1).map((value, field) => {
    const f = field + 1;
    return (2*u*u*u-3*u*u+1)*value + (u*u*u-2*u*u+u)*dt*slope(i-1,f)
      + (-2*u*u*u+3*u*u)*b[f] + (u*u*u-u*u)*dt*slope(i,f);
  });
}

export function bodyAxes(yaw, tilt = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), a = Math.cos(tilt), b = Math.sin(tilt);
  return [[c*a,b,s*a],[-c*b,a,-s*b],[-s,0,c]];
}
export function localPoint(root, axes, p) {
  return root.map((v,i) => v + axes[0][i]*p[0] + axes[1][i]*p[1] + axes[2][i]*p[2]);
}

function runPath(slug, t) {
  const profile = ICON_PROFILES[slug], end = profile.contact - .075;
  if(slug==='neymar')return [-1.6+3*ease((t-.32)/(end-.32)),.9,0];
  const u = clamp(t/end);
  const late = slug === 'r9' || slug === 'ronaldinho';
  const start = slug === 'maradona' ? -3.2 : late ? -1.9 : -2.6;
  const distance = late ? curve([[0,0],[.38,.22],[.72,1.9],[1,3]],u)[0] : (u*1.18-u*u*.18)*4;
  const wave = slug === 'maradona' ? .55 : slug === 'messi' ? .28 : .12;
  return [start+distance, .9*profile.height, Math.sin(u*TAU*1.4)*wave*Math.sin(u*Math.PI)];
}

// During stance, each ankle stays on the same world-space spot. Only the swing foot travels.
function runningFeet(root, distance, size) {
  const stride = .96*size, phase = distance/stride;
  return [0,1].map(side => {
    const offset = side*.5, cycle = Math.floor(phase+offset), u = phase+offset-cycle;
    const planted = root[0]-distance+(cycle-offset)*stride+.21;
    return [planted+(u>.57?stride*ease((u-.57)/.43):0),
      .055+(u>.57?.27*Math.sin((u-.57)/.43*Math.PI):0), root[2]+(side?1:-1)*.135];
  });
}

function actionPose(slug, t) {
  const p=ICON_PROFILES[slug], contact=p.contact;
  let root, tilt=0, yaw=0, feet, distance=0;
  if(slug==='cristiano') {
    const v=curve([[0,-.65,.97,0],[.16,-.45,.84,-.12],[.28,-.18,1.12,.42],
      [.44,.05,1.42,1.65],[.51,.18,1.05,1.94],[.58,.25,.42,1.08],[.69,.34,.94,0],[1,.34,.94,0]],t);
    root=[v[0],v[1],0];tilt=v[2];
    const ankles=curve([[0,-.78,.055,-.40,.055],[.16,-.65,.055,-.21,.055],
      [.28,-.58,.68,.10,.80],[.44,-.58,1.12,.42,2.15],[.51,-.28,.38,.60,1.43],
      [.58,.20,.06,.85,.08],[.69,.13,.055,.55,.055],[1,.13,.055,.55,.055]],t);
    feet=[[ankles[0],ankles[1],-.14],[ankles[2],ankles[3],.14]];
  } else if(slug==='pele') {
    const v=curve([[0,-1.15,.92,0],[.20,-.67,.82,-.12],[.35,-.24,1.25,-.18],
      [.44,.0,1.33,.25],[.55,.25,1.02,.10],[.68,.38,.91,0],[1,.38,.91,0]],t);
    root=[v[0],v[1],0];tilt=v[2];
    const ankles=curve([[0,-1.30,.055,-.98,.055],[.20,-.78,.055,-.45,.12],
      [.35,-.52,.52,.12,.87],[.44,-.31,.69,.84,1.36],[.55,.08,.09,.72,.45],
      [.68,.18,.055,.60,.055],[1,.18,.055,.60,.055]],t);
    feet=[[ankles[0],ankles[1],-.14],[ankles[2],ankles[3],.14]];
  } else {
    root=runPath(slug,t);const start=runPath(slug,0);distance=root[0]-start[0];
    feet=runningFeet(root,distance,p.height);
    root[1]+=.025*Math.cos(distance/.96*TAU*2);
    const before=runPath(slug,Math.max(0,t-.003)),after=runPath(slug,t+.003);
    yaw=Math.atan2(after[2]-before[2],Math.max(.03,after[0]-before[0]))*.4;
    tilt=-.09;
    if(slug==='r9'&&t<.28) {
      const phase=t/.14,side=Math.floor(phase)%2,u=phase%1;
      const center=[root[0]+.35,.12,root[2]];
      feet[side]=blend(feet[side],[center[0]+Math.sin(u*Math.PI)*.24,.06+Math.sin(u*Math.PI)*.18,center[2]+Math.cos(u*Math.PI)*.29],Math.pow(Math.sin(u*Math.PI),2));
      tilt=lerp(tilt,.1*Math.sin(phase*Math.PI),1-ease((t-.245)/.035));
    }
    if(slug==='ronaldinho'&&t>.14&&t<.33) {
      const u=(t-.14)/.19,side=.46*Math.sin(u*TAU*.75);
      const weight=ease((t-.14)/.035)*(1-ease((t-.285)/.045));
      feet[1]=blend(feet[1],[root[0]+.38,.07,root[2]+side],weight);yaw=lerp(yaw,-side*.5,weight);
    }
    if(slug==='neymar'&&t<.32) {
      const weight=1-ease((t-.28)/.04);
      feet=feet.map((foot,i)=>blend(foot,[root[0]+(i?.13:-.12),.055,i?.12:-.12],weight));
      const scoop=Math.sin(clamp((t-.12)/.14)*Math.PI);
      feet[1]=blend(feet[1],[root[0]-.1-scoop*.16,.055+scoop*.32,.08],ease((t-.10)/.04)*weight);tilt=lerp(tilt,-scoop*.16,weight);
    }
    const kick=ease((t-contact+.075)/.075),recover=ease((t-contact)/.13);
    if(t>contact-.075) {
      const end=runPath(slug,contact),side=slug==='messi'||slug==='maradona'?0:1;
      root=blend(root,[end[0],.88*p.height,end[2]],kick);
      const goalFoot=[root[0]+.69,.27,root[2]+(side?1:-1)*.13];
      feet[side]=blend(feet[side],goalFoot,kick);
      feet[side]=blend(feet[side],[root[0]+.24,.055,root[2]+(side?1:-1)*.14],recover);
      feet[1-side]=blend(feet[1-side],[root[0]-.15,.055,root[2]+(side?-1:1)*.14],kick);
      tilt=lerp(-.09,.11,Math.sin(kick*Math.PI/2)*(1-recover));
    }
  }
  const axes=bodyAxes(yaw,tilt),s=p.height;
  const runSwing=Math.sin(distance/.96*TAU)*.24;
  const hands=[[-runSwing+.05,.23,-.35],[runSwing+.12,.26,.35]].map(v=>localPoint(root,axes,v.map(x=>x*s)));
  if(slug==='cristiano') {
    const u=ease((t-.2)/.12)*(1-ease((t-.59)/.1));
    hands[0]=blend(hands[0],[root[0]-.45,Math.max(.12,root[1]-.22),-.45],u);
    hands[1]=blend(hands[1],[root[0]+.06,Math.max(.12,root[1]-.30),.49],u);
  }
  return {root,feet,hands,axes,yaw,tilt,height:s,build:p.build};
}

export function sampleIconMotion(slug, time) {
  if(!ICON_PROFILES[slug])slug='messi';
  const t=clamp(time),p=ICON_PROFILES[slug],contact=p.contact;
  const pose=actionPose(slug,Math.min(t,.72));
  const shot=actionPose(slug,contact),kicking=slug==='messi'||slug==='maradona'?0:1;
  const strike=shot.feet[kicking].map((v,i)=>v+(i===0?.16:i===1?.07:0));
  let ball;
  if(t<contact) {
    if(slug==='cristiano'||slug==='pele') {
      const u=ease(t/contact);
      ball=blend(slug==='cristiano'?[1.5,2.6,.1]:[-2.2,2.1,.15],strike,u);
      ball[1]+=.25*Math.sin(u*Math.PI);
    } else if(slug==='neymar'&&t>.12&&t<.46) {
      const normalAt=time=>[runPath(slug,time)[0]+.38+.07*Math.sin(time*72),.12+.025*Math.abs(Math.sin(time*72)),-.06];
      if(t<.2)ball=blend(normalAt(.12),[-1.72,.15,.08],ease((t-.12)/.08));
      else {const u=(t-.2)/.26;ball=blend([-1.72,.15,.08],normalAt(.46),u);ball[1]+=2.15*Math.sin(u*Math.PI);}
    } else if(slug==='ronaldinho'&&t>.14&&t<.33) {
      const weight=ease((t-.14)/.035)*(1-ease((t-.285)/.045));
      ball=blend([pose.root[0]+.38+.07*Math.sin(t*72),.12+.025*Math.abs(Math.sin(t*72)),pose.root[2]-.06],[pose.feet[1][0]+.12,.12,pose.feet[1][2]],weight);
    } else {
      ball=[pose.root[0]+.38+.07*Math.sin(t*72),.12+.025*Math.abs(Math.sin(t*72)),pose.root[2]-.06];
    }
    const contactBlend=ease((t-contact+.045)/.045);ball=blend(ball,strike,contactBlend);
  } else {
    const u=clamp((t-contact)/(.72-contact));ball=blend(strike,[5.5,.35,.6],u);
    ball[1]+=(slug==='cristiano'?.45:.22)*4*u*(1-u);
    if(t>.72){const age=(t-.72)*9;ball=[5.5-.10*(1-Math.exp(-age*4)),.12+.23*Math.abs(Math.cos(age*7))*Math.exp(-age*3),.6];}
  }
  const celebration=ease((t-.75)/.08),age=clamp((t-.75)/.25);
  if(celebration>0) {
    // Turn towards the camera for the final pose, through the ankles rather than at the waist.
    pose.yaw=lerp(pose.yaw,1.35,celebration);pose.tilt*=1-celebration;
    let jump=0;
    if(slug==='cristiano')jump=.43*Math.pow(Math.sin(clamp(age/.62)*Math.PI),2);
    if(slug==='pele')jump=.32*Math.pow(Math.sin(clamp(age/.65)*Math.PI),2);
    pose.root[1]+=jump;pose.axes=bodyAxes(pose.yaw,pose.tilt);
    const s=pose.height;
    pose.feet=pose.feet.map((foot,i)=>blend(foot,localPoint(pose.root,pose.axes,[.02,-.88*s+jump*.12,(i?1:-1)*(slug==='cristiano'?.30:.22)]),celebration));
    pose.feet.forEach(foot=>{foot[1]=Math.max(.055+jump,foot[1]);});
    let hands;
    if(slug==='messi')hands=[[.03,1.10,-.27],[.03,1.10,.27]];
    else if(slug==='cristiano')hands=[[.06,.02,-.68],[.06,.02,.68]];
    else if(slug==='neymar')hands=[[.10,.71,-.29],[.10,.71,.29]];
    else if(slug==='ronaldinho')hands=[[.12,.52,-.43],[.12,.52,.43]];
    else if(slug==='pele')hands=[[.08,.14,-.46],[.02,1.03,.24]];
    else hands=[[.08,.49,-.70],[.08,.49,.70]];
    pose.hands=pose.hands.map((hand,i)=>blend(hand,localPoint(pose.root,pose.axes,hands[i].map(v=>v*s)),celebration));
  }
  pose.feet.forEach(foot=>{foot[1]=Math.max(.055,foot[1]);});
  // One continuous camera move: close during the skill, wider to see the finish.
  const follow=ease((t-contact)/.16)*(1-ease((t-.75)/.10));
  const target=[lerp(pose.root[0]+.25,ball[0]-.5,follow*.70),1.05,pose.root[2]];
  const distance=lerp(5.2,6.8,follow),orbit=lerp(-.26,.16,ease(t));
  const camera={target,eye:[target[0]+Math.sin(orbit)*distance,2.5,Math.cos(orbit)*distance]};
  const defenders=['messi','maradona','r9','ronaldinho','neymar'].includes(slug)
    ? (slug==='maradona'?[-2.1,-.65,.75]:[-1.0,.75]).map((x,i)=>{
      const reaction=Math.exp(-Math.pow((pose.root[0]-x)*2.5,2));
      return {x:x-reaction*.22,z:-.55+(i%2)*.55,reaction};
    }):[];
  return {slug,t,pose,ball,camera,defenders,contact,celebration,profile:p,
    phase:t<contact-.08?'THE APPROACH':t<contact+.035?'SIGNATURE MOVE':t<.75?'THE FINISH':'THE CELEBRATION'};
}
