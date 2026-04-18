/**
 * script.js
 * Main entry point — initializes all modules, runs the render loop,
 * and orchestrates gesture → action mapping.
 */

(function () {
  'use strict';

  // ===== DOM Elements =====
  const videoEl = document.getElementById('webcam');
  const bgCanvas = document.getElementById('bg-canvas');
  const drawingCanvas = document.getElementById('drawing-canvas');
  const uiCanvasEl = document.getElementById('ui-canvas');

  // ===== Module Instances =====
  const tracker = new HandTracker();
  const engine = new DrawingEngine(drawingCanvas, bgCanvas);
  const ui = new UIController(uiCanvasEl);

  // ===== App State =====
  const COLORS = [
    '#00f0ff', '#ff00ff', '#00ff88', '#ff6600',
    '#aa00ff', '#ff0044', '#ffff00', '#ff69b4',
    '#00ffcc', '#7b68ee', '#ffffff', '#ff4500',
  ];
  let currentGesture = 'none';
  let prevGesture = 'none';
  let gestureHoldTime = 0;
  let lastGestureTimestamp = 0;
  const CLEAR_HOLD_MS = 800;
  let colorCycleDebounce = 0;
  const COLOR_CYCLE_COOLDOWN = 600;
  let wasDrawing = false;

  // ===== Initialization =====
  async function init() {
    ui.init();
    engine.init();

    // Bind UI button events
    bindUIEvents();

    // Always show the UI first
    ui.updateGesture('none');
    ui.updateHandStatus(0);
    ui.updateActiveColor(COLORS[0]);
    ui.updateActiveTool('brush');

    // Start render loop immediately
    requestAnimationFrame(renderLoop);

    // Show permission overlay to ask for camera access
    ui.showPermissionOverlay();
    document.getElementById('btn-grant-camera').addEventListener('click', async () => {
      ui.hidePermissionOverlay();
      ui.setLoadingStatus('Starting camera...');
      document.getElementById('loading-overlay').style.display = 'flex';
      document.getElementById('loading-overlay').classList.remove('fade-out');
      try {
        await tracker.init(
          videoEl,
          onHandResults,
          (status) => ui.setLoadingStatus(status)
        );
        ui.hideLoading();
        ui.showToast('Hand tracking active! Show your hand to start drawing.');
      } catch (err) {
        console.error('Camera/tracking init failed:', err);
        ui.hideLoading();
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          ui.showPermissionOverlay();
        } else {
          ui.showToast('Camera unavailable. Use mouse/touch to draw.');
          enableMouseFallback();
        }
      }
    });
  }

  // ===== Mouse/Touch Fallback =====
  function enableMouseFallback() {
    let isMouseDown = false;

    drawingCanvas.style.pointerEvents = 'auto';
    drawingCanvas.style.cursor = 'crosshair';
    drawingCanvas.style.zIndex = '5';

    drawingCanvas.addEventListener('mousedown', (e) => {
      isMouseDown = true;
      ui.updateGesture('draw');
      // For accurate positioning, use pixel coords directly
      const rect = drawingCanvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      engine.addDrawPoint(px, py, performance.now(), false, false);
    });

    drawingCanvas.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      const rect = drawingCanvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      engine.addDrawPoint(px, py, performance.now(), false, false);
    });

    drawingCanvas.addEventListener('mouseup', () => {
      isMouseDown = false;
      engine.endStroke();
      ui.updateGesture('none');
    });

    drawingCanvas.addEventListener('mouseleave', () => {
      if (isMouseDown) {
        isMouseDown = false;
        engine.endStroke();
        ui.updateGesture('none');
      }
    });

    // Touch support
    drawingCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isMouseDown = true;
      ui.updateGesture('draw');
      const touch = e.touches[0];
      const rect = drawingCanvas.getBoundingClientRect();
      const px = touch.clientX - rect.left;
      const py = touch.clientY - rect.top;
      engine.addDrawPoint(px, py, performance.now(), false, false);
    }, { passive: false });

    drawingCanvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!isMouseDown) return;
      const touch = e.touches[0];
      const rect = drawingCanvas.getBoundingClientRect();
      const px = touch.clientX - rect.left;
      const py = touch.clientY - rect.top;
      engine.addDrawPoint(px, py, performance.now(), false, false);
    }, { passive: false });

    drawingCanvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      isMouseDown = false;
      engine.endStroke();
      ui.updateGesture('none');
    }, { passive: false });
  }

  // ===== Hand Results Callback =====
  function onHandResults(results) {
    const now = results.timestamp;
    const handCount = results.hands.length;

    ui.updateHandStatus(handCount);

    if (handCount === 0) {
      if (wasDrawing) {
        engine.endStroke();
        wasDrawing = false;
      }
      currentGesture = 'none';
      ui.updateGesture('none');
      ui.clearTrail();
      return;
    }

    const primaryHand = results.hands[0];
    const gesture = primaryHand.gesture;
    const indexTip = primaryHand.indexTip;

    if (gesture === prevGesture) {
      gestureHoldTime += now - lastGestureTimestamp;
    } else {
      gestureHoldTime = 0;
    }
    lastGestureTimestamp = now;
    prevGesture = gesture;
    currentGesture = gesture;

    ui.updateGesture(gesture);
    ui.drawHandOverlay(results.hands, engine.getShapePreview());

    switch (gesture) {
      case HandTracker.GESTURE.DRAW:
        engine.addDrawPoint(indexTip.x, indexTip.y, now, true, true);
        wasDrawing = true;
        break;

      case HandTracker.GESTURE.ERASE:
        if (wasDrawing) {
          engine.endStroke();
          wasDrawing = false;
        }
        engine.eraseAt(indexTip.x, indexTip.y, true, true);
        break;

      case HandTracker.GESTURE.COLOR:
        if (wasDrawing) {
          engine.endStroke();
          wasDrawing = false;
        }
        if (now - colorCycleDebounce > COLOR_CYCLE_COOLDOWN) {
          const newColor = engine.cycleColor(COLORS);
          ui.updateActiveColor(newColor);
          ui.showToast(`Color: ${newColor}`);
          colorCycleDebounce = now;
        }
        break;

      case HandTracker.GESTURE.PAUSE:
        if (wasDrawing) {
          engine.endStroke();
          wasDrawing = false;
        }
        break;

      case HandTracker.GESTURE.CLEAR:
        if (wasDrawing) {
          engine.endStroke();
          wasDrawing = false;
        }
        if (gestureHoldTime >= CLEAR_HOLD_MS) {
          engine.clearCanvas();
          ui.showToast('Canvas cleared!');
          gestureHoldTime = 0;
        }
        break;

      default:
        if (wasDrawing) {
          engine.endStroke();
          wasDrawing = false;
        }
        break;
    }

    const stats = engine.getStats();
    ui.updateBrushSize(stats.currentThickness);
  }

  // ===== Render Loop =====
  function renderLoop() {
    ui.updateFPS();

    // Draw shape preview overlay in mouse mode
    if (engine.currentTool !== 'brush' && engine.getShapePreview()) {
      const uiCtx = ui.ctx;
      // Only draw if no hand tracking (mouse mode)
      if (!tracker.isReady || !tracker.getLastResults()?.hands?.length) {
        uiCtx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        uiCtx.drawImage(engine.getShapePreview(), 0, 0);
      }
    }

    requestAnimationFrame(renderLoop);
  }

  // ===== UI Event Bindings =====
  function bindUIEvents() {
    // Color palette clicks
    document.querySelectorAll('.color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        engine.setColor(color);
        ui.updateActiveColor(color);
        ui.showToast(`Color: ${color}`);
      });
    });

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        engine.setTool(tool);
        ui.updateActiveTool(tool);
        ui.showToast(`Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`);
      });
    });

    // Gradient toggle
    document.getElementById('btn-gradient').addEventListener('click', () => {
      const enabled = engine.toggleGradient();
      ui.updateGradientState(enabled);
      ui.showToast(enabled ? 'Gradient brush ON' : 'Gradient brush OFF');
    });

    // Brush size slider
    document.getElementById('brush-slider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      engine.setBaseThickness(val);
      ui.updateBrushSize(val);
    });

    // Action buttons
    document.getElementById('btn-undo').addEventListener('click', () => {
      if (engine.undo()) {
        ui.showToast('Undo');
      } else {
        ui.showToast('Nothing to undo');
      }
    });

    document.getElementById('btn-redo').addEventListener('click', () => {
      if (engine.redo()) {
        ui.showToast('Redo');
      } else {
        ui.showToast('Nothing to redo');
      }
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      engine.clearCanvas();
      ui.showToast('Canvas cleared!');
    });

    document.getElementById('btn-save-png').addEventListener('click', () => {
      engine.savePNG();
      ui.showToast('Saved as PNG!');
    });

    document.getElementById('btn-save-svg').addEventListener('click', () => {
      engine.saveSVG();
      ui.showToast('Exported as SVG!');
    });
  }

  // ===== Start App =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();