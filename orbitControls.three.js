/* global window */
/* global document */

/**
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 */
/**
 * ecma6 shimming for savant by ams
 */

// This set of controls performs orbiting, dollying (zooming), and panning.
// Unlike TrackballControls, it maintains the "up" direction object.up (+Y by default).
// // Orbit - left mouse / touch: one finger move
// // Zoom - middle mouse, or mousewheel / touch: two finger spread or squish
// // Pan - right mouse, or arrow keys / touch: Three finger swipe

import * as Three from 'three';

/**
 * internals
 * */
const changeEvent = { type: 'change' };
const startEvent = { type: 'start' };
const endEvent = { type: 'end' };

// current position in spherical coordinates
const EPS = 0.000001;
const spherical = new Three.Spherical();
const sphericalDelta = new Three.Spherical();
const panOffset = new Three.Vector3();
const rotateStart = new Three.Vector2();
const rotateEnd = new Three.Vector2();
const rotateDelta = new Three.Vector2();
const panStart = new Three.Vector2();
const panEnd = new Three.Vector2();
const panDelta = new Three.Vector2();
const dollyStart = new Three.Vector2();
const dollyEnd = new Three.Vector2();
const dollyDelta = new Three.Vector2();

const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_DOLLY: 4, TOUCH_PAN: 5 };
let scale = 1;
let state = STATE.NONE;
let zoomChanged = false;


class OrbitControls extends Three.EventDispatcher {
  constructor(object, domElement) {
    super();

    this.object = object;
    this.domElement = (domElement !== undefined) ? domElement : document;

    // Set to false to disable this control
    this.enabled = true;

    // "target" sets the location of focus, where the object orbits around
    this.target = new Three.Vector3();

    // How far you can dolly in and out ( PerspectiveCamera only )
    this.minDistance = 0;
    this.maxDistance = Infinity;

    // How far you can zoom in and out ( OrthographicCamera only )
    this.minZoom = 0;
    this.maxZoom = Infinity;

    // How far you can orbit vertically, upper and lower limits.
    // // Range is 0 to Math.PI radians.
    this.minPolarAngle = 0; // radians
    this.maxPolarAngle = Math.PI; // radians

    // How far you can orbit horizontally, upper and lower limits.
    // // If set, must be a sub-interval of the interval [ - Math.PI, Math.PI ].
    this.minAzimuthAngle = -Infinity; // radians
    this.maxAzimuthAngle = Infinity; // radians

    // Set to true to enable damping (inertia)
    // // If damping is enabled, you must call controls.update() in your animation loop
    this.enableDamping = false;
    this.dampingFactor = 0.25;

    // This option actually enables dollying in and out; left as "zoom" for backwards compatibility.
    // // Set to false to disable zooming
    this.enableZoom = true;
    this.zoomSpeed = 1.0;

    // Set to false to disable rotating
    this.enableRotate = true;
    this.rotateSpeed = 1.0;

    // Set to false to disable panning
    this.enablePan = true;
    // pixels moved per arrow key push
    this.keyPanSpeed = 7.0;

    // Set to true to automatically rotate around the target
    // If auto-rotate is enabled, you must call controls.update() in your animation loop
    this.autoRotate = false;
    this.autoRotateSpeed = 2.0; // 30 seconds per round when fps is 60

    // Set to false to disable use of the keys
    this.enableKeys = true;

    // The four arrow keys
    this.keys = { LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 };

    // Mouse buttons
    this.mouseButtons = {
      ORBIT: Three.MOUSE.LEFT,
      ZOOM: Three.MOUSE.MIDDLE,
      PAN: Three.MOUSE.RIGHT,
    };

    // for reset
    this.target0 = this.target.clone();
    this.position0 = this.object.position.clone();
    this.zoom0 = this.object.zoom;

    this.onContextMenu = this.onContextMenu.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    this.domElement.addEventListener('contextmenu', this.onContextMenu, false);
    this.domElement.addEventListener('mousedown', this.onMouseDown, false);
    this.domElement.addEventListener('wheel', this.onMouseWheel, false);
    this.domElement.addEventListener('touchstart', this.onTouchStart, false);
    this.domElement.addEventListener('touchend', this.onTouchEnd, false);
    this.domElement.addEventListener('touchmove', this.domElement, false);

    // TODO: will window be available in a react execution? dunno
    window.addEventListener('keydown', this.onKeyDown, false);

    // force an update at start
    this.update();
  }

