import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { SCENES } from "./scenes.js";

const viewerElement = document.querySelector("#viewer");
const fadeElement = document.querySelector("#fade");
const sceneTitle = document.querySelector("#sceneTitle");
const sceneType = document.querySelector("#sceneType");
const gyroButton = document.querySelector("#gyroButton");
const previousButton = document.querySelector("#previousButton");
const nextButton = document.querySelector("#nextButton");
const soundButton = document.querySelector("#soundButton");
const instructions = document.querySelector("#instructions");
const errorBox = document.querySelector("#errorBox");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewerElement.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const cameraRig = new THREE.Object3D();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 2000);
cameraRig.add(camera);
scene.add(cameraRig);

const geometry = new THREE.SphereGeometry(100, 64, 40);
geometry.scale(-1, 1, 1);

let sphere = null;
let currentTexture = null;
let currentVideo = null;
let currentIndex = 0;
let gyroEnabled = false;
let deviceOrientation = null;
let screenOrientation = 0;
let manualYaw = 0;
let manualPitch = 0;
let pointerDown = false;
let pointerX = 0;
let pointerY = 0;
let pinchDistance = 0;

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

window.addEventListener("error", event => {
  showError("Erreur JavaScript : " + event.message);
});

function disposeCurrentMedia() {
  if (currentVideo) {
    currentVideo.pause();
    currentVideo.removeAttribute("src");
    currentVideo.load();
    currentVideo = null;
  }
  if (currentTexture) {
    currentTexture.dispose();
    currentTexture = null;
  }
  if (sphere) {
    scene.remove(sphere);
    sphere.material.dispose();
    sphere = null;
  }
}

function makeVideoTexture(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.src = file;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const onReady = async () => {
      try {
        await video.play();
      } catch (_) {
        // La lecture pourra démarrer après la première interaction.
      }
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      currentVideo = video;
      soundButton.hidden = false;
      soundButton.textContent = "Activer le son";
      resolve(texture);
    };

    video.addEventListener("canplay", onReady, { once: true });
    video.addEventListener("error", () => reject(new Error("Impossible de charger la vidéo : " + file)), { once: true });
    video.load();
  });
}

function makePhotoTexture(file) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      file,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        soundButton.hidden = true;
        resolve(texture);
      },
      undefined,
      () => reject(new Error("Impossible de charger la photo : " + file))
    );
  });
}

async function loadScene(index) {
  const normalized = (index + SCENES.length) % SCENES.length;
  const config = SCENES[normalized];

  fadeElement.style.opacity = "1";
  await new Promise(resolve => setTimeout(resolve, 460));

  disposeCurrentMedia();
  currentIndex = normalized;
  manualYaw = THREE.MathUtils.degToRad(config.startYaw || 0);
  manualPitch = 0;

  sceneTitle.textContent = config.title;
  sceneType.textContent = config.type === "video" ? "Vidéo 360" : "Photo 360";

  try {
    currentTexture = config.type === "video"
      ? await makeVideoTexture(config.file)
      : await makePhotoTexture(config.file);

    const material = new THREE.MeshBasicMaterial({ map: currentTexture });
    sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    fadeElement.style.opacity = "0";
  } catch (error) {
    fadeElement.style.opacity = "0";
    showError(
      error.message +
      "\n\nVérifie que le fichier existe exactement sous ce nom dans le dossier « media »."
    );
  }
}

function setObjectQuaternion(quaternion, alpha, beta, gamma, orient) {
  euler.set(beta, alpha, -gamma, "YXZ");
  quaternion.setFromEuler(euler);
  quaternion.multiply(q1);
  quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
}

