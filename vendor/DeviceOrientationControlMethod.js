/*
 * Device orientation control method adapted from the official Marzipano demo.
 * Copyright 2016 Google Inc. Licensed under Apache 2.0.
 */
'use strict';

function DeviceOrientationControlMethod() {
  this._dynamics = {
    yaw: new Marzipano.Dynamics(),
    pitch: new Marzipano.Dynamics()
  };
  this._deviceOrientationHandler = this._handleData.bind(this);
  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', this._deviceOrientationHandler);
  }
  this._previous = {};
  this._current = {};
  this._tmp = {};
  this._getPitchCallbacks = [];
}

Marzipano.dependencies.eventEmitter(DeviceOrientationControlMethod);

DeviceOrientationControlMethod.prototype.destroy = function() {
  this._dynamics = null;
  if (window.DeviceOrientationEvent) {
    window.removeEventListener('deviceorientation', this._deviceOrientationHandler);
  }
  this._deviceOrientationHandler = null;
  this._previous = null;
  this._current = null;
  this._tmp = null;
  this._getPitchCallbacks = null;
};

DeviceOrientationControlMethod.prototype.getPitch = function(cb) {
  this._getPitchCallbacks.push(cb);
};

DeviceOrientationControlMethod.prototype.reset = function() {
  this._previous = {};
};

DeviceOrientationControlMethod.prototype._handleData = function(data) {
  if (data.alpha == null || data.beta == null || data.gamma == null) {
    return;
  }

  var previous = this._previous;
  var current = this._current;
  var tmp = this._tmp;

  tmp.yaw = Marzipano.util.degToRad(data.alpha);
  tmp.pitch = Marzipano.util.degToRad(data.beta);
  tmp.roll = Marzipano.util.degToRad(data.gamma);
  rotateEuler(tmp, current);

  this._getPitchCallbacks.forEach(function(callback) {
    callback(null, current.pitch);
  });
  this._getPitchCallbacks.length = 0;

  if (previous.yaw != null && previous.pitch != null && previous.roll != null) {
    this._dynamics.yaw.offset = -(current.yaw - previous.yaw);
    this._dynamics.pitch.offset = current.pitch - previous.pitch;
    this.emit('parameterDynamics', 'yaw', this._dynamics.yaw);
    this.emit('parameterDynamics', 'pitch', this._dynamics.pitch);
  }

  previous.yaw = current.yaw;
  previous.pitch = current.pitch;
  previous.roll = current.roll;
};

function rotateEuler(euler, result) {
  var heading, bank, attitude;
  var ch = Math.cos(euler.yaw);
  var sh = Math.sin(euler.yaw);
  var ca = Math.cos(euler.pitch);
  var sa = Math.sin(euler.pitch);
  var cb = Math.cos(euler.roll);
  var sb = Math.sin(euler.roll);

  var matrix = [
    sh * sb - ch * sa * cb, -ch * ca, ch * sa * sb + sh * cb,
    ca * cb, -sa, -ca * sb,
    sh * sa * cb + ch * sb, sh * ca, -sh * sa * sb + ch * cb
  ];

  if (matrix[3] > 0.9999) {
    heading = Math.atan2(matrix[2], matrix[8]);
    attitude = Math.PI / 2;
    bank = 0;
  } else if (matrix[3] < -0.9999) {
    heading = Math.atan2(matrix[2], matrix[8]);
    attitude = -Math.PI / 2;
    bank = 0;
  } else {
    heading = Math.atan2(-matrix[6], matrix[0]);
    bank = Math.atan2(-matrix[5], matrix[4]);
    attitude = Math.asin(matrix[3]);
  }

  result.yaw = heading;
  result.pitch = attitude;
  result.roll = bank;
}
