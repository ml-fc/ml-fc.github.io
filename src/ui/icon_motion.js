// Metres, seconds and joint targets shared by the renderer and animation checks.
// Every pose is sampled from time; replay and slow motion never accumulate drift.
const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, u) => a + (b - a) * u;
export const blend = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
export const ease = v => { const u = clamp(v); return u*u*u*(10+u*(-15+6*u)); };
export const ICON_PROFILES = {
  cristiano: { height: 1.08, build: 1.02, number: '7', name: 'RONALDO', contact: .44, move: 'BICYCLE KICK', finish: 'SIUUU!' },
  messi: { height: .95, build: 1, number: '10', name: 'MESSI', contact: .59, move: 'LEFT-FOOT MAGIC', finish: 'TO THE SKY' },
  neymar: { height: 1, build: .93, number: '11', name: 'NEYMAR JR', contact: .61, move: 'THE SANTOS SOLO', finish: 'JOGA BONITO' },
  r9: { height: 1.03, build: 1.12, number: '9', name: 'RONALDO', contact: .59, move: 'THE FINAL FINISH', finish: 'O FENÔMENO' },
  maradona: { height: .93, build: 1.12, number: '10', name: 'MARADONA', contact: .61, move: 'THE SLALOM', finish: 'EL DIEGO' },
  ronaldinho: { height: 1.04, build: 1.03, number: '10', name: 'RONALDINHO', contact: .61, move: 'THE CHELSEA TOE-POKE', finish: 'KEEP SMILING' },
  pele: { height: 1, build: 1, number: '10', name: 'PELÉ', contact: .55, move: 'CHEST · FLICK · VOLLEY', finish: 'O REI' },
};

// Quintic Hermite curves carry velocity through each key and share zero
// acceleration on both sides. This prevents the visible jerk of cubic joins.
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
    const u3=u*u*u,u4=u3*u,u5=u4*u;
    return (1-10*u3+15*u4-6*u5)*value + (u-6*u3+8*u4-3*u5)*dt*slope(i-1,f)
      + (10*u3-15*u4+6*u5)*b[f] + (-4*u3+7*u4-3*u5)*dt*slope(i,f);
  });
}

// Playback beats are separate from pose keys. A kick must not hang in the air
// simply because the popup also needs time for approach and celebration.
const PLAYBACK_BEATS = {
  cristiano:[[0,0],[.15,.27],[.22,.345],[.232,.375],[.244,.405],[.258,.44],[.275,.485],[.30,.555],[.40,.68],[.54,.75],[.58,.79],[.62,.85],[.67,.91],[.74,1],[1,1]],
  messi:[[0,0],[.08,.10],[.30,.515],[.34,.59],[.44,.72],[.55,.75],[.64,.83],[.79,1],[1,1]],
  maradona:[[0,0],[.05,.07],[.30,.535],[.35,.61],[.44,.72],[.55,.75],[.64,.83],[.79,1],[1,1]],
  neymar:[[0,0],[.10,.16],[.14,.23],[.19,.32],[.32,.535],[.38,.61],[.49,.72],[.56,.75],[.65,.83],[.80,1],[1,1]],
  r9:[[0,0],[.06,.20],[.13,.32],[.24,.515],[.30,.59],[.43,.72],[.52,.75],[.61,.83],[.76,1],[1,1]],
  ronaldinho:[[0,0],[.10,.12],[.32,.50],[.35,.535],[.39,.61],[.47,.72],[.55,.75],[.64,.83],[.79,1],[1,1]],
  pele:[[0,0],[.12,.12],[.21,.22],[.38,.49],[.42,.55],[.51,.72],[.58,.75],[.67,.83],[.82,1],[1,1]],
};
export const iconActionTime=(slug,progress)=>curve(PLAYBACK_BEATS[slug]||PLAYBACK_BEATS.messi,clamp(progress))[0];
export function iconActionProgress(slug,time) {
  let a=0,b=1;
  for(let i=0;i<28;i++){const m=(a+b)/2;if(iconActionTime(slug,m)<time)a=m;else b=m;}
  return (a+b)/2;
}

