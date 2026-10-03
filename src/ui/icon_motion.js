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

export function bodyAxes(yaw, tilt = 0, roll = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), a = Math.cos(tilt), b = Math.sin(tilt);
  const up=[-c*b,a,-s*b],side=[-s,0,c],cr=Math.cos(roll),sr=Math.sin(roll);
  return [[c*a,b,s*a],up.map((v,i)=>v*cr+side[i]*sr),side.map((v,i)=>v*cr-up[i]*sr)];
}
export function localPoint(root, axes, p) {
  return root.map((v,i) => v + axes[0][i]*p[0] + axes[1][i]*p[1] + axes[2][i]*p[2]);
}

function runPath(slug, t) {
  const profile = ICON_PROFILES[slug], end = profile.contact - .075;
  if(slug==='neymar')return [-1.6+3*ease((t-.32)/(end-.32)),.86,0];
  const u = clamp(t/end);
  const late = slug === 'r9' || slug === 'ronaldinho';
  const start = slug === 'maradona' ? -3.2 : late ? -1.9 : -2.6;
  const distance = late ? curve([[0,0],[.40,.12],[.52,.35],[.76,1.7],[1,3]],u)[0] : (u*1.18-u*u*.18)*4;
  const wave = slug === 'maradona' ? .55 : slug === 'messi' ? .28 : .12;
  const z = slug==='ronaldinho' ? curve([[0,0],[.32,.06],[.40,.12],[.49,-.15],[.72,-.35],[1,0]],u)[0]
    : Math.sin(u*TAU*1.4)*wave*Math.sin(u*Math.PI);
  return [start+distance, (slug==='messi'||slug==='maradona'?.83:.9)*profile.height, z];
}

// Each left-foot touch is a shared event for the boot and the ball. Between
// contacts the ball travels freely; it is never attached to the pelvis.
function dribbleBall(slug, t) {
  const side = slug==='messi'||slug==='maradona' ? 0 : 1;
  const offset = side * .5;
  const period=gaitPeriod(slug);
  const phase = t / period + offset, cycle = Math.floor(phase), u = phase-cycle;
  const touch = time => {
    const point=runPath(slug,Math.max(0,time)),s=ICON_PROFILES[slug].height;
    return [point[0]+.23*s+.14,.12,point[2]+(side?1:-1)*.14];
  };
  const a=touch((cycle-offset)*period),b=touch((cycle+1-offset)*period);
  const ball=blend(a,b,u+.17*u*(1-u));
  ball[1]+=.035*Math.sin(u*Math.PI);
  return ball;
}

// During stance, each ankle stays on the same world-space spot. Only the swing foot travels.
const GAIT = .095;
const gaitPeriod = slug => slug==='neymar' ? .060 : GAIT;
function runningFeet(slug, time) {
  const size = ICON_PROFILES[slug].height;
  const period=gaitPeriod(slug);
  return [0,1].map(side => {
    const phase = time / period + side * .5, cycle = Math.floor(phase), u = phase - cycle;
    const land = (cycle - side * .5) * period;
    const plant = when => {
      const point = runPath(slug, Math.max(0, when));
      return [point[0] + .23 * size, .055, point[2] + (side ? 1 : -1) * .14];
    };
    const from = plant(land), to = plant(land + period);
    if (u <= .58) return from;
    const swing = (u - .58) / .42;
    const foot = blend(from, to, ease(swing));
    foot[1] += .24 * size * Math.pow(Math.sin(swing * Math.PI), 2);
    return foot;
  });
}

