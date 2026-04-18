/**
 * drawing-engine.js
 * Manages the drawing canvas, stroke rendering, brush effects,
 * shapes, gradients, undo/redo history, and export functionality.
 */

// eslint-disable-next-line no-unused-vars
class DrawingEngine {
  constructor(drawingCanvas, bgCanvas) {
    this.canvas = drawingCanvas;
    this.ctx = drawingCanvas.getContext('2d');
    this.bgCanvas = bgCanvas;
    this.bgCtx = bgCanvas.getContext('2d');

    // Drawing state
    this.isDrawing = false;
    this.currentColor = '#00f0ff';
    this.baseThickness = 4;
    this.currentThickness = 4;
    this.maxThickness = 24;
    this.minThickness = 2;

    // Gradient mode
    this.gradientEnabled = false;
    this.gradientColors = ['#00f0ff', '#ff00ff', '#00ff88', '#ff6600'];
    this._gradientOffset = 0;

    // Tool: 'brush', 'line', 'rect', 'circle', 'triangle'
    this.currentTool = 'brush';

    // Shape drawing state
    this._shapeStart = null;
    this._shapePreviewCanvas = null;
    this._shapePreviewCtx = null;

    // Stroke data
    this.currentStroke = null;
    this.strokes = [];       // completed strokes for undo/redo
    this.redoStack = [];

    // Smoothing
    this._prevPoint = null;
    this._prevPrevPoint = null;
    this._prevTimestamp = 0;
    this._velocitySmooth = 0;

    // Eraser
    this.eraserRadius = 30;

    // Background
    this._gridOpacity = 0.1;

    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
  }

