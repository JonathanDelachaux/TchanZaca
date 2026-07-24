import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GALLERY, SCENES } from "./scenes.js";

const viewer = document.querySelector("#viewer");
const fade = document.querySelector("#fade");
const title = document.querySelector("#sceneTitle");
const gyroButton = document.querySelector("#gyroButton");
const previousButton = document.querySelector("#previousButton");
const galleryButton = document.querySelector("#galleryButton");
const nextButton = document.querySelector("#nextButton");
const loadingMessage = document.querySelector("#loadingMessage");
const errorBox = document.querySelector("#errorBox");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
  showFatalError("Le navigateur n’a pas pu démarrer l’affichage 3D.", error);
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const rig = new THREE.Object3D();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);
rig.add(camera);
scene.add(rig);

const geometry = new THREE.SphereGeometry(100, 64, 40);
geometry.scale(-1, 1, 1);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let sphere = null;
let texture = null;
let video = null;
let currentIndex = 0;
let mode = "gallery";
let loading = false;

let yaw = 0;
let pitch = 0;
let dragging = false;
let pointerStartX = 0;
let pointerStartY = 0;
let previousX = 0;
let previousY = 0;
let pointerMoved = false;
let pinchDistance = 0;

let gyroEnabled = false;
let deviceOrientation = null;
let screenAngle = 0;

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(
  -Math.sqrt(0.5),
  0,
  0,
  Math.sqrt(0.5)
);

/*
  Centres horizontaux des dix numéros visibles dans 00-galerie.png.
  La détection utilise également la position miroir afin de rester
  compatible avec l’orientation interne de la sphère.
*/
const GALLERY_HOTSPOTS = [
  { scene: 0, u: 0.4688 },
  { scene: 1, u: 0.5713 },
  { scene: 2, u: 0.6177 },
  { scene: 3, u: 0.7251 },
  { scene: 4, u: 0.8228 },
  { scene: 5, u: 0.0708 },
  { scene: 6, u: 0.1514 },
  { scene: 7, u: 0.2905 },
  { scene: 8, u: 0.3223 },
  { scene: 9, u: 0.3979 }
];

function showFatalError(message, error = null) {
  const details = error?.message ? `\n\nDétail : ${error.message}` : "";
  errorBox.hidden = false;
  errorBox.textContent = message + details;
  loadingMessage.style.display = "none";
}

window.addEventListener("error", event => {
  showFatalError("Une erreur JavaScript empêche le viewer de fonctionner.", event.error);
});

window.addEventListener("unhandledrejection", event => {
  showFatalError("Une erreur de chargement empêche le viewer de fonctionner.", event.reason);
});

function setLoading(value) {
  loading = value;
  previousButton.disabled = value;
  nextButton.disabled = value;
  galleryButton.disabled = value || mode === "gallery";
  loadingMessage.style.opacity = value ? "1" : "0";
}

function disposeCurrentMedia() {
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video = null;
  }

  if (texture) {
    texture.dispose();
    texture = null;
  }

  if (sphere) {
    scene.remove(sphere);
    sphere.material.dispose();
    sphere = null;
  }
}

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      file,
      loadedTexture => {
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        resolve(loadedTexture);
      },
      undefined,
      () => reject(new Error(`Impossible de charger la photo : ${file}`))
    );
  });
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const element = document.createElement("video");
    element.src = file;
    element.crossOrigin = "anonymous";
    element.loop = true;
    element.muted = true;
    element.defaultMuted = true;
    element.volume = 0;
    element.playsInline = true;
    element.preload = "auto";

    const ready = async () => {
      try {
        await element.play();
      } catch {
        // Une interaction ultérieure relancera la lecture si le navigateur la bloque.
      }

      const loadedTexture = new THREE.VideoTexture(element);
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.minFilter = THREE.LinearFilter;
      loadedTexture.magFilter = THREE.LinearFilter;
      video = element;
      resolve(loadedTexture);
    };

    element.addEventListener("canplay", ready, { once: true });
    element.addEventListener(
      "error",
      () => reject(new Error(`Impossible de charger la vidéo : ${file}`)),
      { once: true }
    );
    element.load();
  });
}

async function loadConfiguration(configuration, newMode) {
  if (loading) return;

  setLoading(true);
  fade.style.opacity = "1";
  await new Promise(resolve => setTimeout(resolve, 430));

  disposeCurrentMedia();
  mode = newMode;
  yaw = THREE.MathUtils.degToRad(configuration.startYaw || 0);
  pitch = 0;
  title.textContent = configuration.title;
  document.title = `${configuration.title} — Galerie 360`;

  try {
    texture =
      configuration.type === "video"
        ? await loadVideo(configuration.file)
        : await loadPhoto(configuration.file);

    sphere = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map: texture })
    );
    scene.add(sphere);

    errorBox.hidden = true;
  } catch (error) {
    showFatalError(
      `${error.message}\n\nVérifie que le fichier existe exactement sous ce nom dans le dossier « media ».`,
      error
    );
  } finally {
    fade.style.opacity = "0";
    setLoading(false);
    galleryButton.disabled = mode === "gallery";
  }
}

async function loadArtwork(index) {
  currentIndex = (index + SCENES.length) % SCENES.length;
  await loadConfiguration(SCENES[currentIndex], "artwork");
}