  saveState() {
    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  reset() {
    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.zoom = this.zoom0;

    this.object.updateProjectionMatrix();
    this.dispatchEvent(changeEvent);

    this.update();

    state = STATE.NONE;
  }

  update() {
    const offset = new Three.Vector3();

    // camera.up is the orbit axis
    const quat = new Three.Quaternion().setFromUnitVectors(this.object.up, new Three.Vector3(0, 1, 0));
    const quatInverse = quat.clone().inverse();
    const lastPosition = new Three.Vector3();
    const lastQuaternion = new Three.Quaternion();
    const position = this.object.position;

    offset.copy(position).sub(this.target);
    // rotate offset to "y-axis-is-up" space
    offset.applyQuaternion(quat);

    // angle from z-axis around y-axis
    spherical.setFromVector3(offset);

    if (this.autoRotate && state === STATE.NONE) {
      this.rotateLeft(this.getAutoRotationAngle());
    }

    spherical.theta += sphericalDelta.theta;
    spherical.phi += sphericalDelta.phi;

    // restrict theta to be between desired limits
    spherical.theta = Math.max(this.minAzimuthAngle, Math.min(this.maxAzimuthAngle, spherical.theta));

    // restrict phi to be between desired limits
    spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, spherical.phi));
    spherical.makeSafe();
    spherical.radius *= scale;

