// Small native WebGL renderer. Shared meshes, no framework, capped backing resolution.
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
function perspective(aspect){const f=1/Math.tan(.55/2),near=.1,far=70;return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];}
function lookAt(eye,target){const z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
function sphere(lat=14,lon=20){const out=[];const point=(i,j)=>{const a=i*Math.PI/lat,b=j*2*Math.PI/lon;return [Math.sin(a)*Math.cos(b),Math.cos(a),Math.sin(a)*Math.sin(b)];};for(let i=0;i<lat;i++)for(let j=0;j<lon;j++){for(const [a,b] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]]){const p=point(a,b);out.push(...p,...p);}}return out;}
function plane(){return [-1,0,-1,0,1,0,1,0,-1,0,1,0,-1,0,1,0,1,0,-1,0,1,0,1,0,1,0,-1,0,1,0,1,0,1,0,1,0];}
const VERTEX=`attribute vec3 position,normal;uniform mat4 model,view,projection;uniform mat3 normals;varying vec3 world,n,local;void main(){vec4 p=model*vec4(position,1.);world=p.xyz;n=normalize(normals*normal);local=position;gl_Position=projection*view*p;}`;
const FRAGMENT=`precision mediump float;varying vec3 world,n,local;uniform vec3 color,eye;uniform float material,alpha;uniform sampler2D shirtNumber;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec3 base=color;float a=alpha;vec3 normal=normalize(n);
if(material==1.){float stripe=step(.5,fract(world.x*.23));base*=.85+.15*stripe;float grain=hash(floor(world.xz*135.));base*=.88+.22*grain;float line=min(abs(world.z-2.8),abs(world.z+2.8));if(line<.027||abs(world.x-4.8)<.028&&abs(world.z)<2.8)base=mix(base,vec3(.78,.85,.76),.75);}
if(material==2.){vec3 p=normalize(local);float k=.525731,l=.850651;float d=max(max(abs(p.x*k+p.y*l),abs(p.x*k-p.y*l)),max(max(abs(p.y*k+p.z*l),abs(p.y*k-p.z*l)),max(abs(p.z*k+p.x*l),abs(p.z*k-p.x*l))));base=d>.94?vec3(.035,.055,.075):vec3(.93,.95,.9);if(d>.93&&d<.94)base*=.6;}
if(material==3.){a*=exp(-3.6*dot(local.xz,local.xz));gl_FragColor=vec4(color,a);return;}
if(material==4.){float grid=hash(floor(world.xy*13.));base=mix(vec3(.055,.08,.12),vec3(.14,.18,.20),step(.84,grid));}
if(material==6.){vec4 ink=texture2D(shirtNumber,local.xz*.5+.5);base=ink.rgb;a*=ink.a;if(a<.05)discard;}
float diffuse=max(0.,dot(normal,normalize(vec3(-.4,1.,.7))));float rim=pow(1.-max(0.,dot(normal,normalize(eye-world))),3.);float spec=pow(max(0.,dot(normal,normalize(normalize(vec3(-.4,1.,.7))+normalize(eye-world)))),35.);
vec3 light=base*(.42+.62*diffuse)+vec3(.25,.34,.4)*rim*.24+vec3(spec*.08);float fog=clamp((length(eye-world)-14.)/30.,0.,.7);gl_FragColor=vec4(mix(light,vec3(.035,.07,.105),fog),a);}`;

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
  const uniforms=Object.fromEntries(['model','view','projection','normals','color','eye','material','alpha','shirtNumber'].map(key=>[key,gl.getUniformLocation(program,key)]));
  const pos=gl.getAttribLocation(program,'position'),normal=gl.getAttribLocation(program,'normal');
  function mesh(data){const buffer=gl.createBuffer();resources.push(['Buffer',buffer]);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return {buffer,count:data.length/6};}
  const orb=mesh(sphere()),rod=mesh(sphere(4,6)),floor=mesh(plane());
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(.028,.047,.075,1);
  const numberCanvas=document.createElement('canvas');numberCanvas.width=128;numberCanvas.height=128;
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
  function resize(){const width=canvas.clientWidth||600,height=canvas.clientHeight||375,dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);aspect=width/height;if(lastFrame)render(lastFrame);}
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  let disposed=false,lost=false;
  const onLoss=event=>{event.preventDefault();lost=true;canvas.hidden=true;canvas.dispatchEvent(new Event('iconcontextlost'));};
  canvas.addEventListener('webglcontextlost',onLoss);
  function render(state){
    if(disposed||lost)return;lastFrame=state;
    const {pose,t,look,slug,contact,strikePose}=state;
    if(numberSlug!==slug && numberContext){
      numberContext.clearRect(0,0,128,128);numberContext.fillStyle='#fff6d9';numberContext.font='900 102px Arial';numberContext.textAlign='center';numberContext.textBaseline='middle';numberContext.fillText(look[3],64,66);
      gl.bindTexture(gl.TEXTURE_2D,numberTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,numberCanvas);numberSlug=slug;
    }

    gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);currentMesh=null;
    let [,sx,sy,angle,lx,ly,rx,ry,bx,by]=pose;
    const px=(sx-300)/75,py=(250-sy)/55+.06,ball=[(bx-300)/75,Math.max(.12,(250-by)/55+.12),.05];
    // Match the flight to the actual 3D boot, including the body rotation at contact.
    const leftFoot=slug==='messi'||slug==='maradona',footIndex=leftFoot?4:6;
    const strikeAngle=-strikePose[3]*Math.PI/180,fx=strikePose[footIndex]/55,fy=-strikePose[footIndex+1]/55;
    const strike=[(strikePose[1]-300)/75+fx*Math.cos(strikeAngle)-fy*Math.sin(strikeAngle)+.10,
      (250-strikePose[2])/55+.06+fx*Math.sin(strikeAngle)+fy*Math.cos(strikeAngle)+.08,leftFoot?-.13:.13];
    if(t>=contact && t<=.76){const u=clamp((t-contact)/(.76-contact));ball[0]=mix(strike[0],4.65,u);ball[1]=mix(strike[1],.23,u)+4*(slug==='cristiano'?.35:.2)*u*(1-u);ball[2]=mix(strike[2],.05,u);}
    else if(t<contact){const u=clamp((t-contact+.045)/.045),blend=u*u*(3-2*u);for(let i=0;i<3;i++)ball[i]=mix(ball[i],strike[i],blend);}
    const finish=clamp((t-.76)/.24),focus=mix(px,ball[0],clamp((t-contact)/.22)*.55),zoomTime=clamp((t-contact+.13)/.3),zoom=1-Math.sin(zoomTime*zoomTime*(3-2*zoomTime)*Math.PI)*.10;
    if(t>.76){ball[0]=4.65-.12*(1-Math.exp(-finish*5));ball[1]=.12+.11*Math.abs(Math.cos(finish*8))*Math.exp(-finish*5);}
    const target=[focus*.55,1.05,0],eye=[target[0]-.6,3.1*zoom,8.5*zoom];
    gl.uniformMatrix4fv(uniforms.projection,false,perspective(aspect));gl.uniformMatrix4fv(uniforms.view,false,lookAt(eye,target));gl.uniform3fv(uniforms.eye,eye);
    draw(floor,matrix([0,-.014,0],[24,1,24]),[.055,.23,.14],1);
    draw(floor,matrix([0,2,-7],[18,1,2],[[1,0,0],[0,0,1],[0,1,0]]),[.15,.18,.22],4);
    const post=[.8,.85,.83],net=[.26,.39,.39],goal=4.15;
    bone([goal,0,-1.3],[goal,2.1,-1.3],.035,post);bone([goal,0,1.3],[goal,2.1,1.3],.035,post);bone([goal,2.1,-1.3],[goal,2.1,1.3],.035,post);
    const ripple=Math.sin(finish*32)*Math.exp(-finish*7)*.1;
    for(let z=-1.3;z<=1.31;z+=.26)bone([goal+.72,0,z],[goal+.72+ripple,2.1,z],.008,net);
    for(let y=0;y<=2.11;y+=.21){bone([goal+.72,y,-1.3],[goal+.72+ripple,y,1.3],.008,net);bone([goal,y,-1.3],[goal+.72,y,-1.3],.008,net);}
    bone([goal,2.1,-1.3],[goal+.72,2.1,-1.3],.015,post);bone([goal,2.1,1.3],[goal+.72,2.1,1.3],.015,post);
    const colors=look.slice(0,3).map(rgb);
    const rot=-angle*Math.PI/180,axes=[[Math.cos(rot),Math.sin(rot),0],[-Math.sin(rot),Math.cos(rot),0],[0,0,1]];
    const origin=[px,py,0],point=([x,y,z])=>add(origin,[x*Math.cos(rot)-y*Math.sin(rot),x*Math.sin(rot)+y*Math.cos(rot),z]);
    function person(center,axes,footTargets,palette,phase,featured){
      const [kit,shorts,skin]=palette,transform=p=>add(center,axes[0].map((v,i)=>v*p[0]+axes[1][i]*p[1]+axes[2][i]*p[2]));
      const body=(p,s,c)=>ellipsoid(transform(p),s,c,axes);
      body([0,.29,0],[.14,.30,.245],kit);body([0,.01,0],[.16,.14,.22],shorts);
      body([.015,.65,0],[.085,.09,.085],skin);body([.02,.82,0],[.115,.15,.11],skin);
      // Profile features, ears, brows and hair give depth without a flat face decal.
      body([.128,.815,0],[.037,.035,.035],skin);body([.0,.82,.113],[.033,.047,.022],skin);
      const hair=slug==='neymar'&&featured?[.65,.59,.4]:[.022,.018,.019];
      body([.008,.924,0],[.12,featured&&slug==='r9'?.025:.062,.112],hair);
      body([.105,.854,.06],[.01,.013,.014],[.018,.02,.022]);
      if(featured&&(slug==='ronaldinho'||slug==='maradona'))body([-.085,.84,0],[.067,.15,.12],hair);
      if(featured&&slug==='ronaldinho'){body([-.12,.67,0],[.045,.13,.07],hair);body([.005,.90,0],[.123,.015,.115],[.02,.025,.03]);}
      // Kit panels and collar follow the volume of the shirt.
      if(featured&&['messi','maradona','ronaldinho'].includes(slug))for(const z of [-.14,0,.14])body([.13,.30,z],[.018,.235,.025],shorts);
      body([.10,.57,0],[.044,.025,.10],shorts);
      if(featured)draw(floor,matrix(transform([.005,.30,.247]),[.12,1,.13],[axes[0],axes[2].map(v=>-v),axes[1]]),[1,1,1],6);

      const armBlend=clamp(phase*6),stride=Math.sin(t*54)*.16*(1-armBlend);
      for(let i=0;i<2;i++){
        const side=i?1:-1,hip=transform([0,-.035,side*.13]),foot=footTargets[i];
        const d=sub(foot,hip),distance=Math.min(.90,Math.hypot(...d)),mid=hip.map((v,j)=>(v+foot[j])/2),bend=Math.sqrt(Math.max(.005,.47*.47-distance*distance/4));
        const knee=add(mid,axes[0].map(v=>v*bend));
        bone(hip,knee,.079,skin);bone(hip,hip.map((v,j)=>mix(v,knee[j],.38)),.09,shorts);
        bone(knee,foot,.053,skin);bone(knee.map((v,j)=>mix(v,foot[j],.32)),foot,.054,kit);
        const boot=add(foot,axes[0].map(v=>v*.07));ellipsoid(boot,[.13,.055,.065],[.83,.87,.73],axes);
        const shoulder=[0,.50,side*.225];let elbow=[stride*side,.27,side*.30],hand=[stride*side+.13,.05,side*.32];
        if(featured){
          const celebration=slug==='messi'?[[.03,.76,side*.30],[.03,1.05,side*.33]]:slug==='cristiano'?[[.02,.27,side*.43],[.03,.12,side*.63]]:slug==='pele'&&i?[[.0,.78,side*.30],[.01,1.05,side*.35]]:slug==='neymar'?[[.06,.64,side*.31],[.17,.86,side*.22]]:slug==='ronaldinho'?[[.10,.35,side*.36],[.25,.50,side*.43]]:[[.02,.44,side*.47],[.05,.42,side*.70]];
          elbow=elbow.map((v,j)=>mix(v,celebration[0][j],armBlend));hand=hand.map((v,j)=>mix(v,celebration[1][j],armBlend));
        }
        const a=transform(shoulder),b=transform(elbow),c=transform(hand);
        bone(a,b,.058,skin);bone(a,a.map((v,j)=>mix(v,b[j],.46)),.074,kit);bone(b,c,.044,skin);ellipsoid(c,[.045,.067,.032],skin,axes);
      }
    }
    if(['messi','maradona','r9','ronaldinho'].includes(slug)){
      for(let i=0;i<2;i++){
        const dx=-1.15+i*1.45,react=Math.exp(-Math.pow((px-dx-.2)*2.1,2)),center=[dx-react*.15,.86,-.85+i*.1];
        shadow(center[0],center[2],.43,.45);
        person(center,[[1,0,0],[0,1,0],[0,0,1]],[[dx-.23,.055,center[2]-.16-react*.25],[dx+.16,.055,center[2]+.17]],[[.21,.27,.32],[.07,.11,.16],[.48,.34,.25]],0,false);
      }
    }
    shadow(px,0,.40+Math.max(0,py-1)*.10,.52/(1+Math.max(0,py-1)));
    const targets=[point([lx/55,-ly/55,-.13]),point([rx/55,-ry/55,.13])];
    targets.forEach(foot => { foot[1]=Math.max(.055,foot[1]); });
    person(origin,axes,targets,colors,finish,true);
    shadow(ball[0],ball[2],.13,.4/(1+ball[1]));
    const spin=t*32,ballAxes=[[Math.cos(spin),Math.sin(spin),0],[-Math.sin(spin),Math.cos(spin),0],[0,0,1]];
    draw(orb,matrix(ball,[.115,.115,.115],ballAxes),[1,1,1],2);
  }
  resize();
  return {render,dispose(){disposed=true;observer.disconnect();canvas.removeEventListener('webglcontextlost',onLoss);resources.forEach(([type,res])=>gl[`delete${type}`](res));lastFrame=null;gl.getExtension("WEBGL_lose_context")?.loseContext();},};
}
