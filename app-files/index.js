/*
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

(function() {
  var Marzipano = window.Marzipano;
  var bowser = window.bowser;
  var screenfull = window.screenfull;
  var data = window.APP_DATA;

  // Grab elements from DOM.
  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var sceneListElement = document.querySelector('#sceneList');
  var sceneElements = document.querySelectorAll('#sceneList .scene');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');
  var autorotateToggleElement = document.querySelector('#autorotateToggle');
  var fullscreenToggleElement = document.querySelector('#fullscreenToggle');
  var gyroToggleElement = document.querySelector('#gyroToggle');
  var gyroMessageElement = document.querySelector('#gyroMessage');

  // Detect desktop or mobile mode.
  if (window.matchMedia) {
    var setMode = function() {
      if (mql.matches) {
        document.body.classList.remove('desktop');
        document.body.classList.add('mobile');
      } else {
        document.body.classList.remove('mobile');
        document.body.classList.add('desktop');
      }
    };
    var mql = matchMedia("(max-width: 500px), (max-height: 500px)");
    setMode();
    mql.addListener(setMode);
  } else {
    document.body.classList.add('desktop');
  }

  // Detect whether we are on a touch device.
  document.body.classList.add('no-touch');
  window.addEventListener('touchstart', function() {
    document.body.classList.remove('no-touch');
    document.body.classList.add('touch');
  });

  // Use tooltip fallback mode on IE < 11.
  if (bowser.msie && parseFloat(bowser.version) < 11) {
    document.body.classList.add('tooltip-fallback');
  }

  // Viewer options.
  var viewerOpts = {
    controls: {
      mouseViewMode: data.settings.mouseViewMode
    }
  };

  // Initialize viewer.
  var viewer = new Marzipano.Viewer(panoElement, viewerOpts);


  // Mobile gyroscope. The original Marzipano export does not enable it.
  // Touch / mouse manipulation remains available. While the gyroscope is
  // active, touching the panorama temporarily pauses it; on release, the
  // current finger position becomes the new centre.
  var gyroEnabled = false;
  var gyroSuspended = false;
  var gyroYawOffset = 0;
  var gyroPitchOffset = 0;
  var gyroLastRaw = null;
  var gyroMessageTimer = null;

  function showGyroMessage(message) {
    if (!gyroMessageElement) { return; }
    gyroMessageElement.textContent = message;
    gyroMessageElement.classList.add('visible');
    clearTimeout(gyroMessageTimer);
    gyroMessageTimer = setTimeout(function() {
      gyroMessageElement.classList.remove('visible');
    }, 3500);
  }

  function quaternionMultiply(a, b) {
    return {
      x: a.x*b.w + a.w*b.x + a.y*b.z - a.z*b.y,
      y: a.y*b.w + a.w*b.y + a.z*b.x - a.x*b.z,
      z: a.z*b.w + a.w*b.z + a.x*b.y - a.y*b.x,
      w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    };
  }

  function quaternionFromAxisAngle(x, y, z, angle) {
    var half = angle / 2;
    var s = Math.sin(half);
    return { x: x*s, y: y*s, z: z*s, w: Math.cos(half) };
  }

  // Euler order YXZ, equivalent to the usual mobile DeviceOrientation mapping.
  function quaternionFromEulerYXZ(x, y, z) {
    var c1 = Math.cos(x/2), c2 = Math.cos(y/2), c3 = Math.cos(z/2);
    var s1 = Math.sin(x/2), s2 = Math.sin(y/2), s3 = Math.sin(z/2);
    return {
      x: s1*c2*c3 + c1*s2*s3,
      y: c1*s2*c3 - s1*c2*s3,
      z: c1*c2*s3 - s1*s2*c3,
      w: c1*c2*c3 + s1*s2*s3
    };
  }

  function rotateVectorByQuaternion(v, q) {
    var ix = q.w*v.x + q.y*v.z - q.z*v.y;
    var iy = q.w*v.y + q.z*v.x - q.x*v.z;
    var iz = q.w*v.z + q.x*v.y - q.y*v.x;
    var iw = -q.x*v.x - q.y*v.y - q.z*v.z;
    return {
      x: ix*q.w + iw*(-q.x) + iy*(-q.z) - iz*(-q.y),
      y: iy*q.w + iw*(-q.y) + iz*(-q.x) - ix*(-q.z),
      z: iz*q.w + iw*(-q.z) + ix*(-q.y) - iy*(-q.x)
    };
  }

  function rawOrientation(alpha, beta, gamma) {
    var deg = Math.PI / 180;
    var orient = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
      orient = screen.orientation.angle * deg;
    } else if (typeof window.orientation === 'number') {
      orient = window.orientation * deg;
    }

    // beta = front/back, alpha = compass, gamma = left/right.
    var q = quaternionFromEulerYXZ(beta*deg, alpha*deg, -gamma*deg);
    q = quaternionMultiply(q, quaternionFromAxisAngle(1, 0, 0, -Math.PI/2));
    q = quaternionMultiply(q, quaternionFromAxisAngle(0, 0, 1, -orient));

    var forward = rotateVectorByQuaternion({x:0, y:0, z:-1}, q);
    var yaw = Math.atan2(forward.x, -forward.z);
    var pitch = -Math.asin(Math.max(-1, Math.min(1, forward.y)));
    return { yaw: yaw, pitch: pitch };
  }

  function onDeviceOrientation(event) {
    if (!gyroEnabled || gyroSuspended || event.alpha == null || event.beta == null || event.gamma == null) {
      return;
    }
    var raw = rawOrientation(event.alpha, event.beta, event.gamma);
    gyroLastRaw = raw;
    var view = scenes && scenes.length ? scenes.filter(function(s){ return s.scene.visible(); })[0] : null;
    if (!view) { return; }
    view.view.setYaw(raw.yaw + gyroYawOffset);
    view.view.setPitch(raw.pitch + gyroPitchOffset);
  }

  function recenterGyroscope() {
    if (!gyroLastRaw) { return; }
    var active = scenes && scenes.length ? scenes.filter(function(s){ return s.scene.visible(); })[0] : null;
    if (!active) { return; }
    gyroYawOffset = active.view.yaw() - gyroLastRaw.yaw;
    gyroPitchOffset = active.view.pitch() - gyroLastRaw.pitch;
  }

  function enableGyroscope() {
    gyroEnabled = true;
    gyroSuspended = false;
    gyroLastRaw = null;
    gyroToggleElement.classList.add('enabled');
    gyroToggleElement.setAttribute('aria-label', 'Désactiver le gyroscope');
    window.addEventListener('deviceorientation', onDeviceOrientation, true);
    showGyroMessage('Gyroscope activé. Bougez le téléphone. Touchez et glissez pour réorienter la vue.');
  }

  function disableGyroscope() {
    gyroEnabled = false;
    gyroSuspended = false;
    gyroToggleElement.classList.remove('enabled');
    gyroToggleElement.setAttribute('aria-label', 'Activer le gyroscope');
    window.removeEventListener('deviceorientation', onDeviceOrientation, true);
    showGyroMessage('Gyroscope désactivé. Vous pouvez déplacer la vue avec le doigt.');
  }

  function requestGyroscope() {
    if (!window.DeviceOrientationEvent) {
      gyroToggleElement.classList.add('unsupported');
      showGyroMessage('Le gyroscope n’est pas disponible dans ce navigateur.');
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function(result) {
        if (result === 'granted') {
          enableGyroscope();
        } else {
          showGyroMessage('Autorisation refusée. Activez « Mouvement et orientation » dans les réglages du navigateur.');
        }
      }).catch(function() {
        showGyroMessage('Impossible d’activer le gyroscope. Vérifiez les autorisations du navigateur.');
      });
    } else {
      enableGyroscope();
    }
  }

  if (gyroToggleElement) {
    gyroToggleElement.addEventListener('click', function(event) {
      event.preventDefault();
      if (gyroEnabled) { disableGyroscope(); }
      else { requestGyroscope(); }
    });
  }

  panoElement.addEventListener('touchstart', function() {
    if (gyroEnabled) { gyroSuspended = true; }
  }, { passive: true });
  panoElement.addEventListener('touchend', function() {
    if (!gyroEnabled) { return; }
    setTimeout(function() {
      recenterGyroscope();
      gyroSuspended = false;
    }, 120);
  }, { passive: true });
  panoElement.addEventListener('touchcancel', function() {
    if (gyroEnabled) { gyroSuspended = false; }
  }, { passive: true });

  // Create scenes.
  var scenes = data.scenes.map(function(data) {
    var urlPrefix = "tiles";
    var source = Marzipano.ImageUrlSource.fromString(
      urlPrefix + "/" + data.id + "/{z}/{f}/{y}/{x}.jpg",
      { cubeMapPreviewUrl: urlPrefix + "/" + data.id + "/preview.jpg" });
    var geometry = new Marzipano.CubeGeometry(data.levels);

    var limiter = Marzipano.RectilinearView.limit.traditional(data.faceSize, 100*Math.PI/180, 120*Math.PI/180);
    var view = new Marzipano.RectilinearView(data.initialViewParameters, limiter);

    var scene = viewer.createScene({
      source: source,
      geometry: geometry,
      view: view,
      pinFirstLevel: true
    });

    // Create link hotspots.
    data.linkHotspots.forEach(function(hotspot) {
      var element = createLinkHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
    });

    // Create info hotspots.
    data.infoHotspots.forEach(function(hotspot) {
      var element = createInfoHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
    });

    return {
      data: data,
      scene: scene,
      view: view
    };
  });

  // Set up autorotate, if enabled.
  var autorotate = Marzipano.autorotate({
    yawSpeed: 0.03,
    targetPitch: 0,
    targetFov: Math.PI/2
  });
  if (data.settings.autorotateEnabled) {
    autorotateToggleElement.classList.add('enabled');
  }

  // Set handler for autorotate toggle.
  autorotateToggleElement.addEventListener('click', toggleAutorotate);

  // Set up fullscreen mode, if supported.
  if (screenfull.enabled && data.settings.fullscreenButton) {
    document.body.classList.add('fullscreen-enabled');
    fullscreenToggleElement.addEventListener('click', function() {
      screenfull.toggle();
    });
    screenfull.on('change', function() {
      if (screenfull.isFullscreen) {
        fullscreenToggleElement.classList.add('enabled');
      } else {
        fullscreenToggleElement.classList.remove('enabled');
      }
    });
  } else {
    document.body.classList.add('fullscreen-disabled');
  }

  // Set handler for scene list toggle.
  sceneListToggleElement.addEventListener('click', toggleSceneList);

  // Start with the scene list open on desktop.
  if (!document.body.classList.contains('mobile')) {
    showSceneList();
  }

  // Set handler for scene switch.
  scenes.forEach(function(scene) {
    var el = document.querySelector('#sceneList .scene[data-id="' + scene.data.id + '"]');
    el.addEventListener('click', function() {
      switchScene(scene);
      // On mobile, hide scene list after selecting a scene.
      if (document.body.classList.contains('mobile')) {
        hideSceneList();
      }
    });
  });

  // DOM elements for view controls.
  var viewUpElement = document.querySelector('#viewUp');
  var viewDownElement = document.querySelector('#viewDown');
  var viewLeftElement = document.querySelector('#viewLeft');
  var viewRightElement = document.querySelector('#viewRight');
  var viewInElement = document.querySelector('#viewIn');
  var viewOutElement = document.querySelector('#viewOut');

  // Dynamic parameters for controls.
  var velocity = 0.7;
  var friction = 3;

  // Associate view controls with elements.
  var controls = viewer.controls();
  controls.registerMethod('upElement',    new Marzipano.ElementPressControlMethod(viewUpElement,     'y', -velocity, friction), true);
  controls.registerMethod('downElement',  new Marzipano.ElementPressControlMethod(viewDownElement,   'y',  velocity, friction), true);
  controls.registerMethod('leftElement',  new Marzipano.ElementPressControlMethod(viewLeftElement,   'x', -velocity, friction), true);
  controls.registerMethod('rightElement', new Marzipano.ElementPressControlMethod(viewRightElement,  'x',  velocity, friction), true);
  controls.registerMethod('inElement',    new Marzipano.ElementPressControlMethod(viewInElement,  'zoom', -velocity, friction), true);
  controls.registerMethod('outElement',   new Marzipano.ElementPressControlMethod(viewOutElement, 'zoom',  velocity, friction), true);

  function sanitize(s) {
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
  }

  function switchScene(scene) {
    stopAutorotate();
    scene.view.setParameters(scene.data.initialViewParameters);
    scene.scene.switchTo();
    startAutorotate();
    updateSceneName(scene);
    updateSceneList(scene);
  }

  function updateSceneName(scene) {
    sceneNameElement.innerHTML = sanitize(scene.data.name);
  }

  function updateSceneList(scene) {
    for (var i = 0; i < sceneElements.length; i++) {
      var el = sceneElements[i];
      if (el.getAttribute('data-id') === scene.data.id) {
        el.classList.add('current');
      } else {
        el.classList.remove('current');
      }
    }
  }

  function showSceneList() {
    sceneListElement.classList.add('enabled');
    sceneListToggleElement.classList.add('enabled');
  }

  function hideSceneList() {
    sceneListElement.classList.remove('enabled');
    sceneListToggleElement.classList.remove('enabled');
  }

  function toggleSceneList() {
    sceneListElement.classList.toggle('enabled');
    sceneListToggleElement.classList.toggle('enabled');
  }

  function startAutorotate() {
    if (!autorotateToggleElement.classList.contains('enabled')) {
      return;
    }
    viewer.startMovement(autorotate);
    viewer.setIdleMovement(3000, autorotate);
  }

  function stopAutorotate() {
    viewer.stopMovement();
    viewer.setIdleMovement(Infinity);
  }

  function toggleAutorotate() {
    if (autorotateToggleElement.classList.contains('enabled')) {
      autorotateToggleElement.classList.remove('enabled');
      stopAutorotate();
    } else {
      autorotateToggleElement.classList.add('enabled');
      startAutorotate();
    }
  }

  function createLinkHotspotElement(hotspot) {

    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('link-hotspot');

    // Create image element.
    var icon = document.createElement('img');
    icon.src = 'img/link.png';
    icon.classList.add('link-hotspot-icon');

    // Set rotation transform.
    var transformProperties = [ '-ms-transform', '-webkit-transform', 'transform' ];
    for (var i = 0; i < transformProperties.length; i++) {
      var property = transformProperties[i];
      icon.style[property] = 'rotate(' + hotspot.rotation + 'rad)';
    }

    // Add click event handler.
    wrapper.addEventListener('click', function() {
      switchScene(findSceneById(hotspot.target));
    });

    // Prevent touch and scroll events from reaching the parent element.
    // This prevents the view control logic from interfering with the hotspot.
    stopTouchAndScrollEventPropagation(wrapper);

    // Create tooltip element.
    var tooltip = document.createElement('div');
    tooltip.classList.add('hotspot-tooltip');
    tooltip.classList.add('link-hotspot-tooltip');
    tooltip.innerHTML = findSceneDataById(hotspot.target).name;

    wrapper.appendChild(icon);
    wrapper.appendChild(tooltip);

    return wrapper;
  }

  function createInfoHotspotElement(hotspot) {

    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('info-hotspot');

    // Create hotspot/tooltip header.
    var header = document.createElement('div');
    header.classList.add('info-hotspot-header');

    // Create image element.
    var iconWrapper = document.createElement('div');
    iconWrapper.classList.add('info-hotspot-icon-wrapper');
    var icon = document.createElement('img');
    icon.src = 'img/info.png';
    icon.classList.add('info-hotspot-icon');
    iconWrapper.appendChild(icon);

    // Create title element.
    var titleWrapper = document.createElement('div');
    titleWrapper.classList.add('info-hotspot-title-wrapper');
    var title = document.createElement('div');
    title.classList.add('info-hotspot-title');
    title.innerHTML = hotspot.title;
    titleWrapper.appendChild(title);

    // Create close element.
    var closeWrapper = document.createElement('div');
    closeWrapper.classList.add('info-hotspot-close-wrapper');
    var closeIcon = document.createElement('img');
    closeIcon.src = 'img/close.png';
    closeIcon.classList.add('info-hotspot-close-icon');
    closeWrapper.appendChild(closeIcon);

    // Construct header element.
    header.appendChild(iconWrapper);
    header.appendChild(titleWrapper);
    header.appendChild(closeWrapper);

    // Create text element.
    var text = document.createElement('div');
    text.classList.add('info-hotspot-text');
    text.innerHTML = hotspot.text;

    // Place header and text into wrapper element.
    wrapper.appendChild(header);
    wrapper.appendChild(text);

    // Create a modal for the hotspot content to appear on mobile mode.
    var modal = document.createElement('div');
    modal.innerHTML = wrapper.innerHTML;
    modal.classList.add('info-hotspot-modal');
    document.body.appendChild(modal);

    var toggle = function() {
      wrapper.classList.toggle('visible');
      modal.classList.toggle('visible');
    };

    // Show content when hotspot is clicked.
    wrapper.querySelector('.info-hotspot-header').addEventListener('click', toggle);

    // Hide content when close icon is clicked.
    modal.querySelector('.info-hotspot-close-wrapper').addEventListener('click', toggle);

    // Prevent touch and scroll events from reaching the parent element.
    // This prevents the view control logic from interfering with the hotspot.
    stopTouchAndScrollEventPropagation(wrapper);

    return wrapper;
  }

  // Prevent touch and scroll events from reaching the parent element.
  function stopTouchAndScrollEventPropagation(element, eventList) {
    var eventList = [ 'touchstart', 'touchmove', 'touchend', 'touchcancel',
                      'wheel', 'mousewheel' ];
    for (var i = 0; i < eventList.length; i++) {
      element.addEventListener(eventList[i], function(event) {
        event.stopPropagation();
      });
    }
  }

  function findSceneById(id) {
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].data.id === id) {
        return scenes[i];
      }
    }
    return null;
  }

  function findSceneDataById(id) {
    for (var i = 0; i < data.scenes.length; i++) {
      if (data.scenes[i].id === id) {
        return data.scenes[i];
      }
    }
    return null;
  }

  // Display the initial scene.
  switchScene(scenes[0]);

})();
