/**
 * ui-controller.js
 * Manages the virtual UI panel, gesture feedback, hand landmark rendering,
 * and all UI interactions (color selection, tools, actions, toasts).
 */

// eslint-disable-next-line no-unused-vars
class UIController {
  constructor(uiCanvas) {
    this.canvas = uiCanvas;
    this.ctx = uiCanvas.getContext('2d');

    // UI element references
    this.els = {
      gestureLabel: document.getElementById('gesture-label'),
      modeDisplay: document.getElementById('mode-display'),
      handStatus: document.getElementById('hand-status'),
      fpsCounter: document.getElementById('fps-counter'),
      brushPreview: document.getElementById('brush-preview'),
      brushSizeLabel: document.getElementById('brush-size-label'),
      brushSlider: document.getElementById('brush-slider'),
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingStatus: document.getElementById('loading-status'),
      permissionOverlay: document.getElementById('permission-overlay'),
      btnGrantCamera: document.getElementById('btn-grant-camera'),
      colorPalette: document.getElementById('color-palette'),
      gradientBtn: document.getElementById('btn-gradient'),
      guideItems: document.querySelectorAll('.guide-item'),
      toolButtons: document.querySelectorAll('.tool-btn'),
    };

    // Colors (expanded)
    this.colors = [
      '#00f0ff', '#ff00ff', '#00ff88', '#ff6600',
      '#aa00ff', '#ff0044', '#ffff00', '#ff69b4',
      '#00ffcc', '#7b68ee', '#ffffff', '#ff4500',
    ];
    this.activeColor = this.colors[0];

    // FPS tracking
    this._frameCount = 0;
    this._lastFpsTime = performance.now();
    this._fps = 0;

    // Cursor trail
    this._cursorTrail = [];
    this._maxTrailLength = 12;

    // Toast
    this._toastEl = null;
    this._toastTimeout = null;

    // Gesture label map
    this._gestureLabels = {
      draw: 'DRAWING',
      erase: 'ERASING',
      color: 'COLOR SELECT',
      pause: 'PAUSED',
      clear: 'CLEAR CANVAS',
      none: 'READY',
    };

    this._gestureModeClasses = {
      draw: 'draw',
      erase: 'erase',
      pause: 'pause',
    };

    this._gestureGuideMap = {
      draw: 0,
      erase: 1,
      color: 2,
      pause: 3,
      clear: 4,
    };
  }

