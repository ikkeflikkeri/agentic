import * as THREE from 'three';

const INTRO_DURATION = 9.0;

function smootherstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Cinematic camera: an eased spline fly-in, then a damped orbit rig with mouse
 * parallax and optional free-look. Nothing snaps; every value is eased.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;

    this.home = { yaw: 0, pitch: 0.52, distance: 150 };
    this.state = { yaw: this.home.yaw, pitch: this.home.pitch, distance: this.home.distance };
    this.targetState = { ...this.state };
    this.lookTarget = new THREE.Vector3(0, 0, 0);

    this.mouse = new THREE.Vector2(0, 0);
    this.mouseDamped = new THREE.Vector2(0, 0);

    this.intro = { progress: 0, done: false, skipping: false };

    const home = this._spherical(this.home.yaw, this.home.pitch, this.home.distance);
    this._control = [
      new THREE.Vector3(0, -150, 1450),
      new THREE.Vector3(520, 340, 1120),
      new THREE.Vector3(-600, 210, 690),
      new THREE.Vector3(210, 92, 350),
      home.clone()
    ];
    this._curve = new THREE.CatmullRomCurve3(this._control, false, 'catmullrom', 0.6);
    this._lookStart = new THREE.Vector3(0, 130, -140);

    this._current = this._curve.getPoint(0);
    this._desired = this._current.clone();
    this._currentLook = this._lookStart.clone();
    this._desiredLook = this._lookStart.clone();

    this._right = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._forward = new THREE.Vector3(0, 0, -1);
    this._worldUp = new THREE.Vector3(0, 1, 0);

    camera.position.copy(this._current);
    camera.lookAt(this._currentLook);
  }

  _spherical(yaw, pitch, distance) {
    const cp = Math.cos(pitch);
    return new THREE.Vector3(
      distance * cp * Math.sin(yaw),
      distance * Math.sin(pitch),
      distance * cp * Math.cos(yaw)
    );
  }

  /** Pointer parallax input, in normalized device coordinates (-1..1). */
  setPointer(x, y) {
    this.mouse.set(
      Math.max(-1, Math.min(1, x)),
      Math.max(-1, Math.min(1, y))
    );
  }

  /** Free-look delta (already in radians). */
  look(dx, dy) {
    this.targetState.yaw -= dx;
    this.targetState.pitch = Math.max(-1.15, Math.min(1.3, this.targetState.pitch - dy));
  }

  zoom(delta) {
    this.targetState.distance = Math.max(70, Math.min(420, this.targetState.distance + delta));
  }

  skipIntro() {
    if (!this.intro.done) this.intro.skipping = true;
  }

  get isIntroDone() {
    return this.intro.done;
  }

  update(dt) {
    // Damp parallax.
    this.mouseDamped.x = damp(this.mouseDamped.x, this.mouse.x, 2.6, dt);
    this.mouseDamped.y = damp(this.mouseDamped.y, this.mouse.y, 2.6, dt);

    // Damp orbit state toward its target.
    this.state.yaw = damp(this.state.yaw, this.targetState.yaw, 4.5, dt);
    this.state.pitch = damp(this.state.pitch, this.targetState.pitch, 4.5, dt);
    this.state.distance = damp(this.state.distance, this.targetState.distance, 3.5, dt);

    let orbit = this._spherical(this.state.yaw, this.state.pitch, this.state.distance);

    if (!this.intro.done) {
      const advance = this.intro.skipping ? 3.4 : 1.0;
      this.intro.progress = Math.min(1, this.intro.progress + (dt / INTRO_DURATION) * advance);
      const eased = smootherstep(this.intro.progress);

      const p = this._curve.getPoint(eased);
      const look = this._lookStart.clone().lerp(new THREE.Vector3(0, 0, 0), smootherstep(eased * 1.15));

      this._desired.copy(p);
      this._desiredLook.copy(look);

      if (this.intro.progress >= 1) {
        this.intro.done = true;
        this.state.yaw = this.home.yaw;
        this.state.pitch = this.home.pitch;
        this.state.distance = this.home.distance;
        this.targetState.yaw = this.home.yaw;
        this.targetState.pitch = this.home.pitch;
        this.targetState.distance = this.home.distance;
      }
    } else {
      this._forward.copy(orbit).multiplyScalar(-1).normalize();
      this._right.copy(this._forward).cross(this._worldUp).normalize();
      this._up.copy(this._right).cross(this._forward).normalize();

      this._desired.copy(orbit)
        .addScaledVector(this._right, this.mouseDamped.x * 9.0)
        .addScaledVector(this._up, this.mouseDamped.y * 5.5);

      this._desiredLook.set(0, 0, 0)
        .addScaledVector(this._right, this.mouseDamped.x * 3.2)
        .addScaledVector(this._up, this.mouseDamped.y * 2.0);
    }

    const posLambda = this.intro.done ? 5.5 : 12.0;
    const lookLambda = this.intro.done ? 5.5 : 12.0;
    this._current.x = damp(this._current.x, this._desired.x, posLambda, dt);
    this._current.y = damp(this._current.y, this._desired.y, posLambda, dt);
    this._current.z = damp(this._current.z, this._desired.z, posLambda, dt);

    this._currentLook.x = damp(this._currentLook.x, this._desiredLook.x, lookLambda, dt);
    this._currentLook.y = damp(this._currentLook.y, this._desiredLook.y, lookLambda, dt);
    this._currentLook.z = damp(this._currentLook.z, this._desiredLook.z, lookLambda, dt);

    this.camera.position.copy(this._current);
    this.camera.lookAt(this._currentLook);
    this.camera.rotation.z += Math.sin(performance.now() * 0.00013) * 0.006;
  }
}
