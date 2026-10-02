// Lightweight, original SVG tributes. Coordinates are interpolated on one finite clock.
export function createIconMove(host) {
  host.innerHTML = `<svg viewBox="0 0 360 190" role="img" aria-label="Animated signature football move">
    <defs><pattern id="iconNet" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#ffffff35"/></pattern></defs>
    <path d="M0 160H360M0 185H360" stroke="#ffffff30"/><ellipse cx="180" cy="165" rx="155" ry="18" fill="#ffffff08"/>
    <path d="M306 160V64H352V160Z" fill="url(#iconNet)" stroke="#ffffff80" stroke-width="3"/>
    <g data-defenders fill="#718398" opacity=".65"><path d="M152 105h17l5 31h-27zM224 112h17l5 31h-27z"/><circle cx="160" cy="95" r="8"/><circle cx="232" cy="102" r="8"/><path d="M152 137l-6 24m20-24 6 24m52-24-6 24m20-24 6 24" stroke="#718398" stroke-width="7"/></g>
    <path data-trail fill="none" stroke="var(--celebration-accent)" stroke-width="2" opacity=".45" stroke-dasharray="4 5"/>
    <ellipse data-shadow cy="163" rx="24" ry="5" fill="#0008"/>
    <g data-player><g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path data-arm-a stroke="#e6b488" stroke-width="7"/><path data-arm-b stroke="#e6b488" stroke-width="7"/>
      <path data-leg-a stroke="var(--celebration-accent)" stroke-width="9"/><path data-leg-b stroke="var(--celebration-accent)" stroke-width="9"/>
      <path data-boot-a stroke="#fff" stroke-width="6"/><path data-boot-b stroke="#fff" stroke-width="6"/>
      </g><path d="M-13-53Q0-59 13-53L17-25H-17Z" fill="var(--celebration-secondary)" stroke="var(--celebration-accent)" stroke-width="2"/>
      <path d="M-17-25H17L15-12H2L0-19-2-12H-15Z" fill="#111c30"/>
      <circle cy="-67" r="10" fill="#e6b488"/><path d="M-10-68Q-11-81 2-78Q12-78 10-68L5-72-8-70" fill="#17151c"/>
      <text data-number y="-34" text-anchor="middle" fill="#fff" font-size="16" font-family="Arial" font-weight="900"></text>
    </g><g data-ball><circle r="7" fill="#fff" stroke="#172439" stroke-width="1.5"/><path d="M0-4 4-1 2 4H-2L-4-1Z" fill="#172439"/></g>
    <text data-goal x="180" y="40" text-anchor="middle" fill="var(--celebration-accent)" font-size="30" font-family="Arial" font-weight="900" opacity="0">GOLAÇO!</text>
  </svg>`;
  const get = name => host.querySelector(`[data-${name}]`);
  let frame = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Each key: time, player x/y, body rotation, left/right foot x/y, ball x/y.
  const moves = {
    cristiano: [[0,135,149,0,-13,0,16,0,220,45],[.23,156,116,-35,-26,-6,23,-28,190,36],[.42,168,94,-105,-28,0,16,-48,188,27],[.5,177,109,-145,-23,-18,26,-30,224,38],[.7,183,145,-70,-22,-10,20,-8,335,92],[1,190,151,0,-22,0,22,0,338,150]],
    messi: [[0,62,150,12,-13,0,18,-5,86,153],[.2,110,147,-12,20,-6,-13,0,126,144],[.36,143,152,17,-18,0,19,-5,172,158],[.52,188,144,-16,20,-3,-15,0,208,137],[.67,240,151,12,-14,0,26,-10,266,155],[.8,259,151,-15,-15,0,31,-25,335,113],[1,268,149,0,-18,0,18,0,339,150]],
    neymar: [[0,110,150,0,-10,0,10,0,112,155],[.25,120,148,-10,-16,-8,4,-22,111,130],[.48,141,139,13,-20,-5,15,-10,147,35],[.68,174,150,10,-15,0,22,-5,199,118],[.82,212,149,-15,-17,0,32,-20,331,104],[1,220,150,0,-20,0,20,0,336,150]],
    r9: [[0,75,150,8,-15,0,20,-5,105,154],[.2,105,150,-12,28,0,-10,-8,126,152],[.34,128,150,17,-20,-8,30,0,153,155],[.48,155,148,-15,28,0,-14,-9,179,148],[.65,235,145,18,-24,-6,28,-8,265,152],[.8,260,151,-16,-15,0,33,-22,337,116],[1,266,151,0,-22,0,22,0,338,150]],
    maradona: [[0,52,151,15,-14,0,16,-3,75,155],[.18,102,141,-18,24,-5,-12,0,120,132],[.35,142,152,20,-18,0,22,-5,167,158],[.51,187,140,-20,24,-4,-13,0,205,129],[.67,239,152,18,-17,0,25,-3,264,157],[.81,260,148,-18,32,-20,-16,0,337,112],[1,267,150,0,-18,0,18,0,339,150]],
    ronaldinho: [[0,130,150,0,-17,0,18,0,156,154],[.3,141,150,-12,-15,0,38,-3,187,149],[.43,146,150,18,-16,0,4,-6,150,147],[.6,198,148,15,-23,-4,23,-7,227,153],[.78,246,150,-18,-17,0,34,-23,335,97],[1,251,150,0,-22,0,22,0,339,150]],
    pele: [[0,160,150,0,-16,0,16,0,90,30],[.3,170,125,-15,-20,-5,18,-12,167,80],[.48,185,115,-32,-18,12,44,-23,227,86],[.69,197,147,-12,-18,-3,22,-9,336,105],[1,203,151,0,-22,0,22,0,339,150]],
  };
  function stop() { cancelAnimationFrame(frame); }
  function play(slug) {
    stop();
    const keys = moves[slug] || moves.messi;
    get('number').textContent = slug === 'cristiano' ? '7' : slug === 'r9' ? '9' : '10';
    get('defenders').style.display = ['messi','maradona','r9','ronaldinho'].includes(slug) ? '' : 'none';
    const trail=[];
    function draw(t) {
      let idx=keys.findIndex(k=>k[0]>=t); if(idx<1) idx=1;
      const a=keys[idx-1], b=keys[idx], u=Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0])));
      const p=a.map((v,i)=>v+(b[i]-v)*u);
      const [,x,y,angle,lx,ly,rx,ry,bx,by]=p;
      get('player').setAttribute('transform',`translate(${x} ${y}) rotate(${angle})`);
      get('shadow').setAttribute('cx',x);
      get('shadow').setAttribute('opacity',Math.max(.2,y/160));
      for(const [side,fx,fy] of [['a',lx,ly],['b',rx,ry]]) {
        get(`leg-${side}`).setAttribute('d',`M${side==='a'?-8:8} -15 Q${fx*.6} ${fy-14} ${fx} ${fy}`);
        get(`boot-${side}`).setAttribute('d',`M${fx} ${fy}h7`);
      }
      const cheer=t>.85;
      get('arm-a').setAttribute('d',cheer?'M-12-50-26-62-33-78':`M-12-50-25-36-32-${35+Math.sin(t*25)*8}`);
      get('arm-b').setAttribute('d',cheer?'M12-50 26-62 33-78':`M12-50 24-39 31-${48+Math.sin(t*25)*8}`);
      get('ball').setAttribute('transform',`translate(${bx} ${by}) rotate(${t*850})`);
      trail.push([bx,by]); if(trail.length>18)trail.shift();
      get('trail').setAttribute('d',trail.map(([tx,ty],i)=>`${i?'L':'M'}${tx} ${ty}`).join(' '));
      get('goal').setAttribute('opacity',t>.8?Math.min(1,(t-.8)*10):0);
    }
    if(reduced.matches){draw(.48);return;}
    const start=performance.now();
    function tick(now){const t=Math.min(1,(now-start)/4800);draw(t);if(t<1)frame=requestAnimationFrame(tick);}
    frame=requestAnimationFrame(tick);
  }
  return {play,stop};
}
