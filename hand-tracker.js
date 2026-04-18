/**
 * hand-tracker.js
 * Manages MediaPipe Hands initialization, webcam feed, and gesture recognition.
 * Exports a singleton HandTracker that emits processed hand data each frame.
 */

// eslint-disable-next-line no-unused-vars
class HandTracker {
  /** Gesture constants */
  static GESTURE = {
    NONE: 'none',
    DRAW: 'draw',        // index finger extended
    ERASE: 'erase',      // index + middle extended
    COLOR: 'color',      // index + middle + ring extended
    PAUSE: 'pause',      // closed fist
    CLEAR: 'clear',      // open palm (all fingers extended)
  };

  constructor() {
    this.hands = null;
    this.camera = null;
    this.videoEl = null;
    this.isReady = false;
    this.onResults = null; // callback: (results) => void
    this._lastResults = null;
  }

  /**
   * Initialize MediaPipe Hands and start the camera.
   * @param {HTMLVideoElement} videoEl
   * @param {Function} onResults - callback receiving processed hand data
   * @param {Function} onStatusUpdate - callback for loading status messages
   */
  async init(videoEl, onResults, onStatusUpdate) {
    this.videoEl = videoEl;
    this.onResults = onResults;

    // Check if MediaPipe libraries are loaded
    if (typeof window.Hands === 'undefined') {
      throw new Error('MediaPipe Hands library not loaded. Check CDN connection.');
    }
    if (typeof window.Camera === 'undefined') {
      throw new Error('MediaPipe Camera library not loaded. Check CDN connection.');
    }

    onStatusUpdate?.('Configuring hand detection model...');

    // Create MediaPipe Hands instance
    this.hands = new window.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    this.hands.onResults((results) => this._processResults(results));

    onStatusUpdate?.('Starting camera...');

    // Start camera using MediaPipe camera utils
    this.camera = new window.Camera(videoEl, {
      onFrame: async () => {
        if (this.hands) {
          await this.hands.send({ image: videoEl });
        }
      },
      width: 1280,
      height: 720,
    });

    await this.camera.start();
    this.isReady = true;
    onStatusUpdate?.('Hand tracking active');
  }

  /**
   * Process raw MediaPipe results into structured hand data.
   */
  _processResults(results) {
    const processed = {
      hands: [],
      timestamp: performance.now(),
    };

    if (results.multiHandLandmarks && results.multiHandedness) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i];
        const gesture = this._recognizeGesture(landmarks);
        const indexTip = landmarks[8]; // INDEX_FINGER_TIP

        processed.hands.push({
          landmarks,
          handedness: handedness.label, // 'Left' or 'Right'
          gesture,
          indexTip: { x: indexTip.x, y: indexTip.y, z: indexTip.z },
          confidence: handedness.score,
        });
      }
    }

    this._lastResults = processed;
    this.onResults?.(processed);
  }

  /**
   * Recognize gesture from hand landmarks.
   * Uses finger tip vs PIP joint y-position comparison (screen coords: y increases downward).
   * @param {Array} landmarks - 21 hand landmarks
   * @returns {string} gesture name
   */
  _recognizeGesture(landmarks) {
    const dominated = this._getFingerStates(landmarks);
    const { thumb, index, middle, ring, pinky } = dominated;

    // Open palm: all fingers extended
    if (thumb && index && middle && ring && pinky) {
      return HandTracker.GESTURE.CLEAR;
    }

    // Three fingers: index + middle + ring (not pinky)
    if (index && middle && ring && !pinky) {
      return HandTracker.GESTURE.COLOR;
    }

    // Two fingers: index + middle (peace sign)
    if (index && middle && !ring && !pinky) {
      return HandTracker.GESTURE.ERASE;
    }

    // One finger: only index extended
    if (index && !middle && !ring && !pinky) {
      return HandTracker.GESTURE.DRAW;
    }

    // Closed fist: no fingers extended
    if (!index && !middle && !ring && !pinky) {
      return HandTracker.GESTURE.PAUSE;
    }

    return HandTracker.GESTURE.NONE;
  }

  /**
   * Determine which fingers are extended.
   * Compares fingertip y to PIP joint y (for fingers) and IP joint for thumb.
   */
  _getFingerStates(lm) {
    // Thumb: compare tip (4) x to IP (3) x relative to wrist
    // For mirrored video, we check based on hand orientation
    const wristX = lm[0].x;
    const thumbTipX = lm[4].x;
    const thumbIPX = lm[3].x;
    // Thumb is extended if tip is further from wrist than IP joint
    const thumb = Math.abs(thumbTipX - wristX) > Math.abs(thumbIPX - wristX);

    // Other fingers: tip y < PIP y means extended (screen coords, y goes down)
    const index = lm[8].y < lm[6].y;
    const middle = lm[12].y < lm[10].y;
    const ring = lm[16].y < lm[14].y;
    const pinky = lm[20].y < lm[18].y;

    return { thumb, index, middle, ring, pinky };
  }

  /** Get the last processed results */
  getLastResults() {
    return this._lastResults;
  }

  /** Stop tracking */
  stop() {
    this.camera?.stop();
    this.isReady = false;
  }
}