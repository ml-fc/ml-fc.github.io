import { sampleIconMotion, bodyAxes, localPoint, ease } from './icon_motion.js';
// Native WebGL, reusable meshes and deterministic choreography. No remote assets.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
function matrix(center,scale,axes=[[1,0,0],[0,1,0],[0,0,1]]){
  return [...axes[0].map(v=>v*scale[0]),0,...axes[1].map(v=>v*scale[1]),0,...axes[2].map(v=>v*scale[2]),0,...center,1];
}
function perspective(aspect){const f=1/Math.tan(.56/2),near=.1,far=70;return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];}
function lookAt(eye,target){const z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
function sphere(lat=14,lon=20){const out=[];const point=(i,j)=>{const a=i*Math.PI/lat,b=j*2*Math.PI/lon;return [Math.sin(a)*Math.cos(b),Math.cos(a),Math.sin(a)*Math.sin(b)];};for(let i=0;i<lat;i++)for(let j=0;j<lon;j++){for(const [a,b] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]]){const p=point(a,b);out.push(...p,...p);}}return out;}
function plane(){return [-1,0,-1,0,1,0,1,0,-1,0,1,0,-1,0,1,0,1,0,-1,0,1,0,1,0,1,0,-1,0,1,0,1,0,1,0,1,0];}
function loft(rings) {
  const vertices=[],segments=24;
  function point(i,j){const [y,x,z]=rings[i],a=j*Math.PI*2/segments;return [Math.cos(a)*x,y,Math.sin(a)*z];}
  function normal(i,j){const a=point(i,j),b=point(i,j+1),c=point(Math.min(i+1,rings.length-1),j),d=point(Math.max(0,i-1),j);return norm(cross(sub(c,d),sub(b,a)));}
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<segments;j++)for(const [r,s] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]])vertices.push(...point(r,s),...normal(r,s));
  return vertices;
}
const VERTEX=`attribute vec3 position,normal;uniform mat4 model,view,projection;uniform mat3 normals;varying vec3 world,n,local;void main(){vec4 p=model*vec4(position,1.);world=p.xyz;n=normalize(normals*normal);local=position;gl_Position=projection*view*p;}`;
const FRAGMENT=`precision mediump float;varying vec3 world,n,local;uniform vec3 color,eye,secondary;uniform float material,alpha,stripes;uniform sampler2D shirtNumber;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec3 base=color;float a=alpha;vec3 normal=normalize(n);
if(material==1.){float stripe=smoothstep(.48,.52,fract(world.x*.18));base*=.91+.09*stripe;float grain=hash(floor(world.xz*95.));base*=.97+.06*grain;float line=min(abs(world.z-3.5),abs(world.z+3.5));if(line<.025||abs(world.x-4.9)<.025&&abs(world.z)<3.5)base=mix(base,vec3(.78,.85,.76),.75);}
if(material==2.){vec3 p=normalize(local);float k=.525731,l=.850651;float d=max(max(abs(p.x*k+p.y*l),abs(p.x*k-p.y*l)),max(max(abs(p.y*k+p.z*l),abs(p.y*k-p.z*l)),max(abs(p.z*k+p.x*l),abs(p.z*k-p.x*l))));base=d>.94?vec3(.035,.055,.075):vec3(.93,.95,.9);if(d>.93&&d<.94)base*=.6;}
if(material==3.){a*=exp(-3.6*dot(local.xz,local.xz));gl_FragColor=vec4(color,a);return;}
if(material==4.){vec2 cell=fract(world.xy*vec2(4.5,7.));float head=1.-smoothstep(.16,.22,length((cell-vec2(.5,.6))*vec2(1.,1.3)));float row=smoothstep(.86,.92,cell.y);base=mix(vec3(.045,.075,.11),vec3(.14,.20,.24),head);base+=vec3(row*.025);}
if(material==6.){vec4 ink=texture2D(shirtNumber,local.xz*.5+.5);base=ink.rgb;a*=ink.a;if(a<.05)discard;}
if(material==7.){if(stripes>0.5){float stripe=smoothstep(.47,.53,fract((local.z+.27)*stripes));base=mix(base,secondary,stripe);}base*=.96+.04*sin(local.y*105.+local.z*19.);}
if(material==8.){gl_FragColor=vec4(color,a);return;}
float diffuse=max(0.,dot(normal,normalize(vec3(-.4,1.,.7))));float fill=max(0.,dot(normal,normalize(vec3(.8,.35,-.5))));float rim=pow(1.-max(0.,dot(normal,normalize(eye-world))),3.);float spec=pow(max(0.,dot(normal,normalize(normalize(vec3(-.4,1.,.7))+normalize(eye-world)))),45.);
vec3 light=base*(.38+.57*diffuse+.19*fill)+vec3(.27,.37,.46)*rim*.21+vec3(spec*.065);light=pow(light,vec3(.92));float fog=clamp((length(eye-world)-9.)/28.,0.,.8);gl_FragColor=vec4(mix(light,vec3(.035,.07,.105),fog),a);}`;