  /** Resize canvases to fill viewport */
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Store current image data if canvas has content
    let imgData = null;
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      try {
        imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      } catch (e) {
        // ignore if canvas is empty
      }
    }

    this.canvas.width = w;
    this.canvas.height = h;
    this.bgCanvas.width = w;
    this.bgCanvas.height = h;

    // Setup shape preview canvas
    if (!this._shapePreviewCanvas) {
      this._shapePreviewCanvas = document.createElement('canvas');
      this._shapePreviewCtx = this._shapePreviewCanvas.getContext('2d');
    }
    this._shapePreviewCanvas.width = w;
    this._shapePreviewCanvas.height = h;

    // Restore drawing
    if (imgData) {
      this.ctx.putImageData(imgData, 0, 0);
    }
    this._drawBackground();
  }

  /** Initialize canvases */
  init() {
    this.resize();
    this._drawBackground();
  }

  /** Draw cyberpunk grid background with visible styling */
  _drawBackground() {
    const ctx = this.bgCtx;
    const w = this.bgCanvas.width;
    const h = this.bgCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle radial vignette
    const radGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.7);
    radGrad.addColorStop(0, 'rgba(15, 15, 50, 0.3)');
    radGrad.addColorStop(1, 'rgba(2, 2, 8, 0.6)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = `rgba(0, 240, 255, ${this._gridOpacity})`;
    ctx.lineWidth = 0.5;

    const gridSize = 40;
    for (let x = 0; x <= w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Major grid lines (every 4th)
    ctx.strokeStyle = `rgba(0, 240, 255, ${this._gridOpacity * 2})`;
    ctx.lineWidth = 0.8;
    for (let x = 0; x <= w; x += gridSize * 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridSize * 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Center crosshair
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner brackets
    const bracketSize = 30;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 20 + bracketSize); ctx.lineTo(20, 20); ctx.lineTo(20 + bracketSize, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w - 20 - bracketSize, 20); ctx.lineTo(w - 20, 20); ctx.lineTo(w - 20, 20 + bracketSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20, h - 20 - bracketSize); ctx.lineTo(20, h - 20); ctx.lineTo(20 + bracketSize, h - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w - 20 - bracketSize, h - 20); ctx.lineTo(w - 20, h - 20); ctx.lineTo(w - 20, h - 20 - bracketSize);
    ctx.stroke();
  }

  /** Get the color for the current point (supports gradient) */
  _getStrokeColor(pointIndex) {
    if (!this.gradientEnabled) return this.currentColor;
    const colors = this.gradientColors;
    const t = ((pointIndex * 0.02) + this._gradientOffset) % 1;
    return this._interpolateGradientColor(colors, t);
  }

  /** Interpolate between gradient colors */
  _interpolateGradientColor(colors, t) {
    const n = colors.length;
    const scaledT = t * (n - 1);
    const i = Math.floor(scaledT);
    const f = scaledT - i;
    const c1 = this._hexToRgb(colors[i % n]);
    const c2 = this._hexToRgb(colors[(i + 1) % n]);
    const r = Math.round(c1.r + (c2.r - c1.r) * f);
    const g = Math.round(c1.g + (c2.g - c1.g) * f);
    const b = Math.round(c1.b + (c2.b - c1.b) * f);
    return `rgb(${r},${g},${b})`;
  }

  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    } : { r: 0, g: 240, b: 255 };
  }

  /**
   * Convert pixel coordinates to canvas coordinates.
   * For mouse/touch: pass raw clientX/clientY with isNormalized=false
   * For hand tracking: pass normalized 0-1 coords with isNormalized=true
   */
  _toCanvasCoords(x, y, isNormalized, mirrorX) {
    if (isNormalized) {
      const cx = mirrorX ? (1 - x) * this.canvas.width : x * this.canvas.width;
      const cy = y * this.canvas.height;
      return { x: cx, y: cy };
    }
    return { x, y };
  }

  /**
   * Process a drawing point.
   * @param {number} x - x coordinate (pixels or normalized)
   * @param {number} y - y coordinate (pixels or normalized)
   * @param {number} timestamp
   * @param {boolean} isNormalized - true if coords are 0-1 normalized
   * @param {boolean} mirrorX - true to mirror X axis (for hand tracking)
   */
  addDrawPoint(x, y, timestamp, isNormalized = true, mirrorX = true) {
    const coords = this._toCanvasCoords(x, y, isNormalized, mirrorX);
    const px = coords.x;
    const py = coords.y;

    // Handle shape tools
    if (this.currentTool !== 'brush') {
      if (!this._shapeStart) {
        this._shapeStart = { x: px, y: py };
      }
      this._drawShapePreview(px, py);
      this._prevPoint = { x: px, y: py };
      this._prevTimestamp = timestamp;
      return;
    }

    // Calculate velocity for dynamic thickness
    if (this._prevPoint) {
      const dx = px - this._prevPoint.x;
      const dy = py - this._prevPoint.y;
      const dt = Math.max(timestamp - this._prevTimestamp, 1);
      const velocity = Math.sqrt(dx * dx + dy * dy) / dt;

      this._velocitySmooth = this._velocitySmooth * 0.7 + velocity * 0.3;

      const velocityFactor = Math.max(0, 1 - this._velocitySmooth * 0.6);
      this.currentThickness = this.minThickness +
        (this.baseThickness - this.minThickness + 6) * velocityFactor;
      this.currentThickness = Math.max(this.minThickness,
        Math.min(this.maxThickness, this.currentThickness));
    }

    const point = { x: px, y: py, thickness: this.currentThickness, timestamp };

    if (!this.currentStroke) {
      this.currentStroke = {
        color: this.currentColor,
        gradient: this.gradientEnabled,
        points: [point],
        id: Date.now(),
        type: 'brush',
      };
      this.isDrawing = true;
    } else {
      this.currentStroke.points.push(point);
    }

    this._renderLatestSegment();
    this._gradientOffset += 0.005;

    this._prevPrevPoint = this._prevPoint;
    this._prevPoint = { x: px, y: py };
    this._prevTimestamp = timestamp;
  }

  /** Draw shape preview on temporary canvas */
  _drawShapePreview(currentX, currentY) {
    if (!this._shapeStart) return;
    const ctx = this._shapePreviewCtx;
    const w = this._shapePreviewCanvas.width;
    const h = this._shapePreviewCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const sx = this._shapeStart.x;
    const sy = this._shapeStart.y;
    const color = this.gradientEnabled ? this._getStrokeColor(0) : this.currentColor;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = this.baseThickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.7;

    switch (this.currentTool) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        break;
      case 'rect':
        ctx.beginPath();
        ctx.rect(Math.min(sx, currentX), Math.min(sy, currentY),
          Math.abs(currentX - sx), Math.abs(currentY - sy));
        ctx.stroke();
        break;
      case 'circle': {
        const rx = Math.abs(currentX - sx) / 2;
        const ry = Math.abs(currentY - sy) / 2;
        const cxc = (sx + currentX) / 2;
        const cyc = (sy + currentY) / 2;
        ctx.beginPath();
        ctx.ellipse(cxc, cyc, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'triangle':
        ctx.beginPath();
        ctx.moveTo((sx + currentX) / 2, sy);
        ctx.lineTo(currentX, currentY);
        ctx.lineTo(sx, currentY);
        ctx.closePath();
        ctx.stroke();
        break;
    }
    ctx.restore();

    // Composite preview onto main canvas temporarily
    // We'll redraw all + preview in the render
  }

  /** Get shape preview canvas for UI overlay */
  getShapePreview() {
    return this._shapePreviewCanvas;
  }

  /** Finalize a shape */
  finalizeShape() {
    if (!this._shapeStart || !this._prevPoint) {
      this._shapeStart = null;
      return;
    }

    const sx = this._shapeStart.x;
    const sy = this._shapeStart.y;
    const ex = this._prevPoint.x;
    const ey = this._prevPoint.y;

    // Only create shape if it has some size
    if (Math.abs(ex - sx) < 3 && Math.abs(ey - sy) < 3) {
      this._shapeStart = null;
      this._shapePreviewCtx.clearRect(0, 0, this._shapePreviewCanvas.width, this._shapePreviewCanvas.height);
      return;
    }

    const color = this.gradientEnabled ? this._getStrokeColor(0) : this.currentColor;

    // Draw shape permanently on canvas
    const ctx = this.ctx;
    ctx.save();

    // Glow layer
    ctx.strokeStyle = color;
    ctx.lineWidth = this.baseThickness * 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.15;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.globalCompositeOperation = 'lighter';
    this._drawShapePath(ctx, sx, sy, ex, ey);
    ctx.stroke();

    // Core layer
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = this.baseThickness;
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 10;
    this._drawShapePath(ctx, sx, sy, ex, ey);
    ctx.stroke();

    // Bright center
    ctx.lineWidth = this.baseThickness * 0.35;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 4;
    this._drawShapePath(ctx, sx, sy, ex, ey);
    ctx.stroke();

    ctx.restore();

    // Save to history
    this.strokes.push({
      type: this.currentTool,
      color,
      thickness: this.baseThickness,
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
      id: Date.now(),
    });
    this.redoStack = [];

    // Clean up
    this._shapeStart = null;
    this._shapePreviewCtx.clearRect(0, 0, this._shapePreviewCanvas.width, this._shapePreviewCanvas.height);
    this._prevPoint = null;
  }

  /** Draw a shape path (reusable for different layers) */
  _drawShapePath(ctx, sx, sy, ex, ey) {
    ctx.beginPath();
    switch (this.currentTool) {
      case 'line':
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        break;
      case 'rect':
        ctx.rect(Math.min(sx, ex), Math.min(sy, ey),
          Math.abs(ex - sx), Math.abs(ey - sy));
        break;
      case 'circle': {
        const rx = Math.abs(ex - sx) / 2;
        const ry = Math.abs(ey - sy) / 2;
        const cxc = (sx + ex) / 2;
        const cyc = (sy + ey) / 2;
        ctx.ellipse(cxc, cyc, rx, ry, 0, 0, Math.PI * 2);
        break;
      }
      case 'triangle':
        ctx.moveTo((sx + ex) / 2, sy);
        ctx.lineTo(ex, ey);
        ctx.lineTo(sx, ey);
        ctx.closePath();
        break;
    }
  }

  /** Render the latest segment of the current stroke with glow effect */
  _renderLatestSegment() {
    const pts = this.currentStroke.points;
    if (pts.length < 2) return;

    const ctx = this.ctx;
    const isGradient = this.currentStroke.gradient;

    const p0 = pts.length >= 3 ? pts[pts.length - 3] : pts[pts.length - 2];
    const p1 = pts[pts.length - 2];
    const p2 = pts[pts.length - 1];

    const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

    const color = isGradient ? this._getStrokeColor(pts.length) : this.currentStroke.color;

    ctx.save();

    // Outer glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.lineWidth = p2.thickness * 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();

    // Middle glow
    ctx.lineWidth = p2.thickness * 1.8;
    ctx.globalAlpha = 0.25;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();

    // Core stroke
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = p2.thickness;
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();

    // Bright center
    ctx.lineWidth = p2.thickness * 0.4;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();

    ctx.restore();
  }

  /** End the current stroke and save to history */
  endStroke() {
    // If using a shape tool, finalize the shape
    if (this.currentTool !== 'brush') {
      this.finalizeShape();
      return;
    }

    if (this.currentStroke && this.currentStroke.points.length > 1) {
      this.strokes.push(this.currentStroke);
      this.redoStack = [];
    }
    this.currentStroke = null;
    this.isDrawing = false;
    this._prevPoint = null;
    this._prevPrevPoint = null;
    this._velocitySmooth = 0;
  }

  /** Erase at a given position */
  eraseAt(x, y, isNormalized = true, mirrorX = true) {
    const coords = this._toCanvasCoords(x, y, isNormalized, mirrorX);
    const r = this.eraserRadius;

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.beginPath();
    this.ctx.arc(coords.x, coords.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /** Undo last stroke */
  undo() {
    if (this.strokes.length === 0) return false;
    const stroke = this.strokes.pop();
    this.redoStack.push(stroke);
    this._redrawAll();
    return true;
  }

  /** Redo last undone stroke */
  redo() {
    if (this.redoStack.length === 0) return false;
    const stroke = this.redoStack.pop();
    this.strokes.push(stroke);
    this._redrawAll();
    return true;
  }

  /** Clear entire canvas */
  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes = [];
    this.redoStack = [];
    this.currentStroke = null;
    this._prevPoint = null;
    this._shapeStart = null;
  }

  /** Redraw all strokes from history */
  _redrawAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.strokes) {
      if (stroke.type === 'brush') {
        this._renderFullStroke(stroke);
      } else {
        this._renderFullShape(stroke);
      }
    }
  }

  /** Render a complete brush stroke */
  _renderFullStroke(stroke) {
    const pts = stroke.points;
    if (pts.length < 2) return;

    const ctx = this.ctx;
    const isGradient = stroke.gradient;

    for (let i = 1; i < pts.length; i++) {
      const p0 = i >= 2 ? pts[i - 2] : pts[i - 1];
      const p1 = pts[i - 1];
      const p2 = pts[i];

      const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const color = isGradient ? this._getStrokeColor(i) : stroke.color;

      ctx.save();

      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = color;
      ctx.lineWidth = p2.thickness * 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.12;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = p2.thickness;
      ctx.globalAlpha = 0.9;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
      ctx.stroke();

      ctx.lineWidth = p2.thickness * 0.35;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
      ctx.stroke();

      ctx.restore();
    }
  }

  /** Render a complete shape from history */
  _renderFullShape(shape) {
    const ctx = this.ctx;
    const { color, thickness, start, end } = shape;
    const savedTool = this.currentTool;
    this.currentTool = shape.type;

    ctx.save();

    // Glow
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness * 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.15;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.globalCompositeOperation = 'lighter';
    this._drawShapePath(ctx, start.x, start.y, end.x, end.y);
    ctx.stroke();

    // Core
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = thickness;
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 10;
    this._drawShapePath(ctx, start.x, start.y, end.x, end.y);
    ctx.stroke();

    // Bright center
    ctx.lineWidth = thickness * 0.35;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 4;
    this._drawShapePath(ctx, start.x, start.y, end.x, end.y);
    ctx.stroke();

    ctx.restore();
    this.currentTool = savedTool;
  }

  /** Set current drawing color */
  setColor(color) {
    this.currentColor = color;
  }

  /** Set base brush thickness */
  setBaseThickness(val) {
    this.baseThickness = val;
    this.currentThickness = val;
  }

  /** Set current tool */
  setTool(tool) {
    this.currentTool = tool;
    // Cancel any in-progress shape
    this._shapeStart = null;
    if (this._shapePreviewCtx) {
      this._shapePreviewCtx.clearRect(0, 0, this._shapePreviewCanvas.width, this._shapePreviewCanvas.height);
    }
  }

  /** Toggle gradient mode */
  toggleGradient() {
    this.gradientEnabled = !this.gradientEnabled;
    return this.gradientEnabled;
  }

  /** Cycle to next color in palette */
  cycleColor(colors) {
    const idx = colors.indexOf(this.currentColor);
    const next = (idx + 1) % colors.length;
    this.currentColor = colors[next];
    return this.currentColor;
  }

  /** Save canvas as PNG */
  savePNG() {
    const composite = document.createElement('canvas');
    composite.width = this.canvas.width;
    composite.height = this.canvas.height;
    const compCtx = composite.getContext('2d');

    compCtx.fillStyle = '#0a0a1a';
    compCtx.fillRect(0, 0, composite.width, composite.height);
    compCtx.drawImage(this.bgCanvas, 0, 0);
    compCtx.drawImage(this.canvas, 0, 0);

    const link = document.createElement('a');
    link.download = `air-drawing-${Date.now()}.png`;
    link.href = composite.toDataURL('image/png');
    link.click();
  }

  /** Export strokes as SVG */
  saveSVG() {
    const w = this.canvas.width;
    const h = this.canvas.height;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    svg += `<rect width="${w}" height="${h}" fill="#0a0a1a"/>`;
    svg += `<defs><filter id="glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

    for (const stroke of this.strokes) {
      if (stroke.type === 'brush') {
        if (stroke.points.length < 2) continue;
        let pathD = `M ${stroke.points[0].x.toFixed(1)} ${stroke.points[0].y.toFixed(1)}`;
        for (let i = 1; i < stroke.points.length; i++) {
          pathD += ` L ${stroke.points[i].x.toFixed(1)} ${stroke.points[i].y.toFixed(1)}`;
        }
        const avgT = stroke.points.reduce((s, p) => s + p.thickness, 0) / stroke.points.length;
        svg += `<path d="${pathD}" fill="none" stroke="${stroke.color}" stroke-width="${avgT.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)" opacity="0.9"/>`;
      } else {
        const { color, thickness, start, end } = stroke;
        let shapeEl = '';
        switch (stroke.type) {
          case 'line':
            shapeEl = `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round" filter="url(#glow)" opacity="0.9"/>`;
            break;
          case 'rect':
            shapeEl = `<rect x="${Math.min(start.x, end.x)}" y="${Math.min(start.y, end.y)}" width="${Math.abs(end.x - start.x)}" height="${Math.abs(end.y - start.y)}" fill="none" stroke="${color}" stroke-width="${thickness}" filter="url(#glow)" opacity="0.9"/>`;
            break;
          case 'circle':
            shapeEl = `<ellipse cx="${(start.x + end.x) / 2}" cy="${(start.y + end.y) / 2}" rx="${Math.abs(end.x - start.x) / 2}" ry="${Math.abs(end.y - start.y) / 2}" fill="none" stroke="${color}" stroke-width="${thickness}" filter="url(#glow)" opacity="0.9"/>`;
            break;
          case 'triangle':
            shapeEl = `<polygon points="${(start.x + end.x) / 2},${start.y} ${end.x},${end.y} ${start.x},${end.y}" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linejoin="round" filter="url(#glow)" opacity="0.9"/>`;
            break;
        }
        svg += shapeEl;
      }
    }

    svg += '</svg>';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = `air-drawing-${Date.now()}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** Get current drawing stats */
  getStats() {
    return {
      strokeCount: this.strokes.length,
      canUndo: this.strokes.length > 0,
      canRedo: this.redoStack.length > 0,
      currentColor: this.currentColor,
      currentThickness: Math.round(this.currentThickness),
      currentTool: this.currentTool,
      gradientEnabled: this.gradientEnabled,
    };
  }
}