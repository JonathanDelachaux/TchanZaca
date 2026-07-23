import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import {SCENES} from "./scenes.js";

const viewer=document.querySelector("#viewer"),fade=document.querySelector("#fade"),title=document.querySelector("#sceneTitle"),gyroBtn=document.querySelector("#gyroButton"),prev=document.querySelector("#previousButton"),next=document.querySelector("#nextButton"),errorBox=document.querySelector("#errorBox");
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;viewer.appendChild(renderer.domElement);

const scene=new THREE.Scene(),rig=new THREE.Object3D(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.01,2000);
rig.add(camera);scene.add(rig);
const geometry=new THREE.SphereGeometry(100,64,40);geometry.scale(-1,1,1);

let sphere=null,texture=null,video=null,index=0,loading=false,gyro=false,orientation=null,screenAngle=0,yaw=0,pitch=0,down=false,px=0,py=0,pinch=0;
const zee=new THREE.Vector3(0,0,1),euler=new THREE.Euler(),q0=new THREE.Quaternion(),q1=new THREE.Quaternion(-Math.sqrt(.5),0,0,Math.sqrt(.5));

function fail(message){errorBox.hidden=false;errorBox.textContent=message}
function dispose(){if(video){video.pause();video.removeAttribute("src");video.load();video=null}if(texture){texture.dispose();texture=null}if(sphere){scene.remove(sphere);sphere.material.dispose();sphere=null}}
function photo(file){return new Promise((ok,no)=>new THREE.TextureLoader().load(file,t=>{t.colorSpace=THREE.SRGBColorSpace;ok(t)},undefined,()=>no(new Error("Impossible de charger la photo : "+file))))}
function movie(file){return new Promise((ok,no)=>{const v=document.createElement("video");v.src=file;v.loop=true;v.muted=true;v.playsInline=true;v.preload="auto";v.addEventListener("canplay",async()=>{try{await v.play()}catch{}const t=new THREE.VideoTexture(v);t.colorSpace=THREE.SRGBColorSpace;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;video=v;ok(t)},{once:true});v.addEventListener("error",()=>no(new Error("Impossible de charger la vidéo : "+file)),{once:true});v.load()})}
async function loadScene(i){if(loading)return;loading=true;prev.disabled=next.disabled=true;const n=(i+SCENES.length)%SCENES.length,cfg=SCENES[n];fade.style.opacity="1";await new Promise(r=>setTimeout(r,520));dispose();index=n;yaw=THREE.MathUtils.degToRad(cfg.startYaw||0);pitch=0;title.textContent=cfg.title;document.title=cfg.title+" — Galerie 360";try{texture=cfg.type==="video"?await movie(cfg.file):await photo(cfg.file);sphere=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture}));scene.add(sphere)}catch(e){fail(e.message+"\n\nVérifie le nom exact du fichier dans le dossier media.")}finally{fade.style.opacity="0";loading=false;prev.disabled=next.disabled=false}}
function setQ(q,a,b,g,o){euler.set(b,a,-g,"YXZ");q.setFromEuler(euler);q.multiply(q1);q.multiply(q0.setFromAxisAngle(zee,-o))}
function updateCamera(){rig.rotation.set(pitch,yaw,0,"YXZ");if(!gyro||!orientation){camera.quaternion.identity();return}const a=orientation.alpha?THREE.MathUtils.degToRad(orientation.alpha):0,b=orientation.beta?THREE.MathUtils.degToRad(orientation.beta):0,g=orientation.gamma?THREE.MathUtils.degToRad(orientation.gamma):0,o=screenAngle?THREE.MathUtils.degToRad(screenAngle):0;setQ(camera.quaternion,a,b,g,o)}
function onOrientation(e){orientation=e}
function updateScreen(){screenAngle=screen.orientation?.angle??window.orientation??0}
async function enableGyro(){try{if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){const p=await DeviceOrientationEvent.requestPermission();if(p!=="granted")throw new Error("L’autorisation du mouvement a été refusée.")}addEventListener("deviceorientation",onOrientation,true);gyro=true;gyroBtn.classList.add("active");gyroBtn.textContent="Gyroscope activé"}catch(e){gyro=false;gyroBtn.classList.remove("active");gyroBtn.textContent="Activer le gyroscope";alert(e.message||"Le gyroscope n’a pas pu être activé.")}}
function disableGyro(){gyro=false;orientation=null;removeEventListener("deviceorientation",onOrientation,true);camera.quaternion.identity();gyroBtn.classList.remove("active");gyroBtn.textContent="Activer le gyroscope"}
gyroBtn.addEventListener("click",()=>gyro?disableGyro():enableGyro());
prev.addEventListener("click",()=>loadScene(index-1));next.addEventListener("click",()=>loadScene(index+1));
renderer.domElement.addEventListener("pointerdown",e=>{down=true;px=e.clientX;py=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);if(video?.paused)video.play().catch(()=>{})});
renderer.domElement.addEventListener("pointermove",e=>{if(!down)return;const dx=e.clientX-px,dy=e.clientY-py;px=e.clientX;py=e.clientY;yaw-=dx*.0045;pitch-=dy*.0045;pitch=THREE.MathUtils.clamp(pitch,-Math.PI/2.05,Math.PI/2.05)});
renderer.domElement.addEventListener("pointerup",e=>{down=false;try{renderer.domElement.releasePointerCapture(e.pointerId)}catch{}});
renderer.domElement.addEventListener("pointercancel",()=>down=false);
renderer.domElement.addEventListener("wheel",e=>{camera.fov=THREE.MathUtils.clamp(camera.fov+e.deltaY*.035,35,100);camera.updateProjectionMatrix()},{passive:true});
renderer.domElement.addEventListener("touchstart",e=>{if(e.touches.length===2)pinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)},{passive:true});
renderer.domElement.addEventListener("touchmove",e=>{if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),delta=pinch-d;pinch=d;camera.fov=THREE.MathUtils.clamp(camera.fov+delta*.08,35,100);camera.updateProjectionMatrix()}},{passive:true});
addEventListener("orientationchange",updateScreen);screen.orientation?.addEventListener?.("change",updateScreen);updateScreen();
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
function animate(){requestAnimationFrame(animate);updateCamera();renderer.render(scene,camera)}animate();loadScene(0);