async function loadGallery() {
  const returnYaw =
    mode === "artwork" ? SCENES[currentIndex].galleryYaw || 0 : GALLERY.startYaw || 0;

  await loadConfiguration(
    { ...GALLERY, startYaw: returnYaw },
    "gallery"
  );
}

function circularDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

function galleryArtworkFromUV(uv) {
  if (!uv) return null;

  /*
    Bande verticale volontairement large :
    elle englobe les tableaux et les numéros au sol.
  */
  const vertical = uv.y;
  if (vertical < 0.28 || vertical > 0.72) return null;

  let best = null;

  for (const hotspot of GALLERY_HOTSPOTS) {
    const direct = circularDistance(uv.x, hotspot.u);
    const mirrored = circularDistance(1 - uv.x, hotspot.u);
    const distance = Math.min(direct, mirrored);

    if (!best || distance < best.distance) {
      best = { scene: hotspot.scene, distance };
    }
  }

  return best && best.distance < 0.055 ? best.scene : null;
}

function openGalleryArtworkAt(clientX, clientY) {
  if (mode !== "gallery" || !sphere || loading) return false;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersection = raycaster.intersectObject(sphere, false)[0];

  if (!intersection) return false;

  const artworkIndex = galleryArtworkFromUV(intersection.uv);
  if (artworkIndex === null) return false;

  loadArtwork(artworkIndex);
  return true;
}

function setObjectQuaternion(quaternion, alpha, beta, gamma, orient) {
  euler.set(beta, alpha, -gamma, "YXZ");
  quaternion.setFromEuler(euler);
  quaternion.multiply(q1);
  quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
}

function updateCameraOrientation() {
  rig.rotation.set(pitch, yaw, 0, "YXZ");

  if (!gyroEnabled || !deviceOrientation) {
    camera.quaternion.identity();
    return;
  }

  const alpha = deviceOrientation.alpha
    ? THREE.MathUtils.degToRad(deviceOrientation.alpha)
    : 0;
  const beta = deviceOrientation.beta
    ? THREE.MathUtils.degToRad(deviceOrientation.beta)
    : 0;
  const gamma = deviceOrientation.gamma
    ? THREE.MathUtils.degToRad(deviceOrientation.gamma)
    : 0;
  const orient = screenAngle
    ? THREE.MathUtils.degToRad(screenAngle)
    : 0;

  setObjectQuaternion(camera.quaternion, alpha, beta, gamma, orient);
}

function onDeviceOrientation(event) {
  deviceOrientation = event;
}

function updateScreenOrientation() {
  screenAngle =
    window.screen?.orientation?.angle ??
    window.orientation ??
    0;
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
  if (gyroEnabled) {
    disableGyroscope();
  } else {
    enableGyroscope();
  }
});

previousButton.addEventListener("click", () => {
  if (mode === "gallery") {
    loadArtwork(SCENES.length - 1);
  } else {
    loadArtwork(currentIndex - 1);
  }
});

nextButton.addEventListener("click", () => {
  if (mode === "gallery") {
    loadArtwork(0);
  } else {
    loadArtwork(currentIndex + 1);
  }
});

galleryButton.addEventListener("click", loadGallery);

renderer.domElement.addEventListener("pointerdown", event => {
  dragging = true;
  pointerMoved = false;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  previousX = event.clientX;
  previousY = event.clientY;

  renderer.domElement.setPointerCapture(event.pointerId);

  if (video?.paused) {
    video.play().catch(() => {});
  }
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!dragging) return;

  const dx = event.clientX - previousX;
  const dy = event.clientY - previousY;

  if (
    Math.hypot(
      event.clientX - pointerStartX,
      event.clientY - pointerStartY
    ) > 8
  ) {
    pointerMoved = true;
  }

  previousX = event.clientX;
  previousY = event.clientY;

  yaw -= dx * 0.0045;
  pitch -= dy * 0.0045;
  pitch = THREE.MathUtils.clamp(
    pitch,
    -Math.PI / 2.05,
    Math.PI / 2.05
  );
});

renderer.domElement.addEventListener("pointerup", event => {
  const wasClick =
    !pointerMoved &&
    Math.hypot(
      event.clientX - pointerStartX,
      event.clientY - pointerStartY
    ) <= 8;

  dragging = false;

  try {
    renderer.domElement.releasePointerCapture(event.pointerId);
  } catch {
    // Aucun problème si le pointeur a déjà été libéré.
  }

  if (wasClick) {
    openGalleryArtworkAt(event.clientX, event.clientY);
  }
});

renderer.domElement.addEventListener("pointercancel", () => {
  dragging = false;
  pointerMoved = false;
});

renderer.domElement.addEventListener(
  "wheel",
  event => {
    camera.fov = THREE.MathUtils.clamp(
      camera.fov + event.deltaY * 0.035,
      35,
      100
    );
    camera.updateProjectionMatrix();
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchstart",
  event => {
    if (event.touches.length === 2) {
      pinchDistance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY
      );
    }
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchmove",
  event => {
    if (event.touches.length === 2) {
      const distance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY
      );
      const delta = pinchDistance - distance;
      pinchDistance = distance;

      camera.fov = THREE.MathUtils.clamp(
        camera.fov + delta * 0.08,
        35,
        100
      );
      camera.updateProjectionMatrix();
    }
  },
  { passive: true }
);

window.addEventListener("orientationchange", updateScreenOrientation);
window.screen?.orientation?.addEventListener?.(
  "change",
  updateScreenOrientation
);
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
loadGallery();
