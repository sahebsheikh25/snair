# AI Air Drawing - Development Plan

## Design Guidelines

### Design References
- Cyberpunk 2077 UI aesthetics
- Tron Legacy visual style
- Holographic interface concepts

### Color Palette
- Background: #0a0a0f (Deep dark)
- Primary Neon: #00f0ff (Cyan)
- Secondary Neon: #ff00ff (Magenta)
- Accent: #00ff88 (Green)
- Warning: #ff6600 (Orange)
- Purple: #aa00ff (Purple)
- Red: #ff0044 (Red)
- Panel BG: rgba(10, 10, 20, 0.85)
- Border Glow: rgba(0, 240, 255, 0.3)

### Typography
- Font: 'Orbitron' for headings, 'Rajdhani' for body
- Monospace: 'Share Tech Mono' for status text

### Key Styles
- Glassmorphism panels with neon borders
- Glow/bloom effects on strokes
- Scanline overlay for futuristic feel
- Smooth CSS transitions (300ms)

## File Structure (6 files)
1. `index.html` - Main HTML structure with canvas layers and UI panels
2. `style.css` - Complete cyberpunk styling, animations, glassmorphism
3. `script.js` - Main entry point, app initialization, render loop
4. `hand-tracker.js` - MediaPipe Hands setup, landmark detection, gesture recognition
5. `drawing-engine.js` - Canvas drawing, stroke management, brush effects, undo/redo
6. `ui-controller.js` - Virtual UI panel, color palette, mode indicators, save/export

## Features Implementation
1. Hand tracking via MediaPipe Hands CDN
2. Gesture recognition (1 finger=draw, 2=erase, 3=color, fist=pause, palm=clear)
3. Smooth stroke rendering with cubic interpolation
4. Dynamic brush thickness based on finger speed
5. Neon glow brush effects with shadow blur
6. Multi-color palette (6 neon colors)
7. Virtual floating UI panel with status indicators
8. Undo/Redo with stroke history
9. Save as PNG / Export as SVG
10. Background grid + AR overlay effects