function updateCameraOrientation() {
  cameraRig.rotation.set(manualPitch, manualYaw, 0, "YXZ");

  if (!gyroEnabled || !deviceOrientation) {
    camera.quaternion.identity();
    return;
  }

  const alpha = deviceOrientation.alpha ? THREE.MathUtils.degToRad(deviceOrientation.alpha) : 0;
  const beta = deviceOrientation.beta ? THREE.MathUtils.degToRad(deviceOrientation.beta) : 0;
  const gamma = deviceOrientation.gamma ? THREE.MathUtils.degToRad(deviceOrientation.gamma) : 0;
  const orient = screenOrientation ? THREE.MathUtils.degToRad(screenOrientation) : 0;

  setObjectQuaternion(camera.quaternion, alpha, beta, gamma, orient);
}

function onDeviceOrientation(event) {
  deviceOrientation = event;
}

function updateScreenOrientation() {
  screenOrientation = window.screen?.orientation?.angle ?? window.orientation ?? 0;
}

async function enableGyroscope() {
  try {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        throw new Error("L’autorisation du mouvement a été refusée.");
      }
    }

    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    gyroEnabled = true;
    gyroButton.classList.add("active");
    gyroButton.textContent = "Gyroscope activé";
    instructions.style.opacity = "0";
  } catch (error) {
    gyroEnabled = false;
    gyroButton.classList.remove("active");
    gyroButton.textContent = "Activer le gyroscope";
    alert(error.message || "Le gyroscope n’a pas pu être activé.");
  }
}

function disableGyroscope() {
  gyroEnabled = false;
  deviceOrientation = null;
  window.removeEventListener("deviceorientation", onDeviceOrientation, true);
  camera.quaternion.identity();
  gyroButton.classList.remove("active");
  gyroButton.textContent = "Activer le gyroscope";
}

gyroButton.addEventListener("click", () => {
  if (gyroEnabled) disableGyroscope();
  else enableGyroscope();
});

soundButton.addEventListener("click", async () => {
  if (!currentVideo) return;
  currentVideo.muted = !currentVideo.muted;
  soundButton.textContent = currentVideo.muted ? "Activer le son" : "Couper le son";
  try { await currentVideo.play(); } catch (_) {}
});

previousButton.addEventListener("click", () => loadScene(currentIndex - 1));
nextButton.addEventListener("click", () => loadScene(currentIndex + 1));

renderer.domElement.addEventListener("pointerdown", event => {
  pointerDown = true;
  pointerX = event.clientX;
  pointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
  if (currentVideo?.paused) currentVideo.play().catch(() => {});
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!pointerDown) return;
  const dx = event.clientX - pointerX;
  const dy = event.clientY - pointerY;
  pointerX = event.clientX;
  pointerY = event.clientY;

  manualYaw -= dx * 0.0045;
  manualPitch -= dy * 0.0045;
  manualPitch = THREE.MathUtils.clamp(manualPitch, -Math.PI / 2.05, Math.PI / 2.05);
});

renderer.domElement.addEventListener("pointerup", event => {
  pointerDown = false;
  try { renderer.domElement.releasePointerCapture(event.pointerId); } catch (_) {}
});
renderer.domElement.addEventListener("pointercancel", () => { pointerDown = false; });

renderer.domElement.addEventListener("wheel", event => {
  camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.035, 35, 100);
  camera.updateProjectionMatrix();
}, { passive: true });

renderer.domElement.addEventListener("touchstart", event => {
  if (event.touches.length === 2) {
    pinchDistance = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
  }
}, { passive: true });

renderer.domElement.addEventListener("touchmove", event => {
  if (event.touches.length === 2) {
    const distance = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
    const delta = pinchDistance - distance;
    pinchDistance = distance;
    camera.fov = THREE.MathUtils.clamp(camera.fov + delta * 0.08, 35, 100);
    camera.updateProjectionMatrix();
  }
}, { passive: true });

window.addEventListener("orientationchange", updateScreenOrientation);
window.screen?.orientation?.addEventListener?.("change", updateScreenOrientation);
updateScreenOrientation();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  updateCameraOrientation();
  renderer.render(scene, camera);
}
animate();
loadScene(0);

setTimeout(() => {
  instructions.style.opacity = "0";
}, 7000);