  /** Initialize UI, bind events */
  init() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });

    this._createToastElement();
  }

  /** Create reusable toast element */
  _createToastElement() {
    this._toastEl = document.createElement('div');
    this._toastEl.className = 'toast';
    document.body.appendChild(this._toastEl);
  }

  /** Show a toast notification */
  showToast(message, duration = 2000) {
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastEl.textContent = message;
    this._toastEl.classList.add('show');
    this._toastTimeout = setTimeout(() => {
      this._toastEl.classList.remove('show');
    }, duration);
  }

  /** Update FPS counter */
  updateFPS() {
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
      this.els.fpsCounter.textContent = `FPS: ${this._fps}`;
    }
  }

  /** Update gesture display */
  updateGesture(gesture) {
    const label = this._gestureLabels[gesture] || 'READY';
    this.els.gestureLabel.textContent = label;

    this.els.gestureLabel.className = 'gesture-indicator';
    if (gesture === 'draw') this.els.gestureLabel.classList.add('drawing');
    else if (gesture === 'erase') this.els.gestureLabel.classList.add('erasing');
    else if (gesture === 'pause') this.els.gestureLabel.classList.add('paused');

    this.els.modeDisplay.textContent = label;
    this.els.modeDisplay.className = 'mode-box';
    if (this._gestureModeClasses[gesture]) {
      this.els.modeDisplay.classList.add(this._gestureModeClasses[gesture]);
    }

    this.els.guideItems.forEach((item, idx) => {
      item.classList.toggle('active', idx === this._gestureGuideMap[gesture]);
    });
  }

  /** Update hand detection status */
  updateHandStatus(handCount) {
    if (handCount > 0) {
      this.els.handStatus.textContent = `${handCount} HAND${handCount > 1 ? 'S' : ''}`;
      this.els.handStatus.className = 'status-chip online';
    } else {
      this.els.handStatus.textContent = 'NO HANDS';
      this.els.handStatus.className = 'status-chip offline';
    }
  }

  /** Update active color in palette UI */
  updateActiveColor(color) {
    this.activeColor = color;
    const buttons = this.els.colorPalette.querySelectorAll('.color-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color === color);
    });
  }

  /** Update brush size display */
  updateBrushSize(size) {
    this.els.brushSizeLabel.textContent = `${Math.round(size)}px`;
    this.els.brushSlider.value = Math.round(size);
  }

  /** Update active tool in UI */
  updateActiveTool(tool) {
    this.els.toolButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  /** Update gradient button state */
  updateGradientState(enabled) {
    this.els.gradientBtn.classList.toggle('active', enabled);
  }

  /** Draw hand landmarks and cursor on UI canvas */
  drawHandOverlay(hands, shapePreviewCanvas) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw shape preview if available
    if (shapePreviewCanvas) {
      ctx.drawImage(shapePreviewCanvas, 0, 0);
    }

    for (const hand of hands) {
      const { landmarks, gesture, indexTip } = hand;

      this._drawSkeleton(ctx, landmarks, w, h);

      const cx = (1 - indexTip.x) * w;
      const cy = indexTip.y * h;

      this._cursorTrail.push({ x: cx, y: cy, time: performance.now() });
      if (this._cursorTrail.length > this._maxTrailLength) {
        this._cursorTrail.shift();
      }

      this._drawCursorTrail(ctx, gesture);
      this._drawCursor(ctx, cx, cy, gesture);
    }
  }

  /** Draw hand skeleton */
  _drawSkeleton(ctx, landmarks, w, h) {
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17],
    ];

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;

    for (const [i, j] of connections) {
      const x1 = (1 - landmarks[i].x) * w;
      const y1 = landmarks[i].y * h;
      const x2 = (1 - landmarks[j].x) * w;
      const y2 = landmarks[j].y * h;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0, 240, 255, 0.3)';
    for (const lm of landmarks) {
      const x = (1 - lm.x) * w;
      const y = lm.y * h;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** Draw cursor trail */
  _drawCursorTrail(ctx, gesture) {
    if (this._cursorTrail.length < 2) return;

    const color = gesture === 'draw' ? this.activeColor :
                  gesture === 'erase' ? '#ff0044' : '#00f0ff';

    ctx.save();
    for (let i = 1; i < this._cursorTrail.length; i++) {
      const alpha = i / this._cursorTrail.length * 0.4;
      const size = i / this._cursorTrail.length * 3;

      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(this._cursorTrail[i].x, this._cursorTrail[i].y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Draw the main cursor indicator */
  _drawCursor(ctx, x, y, gesture) {
    ctx.save();

    const color = gesture === 'draw' ? this.activeColor :
                  gesture === 'erase' ? '#ff0044' :
                  gesture === 'pause' ? '#ff6600' : '#00f0ff';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.shadowBlur = 0;
    const crossSize = 24;
    ctx.beginPath();
    ctx.moveTo(x - crossSize, y); ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y); ctx.lineTo(x + crossSize, y);
    ctx.moveTo(x, y - crossSize); ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8); ctx.lineTo(x, y + crossSize);
    ctx.stroke();

    if (gesture === 'erase') {
      ctx.strokeStyle = '#ff0044';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /** Hide loading overlay with fade */
  hideLoading() {
    this.els.loadingOverlay.classList.add('fade-out');
    this.els.loadingOverlay.style.animation = 'none';
    setTimeout(() => {
      this.els.loadingOverlay.style.display = 'none';
    }, 600);
  }

  /** Update loading status text */
  setLoadingStatus(text) {
    this.els.loadingStatus.textContent = text;
  }

  /** Show permission overlay */
  showPermissionOverlay() {
    this.els.permissionOverlay.classList.remove('hidden');
    this.els.loadingOverlay.style.display = 'none';
  }

  /** Hide permission overlay */
  hidePermissionOverlay() {
    this.els.permissionOverlay.classList.add('hidden');
  }

  /** Clear cursor trail */
  clearTrail() {
    this._cursorTrail = [];
  }
}