export function bodyAxes(yaw, tilt = 0, roll = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), a = Math.cos(tilt), b = Math.sin(tilt);
  const up=[-c*b,a,-s*b],side=[-s,0,c],cr=Math.cos(roll),sr=Math.sin(roll);
  return [[c*a,b,s*a],up.map((v,i)=>v*cr+side[i]*sr),side.map((v,i)=>v*cr-up[i]*sr)];
}
export function localPoint(root, axes, p) {
  return root.map((v,i) => v + axes[0][i]*p[0] + axes[1][i]*p[1] + axes[2][i]*p[2]);
}

// A knee bends in the rotating sagittal plane, not towards a fixed world
// direction. Its perpendicular follows the ankle continuously through the
// scissor action, including when the torso passes horizontal or inverted.
export function solveIconKnees(pose) {
  const {root,axes,height:size,feet}=pose;
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  return feet.map((foot,i)=>{
    const side=i?1:-1,hip=localPoint(root,axes,[0,-.025*size,side*.12*size]);
    const delta=foot.map((v,j)=>v-hip[j]),length=Math.hypot(...delta);
    const direction=delta.map(v=>v/(length||1));
    const x=dot(delta,axes[0]),y=dot(delta,axes[1]);
    const pole=axes[0].map((v,j)=>-y*v+x*axes[1][j]+side*.025*axes[2][j]);
    const parallel=dot(pole,direction),perpendicular=pole.map((v,j)=>v-parallel*direction[j]);
    const magnitude=Math.hypot(...perpendicular)||1;
    const a=.47*size,b=.48*size,d=clamp(length,.025,a+b-.001);
    const along=(a*a-b*b+d*d)/(2*d),bend=Math.sqrt(Math.max(0,a*a-along*along));
    return hip.map((v,j)=>v+direction[j]*along+perpendicular[j]/magnitude*bend);
  });
}

// Distinct receive/turn/accelerate/keeper-rounding beats instead of a sine slalom.
const RUN_PATHS = {
  messi:[[0,-2.6,.24],[.10,-1.98,.20],[.18,-1.34,-.28],[.27,-.65,-.36],[.36,.04,.12],[.44,.68,.26],[.515,1.4,-.30],[.59,1.4,-.30]],
  maradona:[[0,-3.2,.20],[.07,-3.0,.34],[.14,-2.63,-.24],[.23,-1.80,-.42],[.32,-.88,-.16],[.42,.03,.15],[.535,1.25,-.40],[.61,1.25,-.40]],
  neymar:[[0,-2.6,-.32],[.12,-2.05,.02],[.20,-1.5,.20],[.30,-.98,.20],[.39,-.40,-.32],[.46,.28,-.42],[.535,1.22,.08],[.61,1.22,.08]],
};
function runPath(slug, t) {
  const profile = ICON_PROFILES[slug];
  if(RUN_PATHS[slug]){const [x,z]=curve(RUN_PATHS[slug],t);return [x,.81*profile.height,z];}
  if(slug==='ronaldinho')return [-1.05+.12*ease(t/.61),.83*profile.height,0];
  if(slug==='r9')return [-.75+1.75*ease((t-.20)/.315),.84*profile.height,.18*(1-ease((t-.32)/.195))];
  return [0,.85*profile.height,0];
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
const gaitPeriod = slug => slug==='maradona' ? .055 : slug==='neymar' ? .070 : slug==='messi' ? .075 : GAIT;
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
    foot[1] += .24 * size * Math.pow(Math.sin(swing * Math.PI), 3);
    return foot;
  });
}