function actionPose(slug, t) {
  const p=ICON_PROFILES[slug], contact=p.contact;
  let root, tilt=0, yaw=0, roll=0, feet, distance=0;
  if(slug==='cristiano') {
    // Load the supporting right leg, drive the left knee, then scissor the right
    // boot above the hips. The back/forearms absorb the landing before recovery.
    const v=curve([[0,-.65,.94,0],[.22,-.50,.94,-.06],[.30,-.38,.77,-.16],
      [.36,-.24,1.18,.48],[.405,-.10,1.49,1.12],[.44,.04,1.50,1.63],
      [.48,.18,1.22,1.95],[.535,.29,.43,1.74],[.56,.32,.28,1.48],
      [.59,.34,.33,1.12],[.635,.35,.52,.48],[.69,.36,.94,0],[1,.36,.94,0]],t);
    root=[v[0],v[1],0];tilt=v[2];
    const ankles=curve([[0,-.86,.055,-.43,.055],[.22,-.75,.055,-.27,.055],
      [.30,-.61,.17,-.27,.055],[.36,.30,1.35,-.36,.36],
      [.405,.39,2.03,-.36,1.17],[.44,-.62,1.23,.31,2.32],
      [.48,-.49,.75,.86,1.74],[.535,-.25,.07,1.02,.78],
      [.56,.04,.055,.96,.35],[.59,.17,.055,.82,.055],
      [.635,.11,.055,.62,.055],[.69,.14,.055,.58,.055],[1,.14,.055,.58,.055]],t);
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
    feet=runningFeet(slug,t);
    // Two compressions per stride, with an opposing arm swing.
    root[1]+=.022*Math.cos(t/gaitPeriod(slug)*TAU*2);
    const headingTime=Math.min(t,contact-.081);
    const before=runPath(slug,Math.max(0,headingTime-.003)),after=runPath(slug,headingTime+.003);
    yaw=Math.atan2(after[2]-before[2],Math.max(.001,after[0]-before[0]))*.65;
    yaw*=1-ease((t-contact+.075)/.075);
    tilt=slug==='messi'||slug==='maradona'?-.18:-.09;
    roll=-.16*Math.sin(t/gaitPeriod(slug)*TAU)*(1-ease((t-contact+.075)/.075));
    if(slug==='r9'&&t<.28) {
      // Two complete inside-to-outside circles around a stationary ball.
      const phase=clamp((t-.06)/.085,0,2),side=phase<1?1:0,u=phase%1;
      const sign=side?1:-1,weight=ease((t-.025)/.035)*(1-ease((t-.23)/.05));
      const right=curve([[0,-.08,.055,.2],[.06,-.08,.055,.2],[.082,.33,.13,-.25],
        [.102,.61,.24,0],[.125,.35,.13,.31],[.15,-.08,.055,.2],[1,-.08,.055,.2]],t);
      const left=curve([[0,-.08,.055,-.2],[.145,-.08,.055,-.2],[.165,.33,.13,.25],
        [.187,.61,.24,0],[.21,.35,.13,-.31],[.235,-.08,.055,-.2],[1,-.08,.055,-.2]],t);
      feet=feet.map((foot,i)=>{const target=i?right:left;return blend(foot,[root[0]+target[0],target[1],target[2]],weight);});
      root[1]-=.055*weight;root[2]-=sign*.055*Math.sin(u*Math.PI)*weight;
      yaw+=sign*.18*Math.sin(u*Math.PI)*weight;
    }
    if(slug==='ronaldinho'&&t>.10&&t<.29) {
      // One right boot: outside push, sharp inside cut, then acceleration.
      const weight=ease((t-.10)/.035)*(1-ease((t-.245)/.045));
      const side=curve([[.10,.13],[.145,.14],[.18,.46],[.205,.43],[.235,-.29],[.29,-.18]],t)[0];
      feet[1]=blend(feet[1],[root[0]+.34,.065,side],weight);
      feet[0]=blend(feet[0],[-2.01,.055,-.20],weight);
      yaw=lerp(yaw,-side*.65,weight);root[1]-=.07*weight;
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
      const footArc=curve([[0,-.15,.055],[.32,-.38,.28],[.62,-.05,.40],[1,.61,.27]],kick);
      const goalFoot=[root[0]+footArc[0],footArc[1],root[2]+(side?1:-1)*.13];
      feet[side]=blend(feet[side],goalFoot,kick);
      feet[side]=blend(feet[side],[root[0]+.24,.055,root[2]+(side?1:-1)*.14],recover);
      feet[1-side]=blend(feet[1-side],[root[0]-.15,.055,root[2]+(side?-1:1)*.14],kick);
      tilt=lerp(-.09,.11,Math.sin(kick*Math.PI/2)*(1-recover));
    }
  }
  const axes=bodyAxes(yaw,tilt,roll),s=p.height;
  const runSwing=Math.sin(t/gaitPeriod(slug)*TAU)*.25*(1-ease((t-contact+.06)/.13));
  const hands=[[-runSwing+.05,.23,-.35],[runSwing+.12,.26,.35]].map(v=>localPoint(root,axes,v.map(x=>x*s)));
  if(slug==='cristiano') {
    const u=ease((t-.2)/.12)*(1-ease((t-.59)/.1));
    hands[0]=blend(hands[0],[root[0]-.45,Math.max(.12,root[1]-.22),-.45],u);
    hands[1]=blend(hands[1],[root[0]+.06,Math.max(.12,root[1]-.30),.49],u);
  }
  if(slug==='neymar') {
    const balance=ease((t-.10)/.06)*(1-ease((t-.37)/.09));
    hands.forEach((hand,i)=>hands[i]=blend(hand,localPoint(root,axes,[.05,.48,(i?1:-1)*.59]),balance));
  }
  if(slug==='ronaldinho') {
    const balance=ease((t-.10)/.04)*(1-ease((t-.25)/.08));
    hands[0]=blend(hands[0],localPoint(root,axes,[-.1,.42,-.63]),balance);
  }
  const bootPitch=feet.map(foot=>foot[1]>.11 ? -.25 : 0);
  if(slug==='cristiano') {
    const pitch=curve([[0,0,0],[.30,.3,0],[.36,.6,-.6],[.405,.75,-.8],
      [.44,-.7,1.10],[.48,-.35,.7],[.56,0,.2],[.62,0,0],[1,0,0]],t);
    bootPitch.splice(0,2,...pitch);
  }
  return {root,feet,hands,axes,yaw,tilt,roll,bootPitch,height:s,build:p.build};
}