export function createIconScene(canvas){
  let gl;
  try{gl=canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'low-power'});}catch{return null;}
  if(!gl)return null;
  const resources=[];
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('Icon shader compilation failed');}resources.push(['Shader',s]);return s;}
  let program;
  try{program=gl.createProgram();resources.push(['Program',program]);gl.attachShader(program,shader(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Icon shader link failed');}
  catch{resources.forEach(([type,res])=>gl[`delete${type}`](res));return null;}
  gl.useProgram(program);
  const uniforms=Object.fromEntries(['model','view','projection','normals','color','eye','material','alpha','shirtNumber','secondary','stripes'].map(key=>[key,gl.getUniformLocation(program,key)]));
  const pos=gl.getAttribLocation(program,'position'),normal=gl.getAttribLocation(program,'normal');
  function mesh(data){const buffer=gl.createBuffer();resources.push(['Buffer',buffer]);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return {buffer,count:data.length/6};}
  const orb=mesh(sphere()),rod=mesh(sphere(4,6)),floor=mesh(plane());
  const jersey=mesh(loft([[-.045,.07,.11],[0,.135,.18],[.15,.14,.18],[.33,.145,.22],[.46,.115,.25],[.52,.08,.17],[.55,.06,.065]]));
  const face=mesh(loft([[-.135,.025,.025],[-.11,.07,.065],[-.055,.103,.091],[.025,.11,.096],[.095,.09,.082],[.14,.025,.022]]));
  const shoe=mesh(loft([[-.13,.025,.025],[-.095,.055,.040],[.045,.060,.035],[.125,.040,.022],[.15,.012,.012]]));
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(.028,.047,.075,1);
  const numberCanvas=document.createElement('canvas');numberCanvas.width=256;numberCanvas.height=256;
  const numberContext=numberCanvas.getContext('2d');
  const numberTexture=gl.createTexture();resources.push(['Texture',numberTexture]);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,numberTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.uniform1i(uniforms.shirtNumber,0);
  let numberSlug;
  let currentMesh;
  function draw(shape,model,color,material=0,alpha=1){
    if(currentMesh!==shape){gl.bindBuffer(gl.ARRAY_BUFFER,shape.buffer);gl.vertexAttribPointer(pos,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,24,12);gl.enableVertexAttribArray(pos);gl.enableVertexAttribArray(normal);currentMesh=shape;}
    // Inverse-transpose of orthogonal scaled axes keeps ellipsoid lighting correct.
    const normals=[];for(let j=0;j<3;j++){const axis=model.slice(j*4,j*4+3),d=dot(axis,axis)||1;normals.push(...axis.map(v=>v/d));}
    gl.uniformMatrix4fv(uniforms.model,false,model);gl.uniformMatrix3fv(uniforms.normals,false,normals);gl.uniform3fv(uniforms.color,color);gl.uniform1f(uniforms.material,material);gl.uniform1f(uniforms.alpha,alpha);gl.drawArrays(gl.TRIANGLES,0,shape.count);
  }
  const ellipsoid=(center,scale,color,axes)=>draw(orb,matrix(center,scale,axes),color);
  function bone(a,b,width,color,depth=width){const delta=sub(b,a),y=norm(delta),x=norm(cross(Math.abs(y[2])>.9?[1,0,0]:[0,0,1],y)),z=cross(x,y);draw(width<.04?rod:orb,matrix(a.map((v,i)=>(v+b[i])/2),[width,Math.hypot(...delta)/2+width*.24,depth],[x,y,z]),color);}
  function shadow(x,z,scale,opacity){gl.depthMask(false);draw(floor,matrix([x,.008,z],[scale,1,scale*.65]),[.005,.014,.02],3,opacity);gl.depthMask(true);}
  let aspect=1.6,lastFrame;
  function resize(){const width=canvas.clientWidth||600,height=canvas.clientHeight||375,dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);aspect=width/height;if(lastFrame)render(lastFrame);}
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  let disposed=false,lost=false;
  const onLoss=event=>{event.preventDefault();lost=true;canvas.hidden=true;canvas.dispatchEvent(new Event('iconcontextlost'));};
  canvas.addEventListener('webglcontextlost',onLoss);
  function render(state){
    if(disposed||lost)return;lastFrame=state;
    const {t,look,slug}=state;
    const motion=sampleIconMotion(slug,t),{pose,ball,profile}=motion;
    if(numberSlug!==slug && numberContext){
      numberContext.clearRect(0,0,256,256);numberContext.fillStyle='#fff6d9';numberContext.textAlign='center';numberContext.textBaseline='middle';
      numberContext.font='700 19px Arial';numberContext.fillText(profile.name,128,35);
      numberContext.font='900 170px Arial';numberContext.fillText(look[3],128,151);
      gl.bindTexture(gl.TEXTURE_2D,numberTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,numberCanvas);numberSlug=slug;
    }
    gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);currentMesh=null;
    const {target,eye}=motion.camera;
    gl.uniformMatrix4fv(uniforms.projection,false,perspective(aspect));gl.uniformMatrix4fv(uniforms.view,false,lookAt(eye,target));gl.uniform3fv(uniforms.eye,eye);
    draw(floor,matrix([0,-.014,0],[24,1,24]),[.045,.215,.13],1);
    const vertical=[[1,0,0],[0,0,1],[0,1,0]];
    draw(floor,matrix([0,2.3,-8],[18,1,2.4],vertical),[.15,.18,.22],4);
    draw(floor,matrix([0,.35,-5.8],[18,1,.22],vertical),[.025,.045,.067]);
    for(const x of [-7,0,7]) {
      bone([x,0,-7],[x,4.8,-7],.025,[.17,.22,.27]);
      for(let i=0;i<5;i++)draw(orb,matrix([x+(i-2)*.15,4.8,-6.97],[.055,.035,.035]),[.92,.96,1],8);
    }
    const post=[.8,.85,.83],net=[.23,.33,.34],goal=4.9;
    bone([goal,0,-1.4],[goal,2.1,-1.4],.033,post);bone([goal,0,1.4],[goal,2.1,1.4],.033,post);bone([goal,2.1,-1.4],[goal,2.1,1.4],.033,post);
    const netAge=Math.max(0,(t-motion.netTime)*9),ripple=Math.sin(netAge*22)*Math.exp(-netAge*5)*.13;
    for(let z=-1.4;z<=1.41;z+=.20)bone([goal+.62,0,z],[goal+.62+ripple,2.1,z],.005,net);
    for(let y=0;y<=2.11;y+=.175){bone([goal+.62,y,-1.4],[goal+.62+ripple,y,1.4],.005,net);bone([goal,y,-1.4],[goal+.62,y,-1.4],.005,net);}
    bone([goal,2.1,-1.4],[goal+.62,2.1,-1.4],.015,post);bone([goal,2.1,1.4],[goal+.62,2.1,1.4],.015,post);
    const colors=look.slice(0,3).map(rgb);
    function joint(start,end,pole,lengthA,lengthB) {
      const delta=sub(end,start),distance=clamp(Math.hypot(...delta),.025,lengthA+lengthB-.001),direction=norm(delta);
      const along=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
      const perpendicular=norm(sub(pole,direction.map(v=>v*dot(pole,direction))));
      return add(start,add(direction.map(v=>v*along),perpendicular.map(v=>v*Math.sqrt(Math.max(0,lengthA*lengthA-along*along)))));
    }
    function person(rig,palette,featured=false) {
      const {root:center,axes,feet:footTargets,hands,height:size=1,build=1}=rig;
      const [kit,shorts,skin]=palette,transform=p=>localPoint(center,axes,p.map(v=>v*size));
      const body=(p,s,c)=>ellipsoid(transform(p),s,c,axes);
      gl.uniform3fv(uniforms.secondary,slug==='maradona'&&featured?[.93,.94,.92]:shorts);
      gl.uniform1f(uniforms.stripes,featured&&['messi','maradona','ronaldinho'].includes(slug)?7:0);
      draw(jersey,matrix(center,[size*build,size,size*build],axes),kit,7);
      body([0,-.03,0],[.15*build,.125,.19*build],shorts);
      body([.01,.56,0],[.065,.077,.064],skin);
      draw(face,matrix(transform([.016,.745,0]),[size,size,size],axes),skin);
      body([.122,.73,0],[.035,.033,.031],skin);body([-.014,.735,.100],[.024,.037,.018],skin);
      const hair=slug==='neymar'&&featured?[.65,.59,.4]:[.022,.018,.019];
      body([.005,.84,0],[.104,featured&&slug==='r9'?.022:.048,.091],hair);
      body([.099,.772,.057],[.009,.011,.013],[.018,.02,.022]);
      bone(transform([.08,.792,.045]),transform([.107,.79,.067]),.008,hair);
      if(featured&&(slug==='ronaldinho'||slug==='maradona'||slug==='messi'))body([-.083,.765,0],[.046,.115,.101],hair);
      if(featured&&slug==='maradona')for(let i=0;i<7;i++)body([Math.cos(i)*.075,.83+Math.sin(i)*.018,Math.sin(i)*.074],[.042,.034,.041],hair);
      if(featured&&slug==='ronaldinho'){body([-.12,.60,0],[.041,.13,.07],hair);body([.008,.817,0],[.108,.014,.094],[.02,.025,.03]);}
      body([.045,.52,0],[.07,.021,.080],shorts);
      if(featured)draw(floor,matrix(transform([-.147,.29,0]),[.16,1,.19],[axes[2],axes[0],axes[1]]),[1,1,1],6);
      for(let i=0;i<2;i++){
        const side=i?1:-1,hip=transform([0,-.025,side*.12]);
        const delta=sub(footTargets[i],hip),reach=Math.min(.94*size,Math.hypot(...delta));
        const foot=add(hip,norm(delta).map(v=>v*reach));
        const knee=joint(hip,foot,axes[0],.47*size,.48*size);
        bone(hip,knee,.078*build,skin);bone(hip,hip.map((v,j)=>mix(v,knee[j],.52)),.093*build,shorts);
        bone(knee,foot,.052,skin);bone(knee.map((v,j)=>mix(v,foot[j],.28)),foot,.055,kit);
        const bootAxes=bodyAxes(rig.yaw||0,rig.bootPitch?.[i]||0),boot=add(foot,bootAxes[0].map(v=>v*.085));
        draw(shoe,matrix(boot,[1,1,1],[bootAxes[2],bootAxes[0],bootAxes[1]]),featured?(slug==='messi'?[.85,.38,.12]:[.78,.83,.70]):[.17,.23,.28]);
        for(const offset of [-.045,.06])for(const side of [-1,1]) {
          const stud=add(boot,add(bootAxes[0].map(v=>v*offset),[0,-.033,side*.035]));
          ellipsoid(stud,[.013,.018,.013],[.10,.14,.19]);
        }
        const a=transform([0,.44,side*.22]),hand=hands[i],direction=sub(hand,a);
        const end=add(a,norm(direction).map(v=>v*Math.min(.60*size,Math.hypot(...direction))));
        const elbow=joint(a,end,add(axes[0].map(v=>-v),axes[2].map(v=>v*side*.6)),.30*size,.30*size);
        bone(a,elbow,.052,skin);bone(a,a.map((v,j)=>mix(v,elbow[j],.56)),.072,kit);
        bone(elbow,end,.039,skin);ellipsoid(end,[.035,.056,.025],skin,axes);
        if(featured&&motion.celebration>.5&&(slug==='messi'||slug==='ronaldinho')) {
          bone(end,add(end,[0,.10,0]),.012,skin);
          if(slug==='ronaldinho')bone(end,add(end,axes[2].map(v=>v*side*.085)),.012,skin);
        }
      }
    }
    function opponent(x,z,reaction,keeper=false) {
      const root=[x,.91-reaction*.12,z],axes=bodyAxes(keeper?Math.PI:.4,-reaction*.08);
      shadow(x,z,.45,.40);
      person({root,axes,yaw:.4,feet:[[x-.20,.055,z-.16-reaction*.2],[x+.18,.055,z+.17]],
        hands:[localPoint(root,axes,[.15,.16,-.37]),localPoint(root,axes,[.17,.23,.37])]},
      [keeper?[.83,.39,.17]:[.32,.41,.50],[.08,.13,.20],[.49,.34,.24]]);
    }
    for(const defender of motion.defenders)opponent(defender.x,defender.z,defender.reaction);
    opponent(4.65,-.45-ease((t-motion.contact)/.18)*.64,ease((t-motion.contact)/.12),true);
    shadow(pose.root[0],pose.root[2],.47+Math.max(0,pose.root[1]-1)*.12,.50/(1+Math.max(0,pose.root[1]-1)));
    for(const foot of pose.feet)shadow(foot[0],foot[2],.17,.25/(1+foot[1]*4));
    person(pose,colors,true);
    shadow(ball[0],ball[2],.13,.4/(1+ball[1]));
    const spin=t*32,ballAxes=[[Math.cos(spin),Math.sin(spin),0],[-Math.sin(spin),Math.cos(spin),0],[0,0,1]];
    draw(orb,matrix(ball,[.115,.115,.115],ballAxes),[1,1,1],2);
    if(motion.celebration>0) {
      const age=(t-.75)*9;
      for(let i=0;i<22;i++) {
        const x=pose.root[0]+Math.sin(i*4.1)*1.7+Math.sin(age*2+i)*.13,y=3.2-((age*.65+i*.12)%3.3),z=Math.cos(i*2.7)*1.1;
        draw(floor,matrix([x,y,z],[.017,1,.033],bodyAxes(age*3+i,.8)),i%3===0?[.94,.82,.52]:i%3===1?colors[0]:[.85,.90,.94],8,.85);
      }
    }
  }
  resize();
  return {render,dispose(){disposed=true;observer.disconnect();canvas.removeEventListener('webglcontextlost',onLoss);resources.forEach(([type,res])=>gl[`delete${type}`](res));lastFrame=null;gl.getExtension("WEBGL_lose_context")?.loseContext();},};
}