    // restrict radius to be between desired limits
    spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, spherical.radius));

    // move target to panned location
    this.target.add(panOffset);

    offset.setFromSpherical(spherical);
    // rotate offset back to "camera-up-vector-is-up" space
    offset.applyQuaternion(quatInverse);

    position.copy(this.target).add(offset);
    this.object.lookAt(this.target);

    if (this.enableDamping === true) {
      sphericalDelta.theta *= (1 - this.dampingFactor);
      sphericalDelta.phi *= (1 - this.dampingFactor);
    } else {
      sphericalDelta.set(0, 0, 0);
    }

    scale = 1;
    panOffset.set(0, 0, 0);

    /**
     * update condition is:
     * min(camera displacement, camera rotation in radians)^2 > EPS
     * using small-angle approximation cos(x/2) = 1 - x^2 / 8
     * */
    if (zoomChanged ||
      lastPosition.distanceToSquared(this.object.position) > EPS ||
      8 * ( 1 - lastQuaternion.dot(this.object.quaternion) ) > EPS) {

      this.dispatchEvent(changeEvent);

      lastPosition.copy(this.object.position);
      lastQuaternion.copy(this.object.quaternion);
      zoomChanged = false;
      return true;
    }

    return false;
  }

  getPolarAngle() {
    return this.spherical.phi;
  }

  getAzimuthalAngle() {
    return spherical.theta;
  }

  dispose() {
    // TODO see other comment about window scope w
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.domElement.removeEventListener('wheel', this.onMouseWheel);

    this.domElement.removeEventListener('touchstart', this.onTouchStart);
    this.domElement.removeEventListener('touchend', this.onTouchEnd);
    this.domElement.removeEventListener('touchmove', this.onTouchMove);

    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);

    window.removeEventListener('keydown', this.onKeyDown);
  }

  /**
   * EVENT CALLBACKS
   */
  handleMouseDownRotate(event) {
    // console.log( 'handleMouseDownRotate' );
    rotateStart.set(event.clientX, event.clientY);
  }

  handleMouseDownDolly(event) {
    // console.log( 'handleMouseDownDolly' );
    dollyStart.set(event.clientX, event.clientY);
  }

  handleMouseDownPan(event) {
    // console.log( 'handleMouseDownPan' );
    panStart.set(event.clientX, event.clientY);
  }

  handleMouseMoveRotate(event) {
    // console.log( 'handleMouseMoveRotate' );
    rotateEnd.set(event.clientX, event.clientY);
    rotateDelta.subVectors(rotateEnd, rotateStart);

    var element = this.domElement === document ? this.domElement.body : this.domElement;

    // rotating across whole screen goes 360 degrees around
    this.rotateLeft(2 * Math.PI * rotateDelta.x / element.clientWidth * this.rotateSpeed);

    // rotating up and down along whole screen attempts to go 360, but limited to 180
    this.rotateUp(2 * Math.PI * rotateDelta.y / element.clientHeight * this.rotateSpeed);

    rotateStart.copy(rotateEnd);
    this.update();
  }

  handleMouseMoveDolly(event) {
    // console.log( 'handleMouseMoveDolly' );
    dollyEnd.set(event.clientX, event.clientY);
    dollyDelta.subVectors(dollyEnd, dollyStart);

    if (dollyDelta.y > 0) {
      this.dollyIn(this.getZoomScale());
    } else if (dollyDelta.y < 0) {
      this.dollyOut(this.getZoomScale());
    }

    dollyStart.copy(dollyEnd);
    this.update();
  }

  handleMouseMovePan(event) {
    // console.log( 'handleMouseMovePan' );
    panEnd.set(event.clientX, event.clientY);
    panDelta.subVectors(panEnd, panStart);

    pan(panDelta.x, panDelta.y);
    panStart.copy(panEnd);
    this.update();
  }

  handleMouseUp(event) {
    // console.log( 'handleMouseUp' );
  }

  handleMouseWheel(event) {
    // console.log( 'handleMouseWheel' );
    if (event.deltaY < 0) {
      this.dollyOut(this.getZoomScale());
    } else if (event.deltaY > 0) {
      this.dollyIn(this.getZoomScale());
    }

    this.update();
  }

  handleKeyDown(event) {
    // console.log( 'handleKeyDown' );
    switch (event.keyCode) {
      case this.keys.UP:
        this.pan(0, this.keyPanSpeed);
        this.update();
        break;
      case this.keys.BOTTOM:
        this.pan(0, -this.keyPanSpeed);
        this.update();
        break;
      case this.keys.LEFT:
        this.pan(this.keyPanSpeed, 0);
        this.update();
        break;
      case this.keys.RIGHT:
        this.pan(-this.keyPanSpeed, 0);
        this.update();
        break;
      default:
        break;
    }
  }

  handleTouchStartRotate(event) {
    // console.log( 'handleTouchStartRotate' );
    rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
  }

  handleTouchStartDolly(event) {
    // console.log( 'handleTouchStartDolly' );
    var dx = event.touches[0].pageX - event.touches[1].pageX;
    var dy = event.touches[0].pageY - event.touches[1].pageY;
    var distance = Math.sqrt(dx * dx + dy * dy);

    dollyStart.set(0, distance);
  }

  handleTouchStartPan(event) {
    // console.log( 'handleTouchStartPan' );
    panStart.set(event.touches[0].pageX, event.touches[0].pageY);
  }

  handleTouchMoveRotate(event) {
    // console.log( 'handleTouchMoveRotate' );
    this.rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
    this.rotateDelta.subVectors(rotateEnd, rotateStart);

    const element = this.domElement === document ? this.domElement.body : this.domElement;

    // rotating across whole screen goes 360 degrees around
    this.rotateLeft((2 * Math.PI * rotateDelta.x) / (element.clientWidth * this.rotateSpeed));

    // rotating up and down along whole screen attempts to go 360, but limited to 180
    this.rotateUp((2 * Math.PI * rotateDelta.y) / (element.clientHeight * this.rotateSpeed));

    this.rotateStart.copy(rotateEnd);
    this.update();
  }

  handleTouchMoveDolly(event) {
    // console.log( 'handleTouchMoveDolly' );
    const dx = event.touches[0].pageX - event.touches[1].pageX;
    const dy = event.touches[0].pageY - event.touches[1].pageY;
    const distance = Math.sqrt((dx * dx) + (dy * dy));
    dollyEnd.set(0, distance);
    dollyDelta.subVectors(dollyEnd, dollyStart);

    if (dollyDelta.y > 0) {
      this.dollyOut(this.getZoomScale());
    } else if (dollyDelta.y < 0) {
      this.dollyIn(this.getZoomScale());
    }

    dollyStart.copy(dollyEnd);
    this.update();
  }

  handleTouchMovePan(event) {
    // console.log( 'handleTouchMovePan' );
    panEnd.set(event.touches[0].pageX, event.touches[0].pageY);
    panDelta.subVectors(panEnd, panStart);

    pan(panDelta.x, panDelta.y);

    panStart.copy(panEnd);
    this.update();
  }

  handleTouchEnd(event) {
    // console.log( 'handleTouchEnd' );
  }

  /**
   * CAMERA MOVMENTS
   */
  getAutoRotationAngle() {
    return (2 * (Math.PI / 60)) / (60 * this.autoRotateSpeed);
  }

  getZoomScale() {
    return Math.pow(0.95, this.zoomSpeed);
  }

  rotateLeft(angle) {
    sphericalDelta.theta -= angle;
  }

  rotateUp(angle) {
    sphericalDelta.phi -= angle;
  }

  panLeft(distance, objectMatrix) {
    const v = new Three.Vector3();

    v.setFromMatrixColumn(objectMatrix, 0); // get X column of objectMatrix
    v.multiplyScalar(-distance);

    panOffset.add(v);
  }

  panUp(distance, objectMatrix) {
    const v = new Three.Vector3();

    v.setFromMatrixColumn(objectMatrix, 1); // get Y column of objectMatrix
    v.multiplyScalar(distance);

    panOffset.add(v);
  }

  // deltaX and deltaY are in pixels; right and down are positive
  pan(deltaX, deltaY) {
    const offset = new Three.Vector3();

    const element = this.domElement === document ? this.domElement.body : this.domElement;

    if (this.object instanceof Three.PerspectiveCamera) {
      // perspective
      const position = this.object.position;
      offset.copy(position).sub(this.target);
      let targetDistance = offset.length();

      // half of the fov is center to top of screen
      targetDistance *= Math.tan(((this.object.fov / 2) * Math.PI) / 180.0);

      // we actually don't use screenWidth, since perspective camera is fixed to screen height
      this.panLeft((2 * deltaX * targetDistance) / element.clientHeight, this.object.matrix);
      this.panUp((2 * deltaY * targetDistance) / element.clientHeight, this.object.matrix);
    } else if (this.object instanceof Three.OrthographicCamera) {
      // orthographic
      this.panLeft((deltaX * (this.object.right - this.object.left)) / this.object.zoom / element.clientWidth, this.object.matrix);
      this.panUp((deltaY * (this.object.top - this.object.bottom)) / this.object.zoom / element.clientHeight, this.object.matrix);
    } else {
      // camera neither orthographic nor perspective
      console.warn('WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.');
      this.enablePan = false;
    }
  }

  dollyIn(dollyScale) {
    if (this.object instanceof Three.PerspectiveCamera) {
      scale /= dollyScale;
    } else if (this.object instanceof Three.OrthographicCamera) {
      this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom * dollyScale));
      this.object.updateProjectionMatrix();
      zoomChanged = true;
    } else {
      console.warn('WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.');
      this.enableZoom = false;
    }
  }

  dollyOut(dollyScale) {
    if (this.object instanceof Three.PerspectiveCamera) {
      scale *= dollyScale;
    } else if (this.object instanceof Three.OrthographicCamera) {
      this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / dollyScale));
      this.object.updateProjectionMatrix();
      zoomChanged = true;
    } else {
      console.warn('WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.');
      this.enableZoom = false;
    }
  }

  /**
   * event handlers - FSM: listen for events and reset state
   */
  onMouseDown(event) {
    if (this.enabled === false) return;
    event.preventDefault();

    switch (event.button) {
      case this.mouseButtons.ORBIT:
        if (this.enableRotate === false) return;
        this.handleMouseDownRotate(event);
        state = STATE.ROTATE;
        break;

      case this.mouseButtons.ZOOM:
        if (this.enableZoom === false) return;
        this.handleMouseDownDolly(event);
        state = STATE.DOLLY;
        break;

      case this.mouseButtons.PAN:
        if (this.enablePan === false) return;
        this.handleMouseDownPan(event);
        state = STATE.PAN;
        break;

      default:
        break;
    }

    if (state !== STATE.NONE) {
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
      this.dispatchEvent(startEvent);
    }
  }

  onMouseMove(event) {
    if (this.enabled === false) return;
    event.preventDefault();

    switch (state) {
      case STATE.ROTATE:
        if (this.enableRotate === false) return;
        this.handleMouseMoveRotate(event);
        break;

      case STATE.DOLLY:
        if (this.enableZoom === false) return;
        this.handleMouseMoveDolly(event);
        break;

      case STATE.PAN:
        if (this.enablePan === false) return;
        this.handleMouseMovePan(event);
        break;
      default:
        break;
    }
  }

  onMouseUp(event) {
    if (this.enabled === false) return;
    this.handleMouseUp(event);

    document.removeEventListener('mousemove', this.onMouseMove, false);
    document.removeEventListener('mouseup', this.onMouseUp, false);

    this.dispatchEvent(endEvent);
    state = STATE.NONE;
  }

  onMouseWheel(event) {
    if (this.enabled === false || this.enableZoom === false || (state !== STATE.NONE && state !== STATE.ROTATE)) return;

    event.preventDefault();
    event.stopPropagation();

    this.handleMouseWheel(event);

    this.dispatchEvent(startEvent); // not sure why these are here...
    this.dispatchEvent(endEvent);
  }

  onKeyDown(event) {
    if (this.enabled === false || this.enableKeys === false || this.enablePan === false) return;
    this.handleKeyDown(event);
  }

  onTouchStart(event) {
    if (this.enabled === false) return;

    switch (event.touches.length) {
      // one-fingered touch: rotate
      case 1:
        if (this.enableRotate === false) return;
        this.handleTouchStartRotate(event);
        state = STATE.TOUCH_ROTATE;
        break;
      // two-fingered touch: dolly
      case 2:
        if (this.enableZoom === false) return;
        this.handleTouchStartDolly(event);
        state = STATE.TOUCH_DOLLY;
        break;
      // Three-fingered touch: pan
      case 3:
        if (this.enablePan === false) return;
        this.handleTouchStartPan(event);
        state = STATE.TOUCH_PAN;
        break;
      // meh
      default:
        state = STATE.NONE;
        break;
    }

    if (state !== STATE.NONE) {
      this.dispatchEvent(startEvent);
    }
  }

  onTouchMove(event) {
    if (this.enabled === false) return;

    event.preventDefault();
    event.stopPropagation();

    switch (event.touches.length) {
      case 1: // one-fingered touch: rotate
        if (this.enableRotate === false) return;
        if (state !== STATE.TOUCH_ROTATE) return; // is this needed?...
        this.handleTouchMoveRotate(event);
        break;

      case 2: // two-fingered touch: dolly
        if (this.enableZoom === false) return;
        if (state !== STATE.TOUCH_DOLLY) return; // is this needed?...
        this.handleTouchMoveDolly(event);
        break;

      case 3: // Three-fingered touch: pan
        if (this.enablePan === false) return;
        if (state !== STATE.TOUCH_PAN) return; // is this needed?...
        this.handleTouchMovePan(event);
        break;

      default:
        state = STATE.NONE;
        break;
    }
  }

  onTouchEnd(event) {
    if (this.enabled === false) return;

    this.handleTouchEnd(event);

    this.dispatchEvent(endEvent);
    state = STATE.NONE;
  }

  onContextMenu(event) {
    if (this.enabled === false) return;

    event.preventDefault();
  }
}

export default OrbitControls;