export function sampleIconMotion(slug, time) {
  if(!ICON_PROFILES[slug])slug='messi';
  const t=clamp(time),p=ICON_PROFILES[slug],contact=p.contact,netTime=contact+.105;
  const pose=actionPose(slug,Math.min(t,.72));
  const shot=actionPose(slug,contact),kicking=slug==='messi'||slug==='maradona'?0:1;
  const pitch=shot.bootPitch[kicking];
  const strike=shot.feet[kicking].map((v,i)=>v+(i===0?.16*Math.cos(pitch):i===1?.07+.16*Math.sin(pitch):0));
  let ball;
  if(t<contact) {
    if(slug==='cristiano'||slug==='pele') {
      const u=ease(t/contact);
      ball=blend(slug==='cristiano'?[1.5,2.6,.1]:[-2.2,2.1,.15],strike,u);
      ball[1]+=.25*Math.sin(u*Math.PI);
    } else if(slug==='neymar'&&t>.12&&t<.46) {
      const normalAt=time=>dribbleBall(slug,time);
      if(t<.2)ball=blend(normalAt(.12),[-1.72,.15,.08],ease((t-.12)/.08));
      else {const u=(t-.2)/.26;ball=blend([-1.72,.15,.08],normalAt(.46),u);ball[1]+=2.15*4*u*(1-u);}
    } else if(slug==='ronaldinho'&&t>.10&&t<.29) {
      const weight=ease((t-.10)/.035)*(1-ease((t-.245)/.045));
      ball=blend(dribbleBall(slug,t),[pose.feet[1][0]+.13,.12,pose.feet[1][2]],weight);
    } else if(slug==='r9'&&t<.28) {
      ball=blend(dribbleBall(slug,t),[pose.root[0]+.35,.12,0],ease((t-.025)/.035)*(1-ease((t-.23)/.05)));
    } else {
      ball=dribbleBall(slug,t);
    }
    const contactBlend=ease((t-contact+.045)/.045);ball=blend(ball,strike,contactBlend);
  } else {
    const u=clamp((t-contact)/(netTime-contact));ball=blend(strike,[5.5,.35,.6],u);
    ball[1]+=(slug==='cristiano'?.45:.22)*4*u*(1-u);
    if(t>netTime){const age=(t-netTime)*9;ball=[5.5-.10*(1-Math.exp(-age*4)),.12+.23*Math.abs(Math.cos(age*7))*Math.exp(-age*3),.6];}
  }
  const celebration=ease((t-.75)/.08),age=clamp((t-.75)/.25);
  if(celebration>0) {
    // Turn towards the camera for the final pose, through the ankles rather than at the waist.
    pose.yaw=lerp(pose.yaw,1.35,celebration);pose.tilt*=1-celebration;
    let jump=0;
    if(slug==='cristiano')jump=.43*Math.sin(clamp((age-.10)/.53)*Math.PI);
    if(slug==='pele')jump=.32*Math.pow(Math.sin(clamp(age/.65)*Math.PI),2);
    const landing=slug==='cristiano'?.14*Math.pow(Math.sin(clamp((age-.63)/.24)*Math.PI),2):0;
    pose.root[1]+=jump-landing;pose.axes=bodyAxes(pose.yaw,pose.tilt);
    const s=pose.height;
    pose.feet=pose.feet.map((foot,i)=>blend(foot,localPoint(pose.root,pose.axes,[.02,-.88*s+jump*.12,(i?1:-1)*(slug==='cristiano'?.30:.22)]),celebration));
    pose.feet.forEach(foot=>{foot[1]=Math.max(.055+jump,foot[1]);});
    let hands;
    if(slug==='messi')hands=[[.03,1.10,-.27],[.03,1.10,.27]];
    else if(slug==='cristiano') {
      const sweep=ease((age-.37)/.29);
      hands=[-1,1].map(side=>blend([.04,.98,side*.25],[.06,.02,side*.68],sweep));
    }
    else if(slug==='neymar')hands=[[.10,.71,-.29],[.10,.71,.29]];
    else if(slug==='ronaldinho')hands=[[.12,.52,-.43],[.12,.52,.43]];
    else if(slug==='pele')hands=[[.08,.14,-.46],[.02,1.03,.24]];
    else hands=[[.08,.49,-.70],[.08,.49,.70]];
    pose.hands=pose.hands.map((hand,i)=>blend(hand,localPoint(pose.root,pose.axes,hands[i].map(v=>v*s)),celebration));
    pose.bootPitch=pose.bootPitch.map(pitch=>lerp(pitch,0,celebration));
  }
  pose.feet.forEach(foot=>{foot[1]=Math.max(.055,foot[1]);});
  // One continuous camera move: close during the skill, wider to see the finish.
  const follow=ease((t-contact)/.16)*(1-ease((t-.75)/.10));
  const aerial=slug==='cristiano'||slug==='pele';
  const target=[lerp(pose.root[0]+.25,ball[0]-.5,follow*.70),aerial?1.35:1.05,pose.root[2]];
  const distance=lerp(aerial?6.1:5.2,6.8,follow),orbit=lerp(-.26,.16,ease(t));
  const camera={target,eye:[target[0]+Math.sin(orbit)*distance,aerial?2.85:2.5,Math.cos(orbit)*distance]};
  const defenders=['messi','maradona','r9','ronaldinho','neymar'].includes(slug)
    ? (slug==='maradona'?[-2.1,-.65,.75]:[-1.0,.75]).map((x,i)=>{
      const reaction=Math.exp(-Math.pow((pose.root[0]-x)*2.5,2));
      return {x:x-reaction*.22,z:-.55+(i%2)*.55,reaction};
    }):[];
  return {slug,t,pose,ball,camera,defenders,contact,netTime,celebration,profile:p,
    phase:t<(aerial?.30:.10)?'THE APPROACH':t<contact+.035?'SIGNATURE MOVE':t<.75?'THE FINISH':'THE CELEBRATION'};
}