function actionPose(slug, t) {
  const p=ICON_PROFILES[slug], contact=p.contact;
  let root, tilt=0, yaw=0, roll=0, feet;
  if(slug==='cristiano') {
    // Load the supporting right leg, drive the left knee, then scissor the right
    // boot above the hips. The back/forearms absorb the landing before recovery.
    const v=curve([[0,-.65,.94,0],[.27,-.50,.94,-.04],[.345,-.38,.80,-.12],
      [.375,-.24,1.12,.38],[.405,-.10,1.43,.92],[.44,.04,1.55,1.45],
      [.465,.18,1.35,2.12],[.485,.24,1.13,2.55],[.505,.29,.82,2.30],
      [.535,.32,.38,1.68],[.555,.34,.30,1.42],[.59,.35,.43,.86],
      [.64,.36,.74,.22],[.68,.36,.94,0],[1,.36,.94,0]],t);
    // Back to goal (+X), watching the cross: the chest turns skyward as the
    // head falls toward goal and the right leg strikes over the shoulder.
    const backstep=-.65-(v[0]+.65)*.55,shift=backstep-v[0];
    root=[backstep,v[1],0];tilt=v[2];yaw=Math.PI;
    const ankles=curve([[0,-.86,.055,-.43,.055],[.27,-.75,.055,-.27,.055],
      [.345,-.61,.17,-.27,.055],[.375,-.65,.92,-.36,.31],
      [.405,-.50,1.94,-.64,1.05],[.420,-.65,1.72,-.64,1.80],
      [.430,-.65,1.46,-.25,2.35],[.44,-.61,1.28,.16,2.51],
      [.465,-.29,1.74,.50,2.17],[.485,.06,1.94,.71,1.88],
      [.505,.02,1.51,.87,1.40],[.535,-.02,.68,.87,.69],
      [.555,.11,.28,.79,.28],[.59,.12,.055,.67,.055],
      [.64,.14,.055,.58,.055],[1,.14,.055,.58,.055]],t);
    feet=[[ankles[0]+shift,ankles[1],.14],[ankles[2]+shift,ankles[3],-.14]];
  } else if(slug==='pele') {
    const v=curve([[0,-1.2,.89,.06],[.12,-1.15,.85,.20],[.22,-1.1,.83,-.16],
      [.31,-.86,.87,-.08],[.43,-.32,.88,-.15],[.55,.10,.86,-.19],
      [.60,.18,.83,.06],[.67,.28,.90,0],[1,.28,.90,0]],t);
    root=[v[0],v[1],0];tilt=v[2];yaw=-.55*(1-ease((t-.12)/.22));
    const ankles=curve([[0,-1.40,.055,-.94,.055],[.12,-1.34,.055,-.97,.055],
      [.22,-1.35,.055,-.74,.45],[.31,-1.02,.055,-.79,.22],
      [.43,-.55,.055,-.09,.055],[.49,-.32,.055,-.38,.22],
      [.55,-.20,.055,.73,.44],[.60,-.14,.055,.69,.50],
      [.67,.08,.055,.48,.055],[1,.08,.055,.48,.055]],t);
    feet=[[ankles[0],ankles[1],-.14],[ankles[2],ankles[3],.14]];
  } else {
    root=runPath(slug,t);
    feet=runningFeet(slug,t);
    // Two compressions per stride, with an opposing arm swing.
    const strideWeight=1-ease((t-contact+.10)/.10);
    root[1]+=.014*Math.cos(t/gaitPeriod(slug)*TAU*2)*strideWeight;
    const headingTime=Math.min(t,contact-.081);
    const before=runPath(slug,Math.max(0,headingTime-.003)),after=runPath(slug,headingTime+.003);
    yaw=Math.atan2(after[2]-before[2],Math.max(.001,after[0]-before[0]))*.65;
    yaw*=1-ease((t-contact+.075)/.075);
    tilt=slug==='messi'||slug==='maradona'?-.18:-.09;
    roll=-.16*Math.sin(t/gaitPeriod(slug)*TAU)*(1-ease((t-contact+.075)/.075));
    if(slug==='r9') {
      const weight=1-ease((t-.43)/.07),at=curve([[0,-.08,.055],[.25,-.08,.055],[.32,.20,.12],[.38,.31,.09],[.43,.16,.055],[1,.16,.055]],t);
      feet[1]=blend(feet[1],[root[0]+at[0],at[1],root[2]+.14],weight);
      feet[0]=blend(feet[0],[root[0]-.18,.055,root[2]-.14],weight);
    }
    if(slug==='ronaldinho') {
      feet=[[root[0]-.13,.055,-.17],[root[0]+.13,.055,.17]];
      const shimmy=ease((t-.12)/.05)*(1-ease((t-.48)/.08));
      yaw=.04*Math.sin((t-.12)*TAU/.18)*shimmy;
      roll=.025*Math.sin((t-.12)*TAU/.18)*shimmy;
      root[1]-=.035*shimmy;tilt=-.06;
    }
    const kick=ease((t-contact+.075)/.075),recover=ease((t-contact)/.13);
    if(t>contact-.075) {
      const end=runPath(slug,contact),side=slug==='messi'||slug==='maradona'?0:1;
      root=blend(root,[end[0],.88*p.height,end[2]],kick);
      const footArc=slug==='ronaldinho'
        ? curve([[0,.13,.055],[.50,.14,.065],[.75,.28,.065],[1,.48,.065]],kick)
        : slug==='r9' ? curve([[0,-.15,.055],[.32,-.29,.13],[.62,.04,.13],[1,.59,.12]],kick)
        : curve([[0,-.15,.055],[.32,-.38,.23],[.62,-.05,.30],[1,.61,.18]],kick);
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
  // Use the rendered limb reach for contact targets too: the ball must meet
  // the boot that is visible, rather than an unreachable IK target.
  feet.forEach((foot,i)=>{
    const hip=localPoint(root,axes,[0,-.025*s,(i?1:-1)*.12*s]);
    const delta=foot.map((v,j)=>v-hip[j]),length=Math.hypot(...delta);
    if(length>.94*s)feet[i]=hip.map((v,j)=>v+delta[j]*.94*s/length);
  });
  return {root,feet,hands,axes,yaw,tilt,roll,bootPitch,height:s,build:p.build};
}

export function sampleIconMotion(slug, time, aspect = 1.6) {
  if(!ICON_PROFILES[slug])slug='messi';
  const progress=clamp(time),t=iconActionTime(slug,progress),p=ICON_PROFILES[slug],contact=p.contact,netTime=contact+.105;
  const pose=actionPose(slug,Math.min(t,.72));
  const shot=actionPose(slug,contact),kicking=slug==='messi'||slug==='maradona'?0:1;
  const pitch=shot.bootPitch[kicking];
  const bootAxes=bodyAxes(shot.yaw,pitch);
  const strike=shot.feet[kicking].map((v,i)=>v+.16*bootAxes[0][i]+(i===1?.07:0));
  let ball;
  if(t<contact) {
    if(slug==='cristiano') {
      const u=t/contact;
      // A cross keeps moving through contact instead of easing to a halt.
      ball=blend(slug==='cristiano'?[1.5,2.9,-1.2]:[-2.2,2.1,.15],strike,u);
      ball[1]+=.35*4*u*(1-u);
    } else if(slug==='pele') {
      const chest=[-1.04,1.40,.05],flick=[-.59,.57,.14];
      if(t<.12)ball=blend([-1.8,2.25,-.55],chest,t/.12);
      else if(t<.22)ball=blend(chest,flick,ease((t-.12)/.10));
      else {const u=(t-.22)/(contact-.22);ball=blend(flick,strike,u);ball[1]+=1.25*4*u*(1-u);}
    } else if(slug==='neymar'&&t>.16&&t<.32) {
      // Borges receives the one-two; the return meets Neymar's next stride.
      const a=dribbleBall(slug,.16),b=[-.82,.12,1.30],c=dribbleBall(slug,.32);
      ball=t<.23?blend(a,b,(t-.16)/.07):blend(b,c,(t-.23)/.09);
    } else if(slug==='r9'&&t<.40) {
      const receive=actionPose(slug,.32).feet[1],touch=[receive[0]+.14,.12,receive[2]];
      ball=t<.32?blend([-1.9,.12,1.5],touch,ease(t/.32))
        :blend(touch,dribbleBall(slug,t),ease((t-.32)/.08));
    } else if(slug==='ronaldinho') {
      ball=[-.65,.12,.13];
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
    pose.yaw=lerp(pose.yaw,1.35,celebration);pose.tilt*=1-celebration;pose.roll*=1-celebration;
    let jump=0;
    if(slug==='cristiano')jump=.43*Math.pow(Math.sin(clamp((age-.10)/.53)*Math.PI),2);
    if(slug==='pele')jump=.32*Math.pow(Math.sin(clamp(age/.65)*Math.PI),2);
    const landing=slug==='cristiano'?.14*Math.pow(Math.sin(clamp((age-.63)/.24)*Math.PI),2):0;
    pose.root[1]+=jump-landing;pose.axes=bodyAxes(pose.yaw,pose.tilt,pose.roll);
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
  if(slug==='cristiano')pose.knees=solveIconKnees(pose);
  // Independent spine and neck: the hips carry the gait while the shoulders
  // counter-rotate and the eyes keep following the ball. No rigid whole-body sway.
  const stride=Math.sin(t/gaitPeriod(slug)*TAU),running=slug!=='cristiano'&&slug!=='pele'&&slug!=='ronaldinho';
  const runWeight=running?(1-ease((t-contact+.10)/.10))*(1-celebration):0;
  const coil=ease((t-contact+.10)/.10)*(1-ease((t-contact)/.16))*(1-celebration);
  const footSign=slug==='messi'||slug==='maradona'?-1:1;
  let spineYaw=-.14*stride*runWeight+footSign*.23*Math.sin((t-contact)*Math.PI/.16)*coil;
  let spineTilt=-.045*runWeight,spineRoll=-pose.roll*.65*runWeight;
  if(slug==='ronaldinho') {
    const feint=ease((t-.12)/.05)*(1-ease((t-.48)/.08));
    spineYaw+=.22*Math.sin((t-.12)*TAU/.18)*feint;
    spineRoll+=.12*Math.sin((t-.12)*TAU/.18)*feint;
  }
  if(slug==='cristiano')spineTilt=curve([[0,0],[.345,-.10],[.405,.10],[.44,.16],[.485,-.12],[.555,-.15],[.68,0],[1,0]],t)[0]*(1-celebration);
  if(slug==='pele')spineTilt+=.12*Math.exp(-Math.pow((t-.12)/.06,2))-.10*Math.exp(-Math.pow((t-.49)/.05,2));
  pose.spine=[spineYaw,spineTilt,spineRoll];
  const gaze=localPoint(pose.root,pose.axes,[.02,.73*pose.height,0]);
  const toBall=ball.map((v,i)=>v-gaze[i]);
  const local=pose.axes.map(axis=>axis.reduce((sum,v,i)=>sum+v*toBall[i],0));
  pose.head=[clamp(Math.atan2(local[2],Math.max(.12,local[0]))-spineYaw,-.55,.55)*(1-celebration),
    clamp(Math.atan2(local[1],Math.hypot(local[0],local[2]))-spineTilt,-.32,.40)*(1-celebration)];
  // One continuous camera move: close during the skill, wider to see the finish.
  const follow=ease((t-contact)/.16)*(1-ease((t-.75)/.10));
  const aerial=slug==='cristiano'||slug==='pele';
  // Pull back to include the landing and the goal together. Chasing the ball
  // itself used to whip the camera away and crop the player's recovery.
  const wide=ease((aspect-1.1)/.5);
  const target=[pose.root[0]+.25+lerp(.9,2.4,wide)*follow,aerial?1.35:1.05,pose.root[2]];
  const distance=lerp(aerial?6.1:5.2,lerp(7.5,10.4,wide),follow),orbit=lerp(-.26,.16,ease(t));
  const camera={target,eye:[target[0]+Math.sin(orbit)*distance,aerial?2.85:2.5,Math.cos(orbit)*distance]};
  const obstacles={messi:[-1.95,-1.30,-.12,.70],maradona:[-2.75,-2.35,-1.25,-.35,.72],
    neymar:[-1.72,.48],r9:[1.9],ronaldinho:[-.25,.70],pele:[-.34]};
  const defenders=(obstacles[slug]||[]).map((x,i)=>{
      const reaction=Math.exp(-Math.pow((pose.root[0]-x)*2.5,2));
      return {x:x-reaction*.22,z:slug==='pele'?-.05:-.60+(i%2)*.65,reaction};
    });
  return {slug,t,progress,pose,ball,camera,defenders,contact,netTime,celebration,profile:p,
    phase:t<(aerial?.30:.10)?'THE APPROACH':t<contact+.035?'SIGNATURE MOVE':t<.75?'THE FINISH':'THE CELEBRATION'};
}
