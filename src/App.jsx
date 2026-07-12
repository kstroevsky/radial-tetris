import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DIFFICULTIES,
  PIECE_COLORS,
  RINGS,
  SECTORS,
  cellsFor,
  createGame,
  gameSnapshot,
  ghostRing,
  hardDrop,
  moveAround,
  normalizeSector,
  pauseGame,
  resetGame,
  ringIntegrity,
  rotatePiece,
  sectorDegrees,
  setDifficulty,
  startGame,
  stepInward,
  updateGame,
} from "./gameEngine.js";

const TAU = Math.PI * 2;
const staticLayers = new WeakMap();
const renderMetrics = new WeakMap();
const BEST_SCORE_KEY = "radial-tetris-best-score";

function compactNumber(value) {
  return String(Math.max(0, value)).padStart(7, "0");
}

function polarPoint(cx, cy, radius, angle) {
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function gridHue(sector) {
  const progress = normalizeSector(sector) / SECTORS;
  if (progress < 0.5) return 176 - progress * 145;
  return 103 + (progress - 0.5) * 152;
}

function cellPath(ctx, cx, cy, coreRadius, ringWidth, sector, ring, gap = 0.035) {
  const sectorWidth = TAU / SECTORS;
  const start = sector * sectorWidth - Math.PI / 2 + gap;
  const end = (sector + 1) * sectorWidth - Math.PI / 2 - gap;
  const inner = coreRadius + ring * ringWidth + 1.2;
  const outer = coreRadius + (ring + 1) * ringWidth - 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, start, end);
  ctx.arc(cx, cy, inner, end, start, true);
  ctx.closePath();
}

function drawCell(ctx, geometry, cell, color, options = {}) {
  const { cx, cy, coreRadius, ringWidth } = geometry;
  cellPath(ctx, cx, cy, coreRadius, ringWidth, cell.sector, cell.ring, 0.045);
  if (options.ghost) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.48;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = options.alpha ?? 0.86;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = options.active ? 0.95 : 0.48;
  ctx.strokeStyle = options.active ? "#efffff" : color;
  ctx.lineWidth = options.active ? 1.75 : 0.8;
  ctx.stroke();
  if (options.active) {
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.restore();
}

function createGeometry(cssWidth, cssHeight) {
  const size = Math.min(cssWidth, cssHeight);
  const coreRadius = Math.max(19, size * 0.035);
  const outerRadius = size * 0.425;
  return {
    cx: cssWidth / 2,
    cy: cssHeight / 2,
    outerRadius,
    coreRadius,
    ringWidth: (outerRadius - coreRadius) / RINGS,
  };
}

function drawStaticField(ctx, geometry, cssWidth, cssHeight) {
  const { cx, cy, outerRadius, coreRadius, ringWidth } = geometry;
  const size = Math.min(cssWidth, cssHeight);
  ctx.fillStyle = "#020608";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.save();
  ctx.lineWidth = 0.7;
  for (let line = -8; line <= 8; line += 1) {
    const offset = (line / 8) * outerRadius;
    ctx.strokeStyle = line === 0 ? "rgba(95, 198, 218, 0.36)" : "rgba(18, 83, 101, 0.30)";
    ctx.beginPath();
    ctx.moveTo(cx - outerRadius, cy + offset);
    ctx.lineTo(cx + outerRadius, cy + offset);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + offset, cy - outerRadius);
    ctx.lineTo(cx + offset, cy + outerRadius);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  for (let sector = 0; sector < SECTORS; sector += 1) {
    const hue = gridHue(sector);
    const angle = sector * TAU / SECTORS - Math.PI / 2;
    const [x1, y1] = polarPoint(cx, cy, coreRadius * 0.72, angle);
    const [x2, y2] = polarPoint(cx, cy, outerRadius, angle);
    ctx.strokeStyle = `hsla(${hue}, 82%, 58%, 0.50)`;
    ctx.lineWidth = sector % 4 === 0 ? 1.25 : 0.72;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    for (let ring = 1; ring <= RINGS; ring += 1) {
      const radius = coreRadius + ring * ringWidth;
      const start = sector * TAU / SECTORS - Math.PI / 2;
      const end = (sector + 1) * TAU / SECTORS - Math.PI / 2;
      ctx.strokeStyle = `hsla(${hue}, 82%, 58%, ${ring === RINGS ? 0.68 : 0.37})`;
      ctx.lineWidth = ring === RINGS ? 1.35 : 0.68;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, end);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(229, 248, 249, 0.68)";
  ctx.font = `${Math.max(9, size * 0.017)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let ring = 1; ring <= RINGS; ring += 2) {
    const radius = coreRadius + (ring - 0.5) * ringWidth;
    ctx.fillText(`${ring}i`, cx - 8, cy - radius);
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(206, 238, 239, 0.66)";
  ctx.font = `${Math.max(8, size * 0.013)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let sector = 0; sector < SECTORS; sector += 2) {
    const angle = sector * TAU / SECTORS - Math.PI / 2;
    const [x, y] = polarPoint(cx, cy, outerRadius + 32, angle);
    ctx.fillText(`${sector * (360 / SECTORS)}°`, x, y);
  }
  ctx.restore();
}

function getStaticLayer(canvas, geometry, cssWidth, cssHeight, dpr, targetWidth, targetHeight) {
  let layer = staticLayers.get(canvas);
  if (!layer || layer.width !== targetWidth || layer.height !== targetHeight) {
    layer = document.createElement("canvas");
    layer.width = targetWidth;
    layer.height = targetHeight;
    const layerContext = layer.getContext("2d", { alpha: false });
    layerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStaticField(layerContext, geometry, cssWidth, cssHeight);
    staticLayers.set(canvas, layer);
  }
  return layer;
}

function recordRender(canvas, startedAt) {
  const previous = renderMetrics.get(canvas) ?? { draws: 0, totalMs: 0, maxMs: 0 };
  const duration = performance.now() - startedAt;
  const next = {
    draws: previous.draws + 1,
    totalMs: previous.totalMs + duration,
    maxMs: Math.max(previous.maxMs, duration),
    lastMs: duration,
    pixelCount: canvas.width * canvas.height,
  };
  renderMetrics.set(canvas, next);
}

function drawScene(canvas, game) {
  if (!canvas) return;
  const startedAt = performance.now();
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  // The game board is a canvas. A 1.5× cap made high-density Android screens
  // upscale its pixels, which softened the grid and falling pieces. The static
  // layer is cached and dynamic draws are demand-driven, so a 2.5× mobile cap
  // restores sharp edges without forcing a full redraw every animation frame.
  const dprCap = cssWidth <= 540 ? 2.5 : 2;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const geometry = createGeometry(cssWidth, cssHeight);
  const { cx, cy, outerRadius, coreRadius, ringWidth } = geometry;
  const size = Math.min(cssWidth, cssHeight);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.drawImage(getStaticLayer(canvas, geometry, cssWidth, cssHeight, dpr, targetWidth, targetHeight), 0, 0, cssWidth, cssHeight);

  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let sector = 0; sector < SECTORS; sector += 1) {
      const type = game.board[ring][sector];
      if (type) drawCell(ctx, geometry, { sector, ring }, PIECE_COLORS[type]);
    }
  }

  if (game.active) {
    const landingRing = ghostRing(game);
    for (const cell of cellsFor(game.active, { ring: landingRing })) {
      drawCell(ctx, geometry, cell, PIECE_COLORS[game.active.type], { ghost: true });
    }

    for (const cell of cellsFor(game.active)) {
      drawCell(ctx, geometry, cell, PIECE_COLORS[game.active.type], { active: true, alpha: 0.9 });
    }

    const entryAngle = game.active.entrySector * TAU / SECTORS - Math.PI / 2;
    const [rayStartX, rayStartY] = polarPoint(cx, cy, outerRadius + 5, entryAngle);
    const [rayEndX, rayEndY] = polarPoint(cx, cy, outerRadius + 21, entryAngle);
    ctx.save();
    ctx.strokeStyle = PIECE_COLORS[game.active.type];
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rayStartX, rayStartY);
    ctx.lineTo(rayEndX, rayEndY);
    ctx.stroke();
    ctx.restore();
  }

  for (const particle of game.particles) {
    const angle = particle.sector * TAU / SECTORS - Math.PI / 2;
    const radius = coreRadius + (particle.ring + 0.5) * ringWidth;
    const [x, y] = polarPoint(cx, cy, radius, angle);
    ctx.save();
    ctx.globalAlpha = particle.life;
    ctx.fillStyle = "#eaff64";
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore();
  }

  if (game.clearFlash > 0) {
    ctx.save();
    ctx.globalAlpha = game.clearFlash * 0.11;
    ctx.fillStyle = "#dfff55";
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = "#020608";
  ctx.strokeStyle = game.mode === "gameover" ? "#ff647c" : "#ccf341";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius * 0.74, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f1ffd0";
  ctx.font = `italic ${Math.max(14, size * 0.026)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("eᶻ", cx, cy + 1);
  ctx.restore();

  recordRender(canvas, startedAt);
}

function Stat({ label, value, accent = false }) {
  return (
    <div className="stat-block">
      <span className="eyebrow">{label}</span>
      <strong className={accent ? "accent-value" : ""}>{value}</strong>
    </div>
  );
}

function IntegrityReadout({ values }) {
  const ranked = values.map((value, ring) => ({ value, ring })).sort((a, b) => b.value - a.value).slice(0, 4);
  return (
    <div className="integrity-list" aria-label="Most complete rings">
      {ranked.map(({ ring, value }) => (
        <div className="integrity-row" key={ring}>
          <span>R{String(ring + 1).padStart(2, "0")}</span>
          <div className="integrity-track" aria-hidden="true"><span style={{ width: `${(value / SECTORS) * 100}%` }} /></div>
          <b>{String(value).padStart(2, "0")}/{SECTORS}</b>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const gameRef = useRef(null);
  const pointerRef = useRef({ active: false, sector: null });
  const pendingPointerSectorRef = useRef(null);
  const orbitFrameRef = useRef(0);
  const mobileRepeatsRef = useRef(new Map());
  const mobilePullsRef = useRef(new Map());
  if (!gameRef.current) {
    gameRef.current = createGame();
    try {
      gameRef.current.best = Math.max(0, Number(window.localStorage.getItem(BEST_SCORE_KEY)) || 0);
    } catch {
      // Private browsing and embedded webviews may disallow local storage.
    }
  }

  const [hud, setHud] = useState(() => ({
    ...gameSnapshot(gameRef.current),
    best: gameRef.current.best,
    integrity: ringIntegrity(gameRef.current),
  }));

  const syncHud = useCallback(() => {
    const game = gameRef.current;
    setHud({ ...gameSnapshot(game), best: game.best, integrity: ringIntegrity(game) });
  }, []);

  const redraw = useCallback(() => drawScene(canvasRef.current, gameRef.current), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(hud.best));
    } catch {
      // The game remains playable when storage is unavailable.
    }
  }, [hud.best]);

  const act = useCallback((action) => {
    const game = gameRef.current;
    let changed = false;
    if (action === "left") changed = moveAround(game, -1);
    if (action === "right") changed = moveAround(game, 1);
    if (action === "rotate") changed = rotatePiece(game, 1);
    if (action === "counterRotate") changed = rotatePiece(game, -1);
    if (action === "down") changed = stepInward(game, true);
    if (action === "drop") changed = hardDrop(game) >= 0;
    if (action === "pause") { pauseGame(game); changed = true; }
    if (action === "restart") { resetGame(game); changed = true; }
    if (changed) { syncHud(); redraw(); }
  }, [redraw, syncHud]);

  const clearMobileRepeat = useCallback((pointerId) => {
    const repeat = mobileRepeatsRef.current.get(pointerId);
    if (!repeat) return;
    window.clearTimeout(repeat.delayId);
    window.clearInterval(repeat.intervalId);
    repeat.target?.removeAttribute("data-pressed");
    mobileRepeatsRef.current.delete(pointerId);
  }, []);

  const clearAllMobileRepeats = useCallback(() => {
    for (const pointerId of mobileRepeatsRef.current.keys()) clearMobileRepeat(pointerId);
  }, [clearMobileRepeat]);

  const beginMobileControl = useCallback((event, action, repeat) => {
    if (gameRef.current.mode !== "playing") return;
    event.preventDefault();
    const target = event.currentTarget;
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events and a few embedded browsers do not expose an active pointer to capture.
    }
    target.dataset.pressed = "true";
    act(action);
    if (navigator.vibrate) navigator.vibrate(action === "drop" ? 14 : 6);
    if (!repeat) return;

    const state = { target, delayId: 0, intervalId: 0 };
    state.delayId = window.setTimeout(() => {
      act(action);
      state.intervalId = window.setInterval(() => act(action), repeat.interval);
    }, repeat.delay);
    mobileRepeatsRef.current.set(event.pointerId, state);
  }, [act]);

  const endMobileControl = useCallback((event) => {
    event.currentTarget?.removeAttribute("data-pressed");
    clearMobileRepeat(event.pointerId);
  }, [clearMobileRepeat]);

  const clearMobilePull = useCallback((pointerId) => {
    const pull = mobilePullsRef.current.get(pointerId);
    if (!pull) return;
    pull.target?.removeAttribute("data-pressed");
    pull.target?.removeAttribute("data-pull-direction");
    pull.target?.style.removeProperty("--pull-offset");
    mobilePullsRef.current.delete(pointerId);
  }, []);

  const clearAllMobilePulls = useCallback(() => {
    for (const pointerId of mobilePullsRef.current.keys()) clearMobilePull(pointerId);
  }, [clearMobilePull]);

  const beginMobilePull = useCallback((event, downAction, upAction) => {
    if (gameRef.current.mode !== "playing") return;
    event.preventDefault();
    const target = event.currentTarget;
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events and a few embedded browsers do not expose an active pointer to capture.
    }
    target.dataset.pressed = "true";
    target.dataset.pullDirection = "neutral";
    target.style.setProperty("--pull-offset", "0px");
    mobilePullsRef.current.set(event.pointerId, {
      target,
      downAction,
      upAction,
      lastY: event.clientY,
      originY: event.clientY,
    });
  }, []);

  const moveMobilePull = useCallback((event) => {
    const pull = mobilePullsRef.current.get(event.pointerId);
    if (!pull || gameRef.current.mode !== "playing") return;
    event.preventDefault();
    const offset = Math.max(-28, Math.min(28, event.clientY - pull.originY));
    pull.target.style.setProperty("--pull-offset", `${offset}px`);
    const distance = event.clientY - pull.lastY;
    const stepSize = 22;
    const steps = Math.min(4, Math.floor(Math.abs(distance) / stepSize));
    if (!steps) return;
    const direction = Math.sign(distance);
    const action = direction > 0 ? pull.downAction : pull.upAction;
    for (let step = 0; step < steps; step += 1) act(action);
    pull.lastY += direction * steps * stepSize;
    pull.target.dataset.pullDirection = direction > 0 ? "down" : "up";
    if (navigator.vibrate) navigator.vibrate(5);
  }, [act]);

  const endMobilePull = useCallback((event) => {
    clearMobilePull(event.pointerId);
  }, [clearMobilePull]);

  const finishMobilePull = useCallback((event) => {
    moveMobilePull(event);
    endMobilePull(event);
  }, [endMobilePull, moveMobilePull]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearAllMobileRepeats();
        clearAllMobilePulls();
      }
    };
    const clearMobileInputs = () => {
      clearAllMobileRepeats();
      clearAllMobilePulls();
    };
    window.addEventListener("blur", clearMobileInputs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearMobileInputs);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearMobileInputs();
    };
  }, [clearAllMobilePulls, clearAllMobileRepeats]);

  const start = useCallback((difficulty = "normal") => {
    if (gameRef.current.mode === "ready") setDifficulty(gameRef.current, difficulty);
    startGame(gameRef.current);
    syncHud();
    redraw();
    canvasRef.current?.focus();
  }, [redraw, syncHud]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameRef.current?.requestFullscreen();
    } catch {
      gameRef.current.message = "Fullscreen unavailable";
      syncHud();
    }
  }, [syncHud]);

  useEffect(() => {
    let animationId;
    let previous = performance.now();
    const frame = (now) => {
      const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      const sceneChanged = updateGame(gameRef.current, delta);
      if (sceneChanged) {
        drawScene(canvasRef.current, gameRef.current);
        syncHud();
      }
      animationId = requestAnimationFrame(frame);
    };

    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      const gameKeys = ["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "enter", "a", "d", "w", "s", "x", "z", "p", "r", "f", "escape"];
      if (!gameKeys.includes(key)) return;
      event.preventDefault();
      if (key === "f") return toggleFullscreen();
      if (key === "p" || key === "escape") return act("pause");
      if (key === "r") return act("restart");
      if (gameRef.current.mode === "ready" && (key === " " || key === "enter")) return start();
      if (key === "arrowleft" || key === "a") return act("left");
      if (key === "arrowright" || key === "d") return act("right");
      if (key === "arrowup" || key === "w" || key === "x") return act("rotate");
      if (key === "z") return act("counterRotate");
      if (key === "arrowdown" || key === "s") return act("down");
      if (key === " ") return act("drop");
    };

    const onResize = () => drawScene(canvasRef.current, gameRef.current);
    const onVisibilityChange = () => { previous = performance.now(); };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    drawScene(canvasRef.current, gameRef.current);
    animationId = requestAnimationFrame(frame);
    window.render_game_to_text = () => JSON.stringify(gameSnapshot(gameRef.current));
    window.getGamePerformanceStats = () => {
      const metrics = renderMetrics.get(canvasRef.current) ?? { draws: 0, totalMs: 0, maxMs: 0, lastMs: 0, pixelCount: 0 };
      return JSON.stringify({
        ...metrics,
        averageMs: metrics.draws ? metrics.totalMs / metrics.draws : 0,
        devicePixelRatio: window.devicePixelRatio || 1,
        renderScale: canvasRef.current ? canvasRef.current.width / Math.max(1, canvasRef.current.getBoundingClientRect().width) : 0,
      });
    };
    window.advanceTime = (milliseconds) => {
      const steps = Math.max(1, Math.round(milliseconds / (1000 / 60)));
      let sceneChanged = false;
      for (let step = 0; step < steps; step += 1) {
        sceneChanged = updateGame(gameRef.current, 1 / 60) || sceneChanged;
      }
      if (sceneChanged) {
        drawScene(canvasRef.current, gameRef.current);
        syncHud();
      }
    };

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      delete window.render_game_to_text;
      delete window.getGamePerformanceStats;
      delete window.advanceTime;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [act, start, syncHud, toggleFullscreen]);

  const pointerSector = useCallback((event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    return normalizeSector(Math.round((Math.atan2(y, x) + Math.PI / 2) / (TAU / SECTORS)));
  }, []);

  const applyPointerOrbit = useCallback((target) => {
    if (gameRef.current.mode !== "playing") return;
    const current = gameRef.current.active?.sector;
    if (current == null || target === pointerRef.current.sector) return;
    let delta = normalizeSector(target - current);
    if (delta > SECTORS / 2) delta -= SECTORS;
    const direction = Math.sign(delta);
    for (let step = 0; step < Math.abs(delta); step += 1) {
      if (!moveAround(gameRef.current, direction)) break;
    }
    pointerRef.current.sector = target;
    syncHud();
    redraw();
  }, [redraw, syncHud]);

  const orbitToPointer = useCallback((event) => {
    if (gameRef.current.mode !== "playing") return;
    pendingPointerSectorRef.current = pointerSector(event);
    if (orbitFrameRef.current) return;
    orbitFrameRef.current = requestAnimationFrame(() => {
      orbitFrameRef.current = 0;
      const target = pendingPointerSectorRef.current;
      pendingPointerSectorRef.current = null;
      if (target != null) applyPointerOrbit(target);
    });
  }, [applyPointerOrbit, pointerSector]);

  const finishPointerOrbit = useCallback(() => {
    pointerRef.current.active = false;
    if (!orbitFrameRef.current) return;
    cancelAnimationFrame(orbitFrameRef.current);
    orbitFrameRef.current = 0;
    const target = pendingPointerSectorRef.current;
    pendingPointerSectorRef.current = null;
    if (target != null) applyPointerOrbit(target);
  }, [applyPointerOrbit]);

  useEffect(() => () => {
    if (orbitFrameRef.current) cancelAnimationFrame(orbitFrameRef.current);
  }, []);

  const integrityAverage = useMemo(() => Math.round((hud.integrity.reduce((sum, value) => sum + value, 0) / (RINGS * SECTORS)) * 100), [hud.integrity]);
  const isOverlayVisible = hud.mode !== "playing";
  const overlayCopy = hud.mode === "gameover"
    ? { kicker: "Core field saturated", title: "Orbit lost", body: `Final signal ${compactNumber(hud.score)} · ${hud.ringsCleared} rings collapsed`, cta: "Recalibrate" }
    : hud.mode === "paused"
      ? { kicker: "Simulation held", title: "Orbit paused", body: "Your radial stack is stable. Resume when ready.", cta: "Resume" }
      : { kicker: "A circular falling-block experiment", title: "Tetris, bent into orbit.", body: "Pieces enter from any angle. Orbit, rotate, and drive them inward to close complete rings around the core.", cta: "Acquire vector" };

  return (
    <main className="game-shell" ref={frameRef}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-index">Eˣ.01</span>
          <div><p>Radial Systems Lab</p><h1>RADIAL / TETRIS</h1></div>
        </div>
        <div className="topbar-status">
          <span>POLAR FIELD</span><b>{hud.mode === "playing" ? "TRACKING" : hud.mode.toUpperCase()}</b>
          <span className="difficulty-chip">{DIFFICULTIES[hud.difficulty]?.label ?? "Normal"}</span>
        </div>
      </header>

      <section className="game-layout" aria-label="Radial Tetris game">
        <aside className="hud-panel score-panel">
          <p className="panel-number">01 / TELEMETRY</p>
          <Stat label="Signal score" value={compactNumber(hud.score)} accent />
          <div className="stat-pair"><Stat label="Rings" value={String(hud.ringsCleared).padStart(2, "0")} /><Stat label="Level" value={String(hud.level).padStart(2, "0")} /></div>
          <Stat label="Best signal" value={compactNumber(hud.best)} />
          <div className="data-rule" />
          <div className="vector-readout"><span className="eyebrow">Inbound vector</span><strong>{hud.active ? sectorDegrees(hud.active.sector) : "—"}</strong><p>{hud.active ? `Ring ${hud.active.ring + 1} · ${hud.active.type}-form` : "No active form"}</p></div>
          <div className="status-note"><span>{hud.message}</span><small>{hud.combo > 0 ? `COMBO ×${hud.combo + 1}` : "FIELD NOMINAL"}</small></div>
        </aside>

        <section className="board-column">
          <div className="board-frame">
            <div className="frame-label frame-label-top">z ↦ eᶻ / INWARD PROJECTION</div>
            <canvas
              ref={canvasRef}
              className="game-canvas"
              tabIndex="0"
              aria-label="Circular Tetris board. Drag around the circle to orbit the active piece."
              onPointerDown={(event) => { pointerRef.current = { active: true, sector: null }; event.currentTarget.setPointerCapture(event.pointerId); orbitToPointer(event); }}
              onPointerMove={(event) => { if (pointerRef.current.active) orbitToPointer(event); }}
              onPointerUp={finishPointerOrbit}
              onPointerCancel={finishPointerOrbit}
            />
            <div className="frame-label frame-label-bottom">16θ / 10r / CORE ORIGIN 0,0</div>
            <nav className="mobile-controller" aria-label="Mobile game controls" onContextMenu={(event) => event.preventDefault()}>
              <button
                id="mobile-spin-pull"
                className="mobile-pull-control mobile-spin-pull"
                type="button"
                aria-label="Piece rotation pull control. Pull down to rotate clockwise or up to rotate counterclockwise."
                disabled={hud.mode !== "playing"}
                onPointerDown={(event) => beginMobilePull(event, "rotate", "counterRotate")}
                onPointerMove={moveMobilePull}
                onPointerUp={finishMobilePull}
                onPointerCancel={endMobilePull}
                onLostPointerCapture={endMobilePull}
              ><span className="mobile-pull-title">Spin</span><span className="mobile-pull-top">↑ CCW</span><span className="mobile-pull-track" aria-hidden="true"><span className="mobile-pull-grip">↕</span></span><span className="mobile-pull-bottom">CW ↓</span></button>
              <button
                id="mobile-orbit-pull"
                className="mobile-pull-control mobile-orbit-pull"
                type="button"
                aria-label="Orbit pull control. Pull down to move clockwise or up to move counterclockwise."
                disabled={hud.mode !== "playing"}
                onPointerDown={(event) => beginMobilePull(event, "right", "left")}
                onPointerMove={moveMobilePull}
                onPointerUp={finishMobilePull}
                onPointerCancel={endMobilePull}
                onLostPointerCapture={endMobilePull}
              ><span className="mobile-pull-title">Orbit</span><span className="mobile-pull-top">↑ CCW</span><span className="mobile-pull-track" aria-hidden="true"><span className="mobile-pull-grip">↕</span></span><span className="mobile-pull-bottom">CW ↓</span></button>
              <div className="mobile-control-cluster mobile-action-controls">
                <button
                  id="mobile-nudge"
                  className="mobile-control mobile-nudge-control"
                  type="button"
                  aria-label="Nudge inward. Hold to repeat."
                  disabled={hud.mode !== "playing"}
                  onPointerDown={(event) => beginMobileControl(event, "down", { delay: 115, interval: 54 })}
                  onPointerUp={endMobileControl}
                  onPointerCancel={endMobileControl}
                  onLostPointerCapture={endMobileControl}
                ><span className="mobile-control-icon" aria-hidden="true">↓</span><span>Nudge</span></button>
              </div>
            </nav>
            {isOverlayVisible && (
              <div className="game-overlay" role="dialog" aria-modal="true" aria-label={overlayCopy.title}>
                <div className="overlay-card">
                  <span className="eyebrow">{overlayCopy.kicker}</span><h2>{overlayCopy.title}</h2><p>{overlayCopy.body}</p>
                  {hud.mode === "ready" ? (
                    <div className="difficulty-picker" role="group" aria-label="Choose block speed">
                      <span className="eyebrow">Choose block speed</span>
                      {Object.entries(DIFFICULTIES).map(([difficulty, config]) => (
                        <button
                          id={difficulty === "normal" ? "start-button" : undefined}
                          className={`difficulty-button ${difficulty === "normal" ? "is-default" : ""}`}
                          type="button"
                          key={difficulty}
                          onClick={() => start(difficulty)}
                        >
                          <strong>{config.label}</strong><span>{config.speedLabel}</span>
                        </button>
                      ))}
                    </div>
                  ) : <button id="start-button" className="primary-button" type="button" onClick={start}>{overlayCopy.cta}</button>}
                  {hud.mode === "ready" && <>
                    <small className="desktop-start-hint">Choose a speed · Drag the field or use the control dock</small>
                    <small className="mobile-start-hint">Pull side controls ↑ / ↓ · Hold nudge to drive inward</small>
                  </>}
                </div>
              </div>
            )}
          </div>
          <nav className="touch-controls" aria-label="Fast game controls">
            <button type="button" onClick={() => act("left")} aria-label="Orbit counterclockwise" disabled={hud.mode !== "playing"}>
              <span className="control-icon" aria-hidden="true">↺</span><span>Orbit</span>
            </button>
            <button type="button" onClick={() => act("rotate")} aria-label="Rotate clockwise" disabled={hud.mode !== "playing"}>
              <span className="control-icon" aria-hidden="true">⟳</span><span>Rotate</span>
            </button>
            <button className="drop-button" type="button" onClick={() => act("drop")} aria-label="Hard drop inward" disabled={hud.mode !== "playing"}>
              <span className="control-icon" aria-hidden="true">⇣</span><span>Drop</span>
            </button>
            <button type="button" onClick={() => act("right")} aria-label="Orbit clockwise" disabled={hud.mode !== "playing"}>
              <span className="control-icon" aria-hidden="true">↻</span><span>Orbit</span>
            </button>
          </nav>
        </section>

        <aside className="hud-panel systems-panel">
          <p className="panel-number">02 / FIELD STATE</p>
          <div className="next-piece"><span className="eyebrow">Next form</span><strong style={{ color: PIECE_COLORS[hud.nextType] }}>{hud.nextType}</strong><p>Queued at random θ</p></div>
          <div className="data-rule" />
          <span className="eyebrow">Ring integrity</span>
          <IntegrityReadout values={hud.integrity} />
          <div className="field-load"><span>FIELD LOAD</span><b>{String(integrityAverage).padStart(2, "0")}%</b></div>
          <div className="data-rule" />
          <div className="system-actions">
            <button id="pause-button" type="button" onClick={() => act("pause")}>{hud.mode === "paused" ? "Resume" : "Pause"} <kbd>P</kbd></button>
            <button id="restart-button" type="button" onClick={() => act("restart")}>Restart <kbd>R</kbd></button>
            <button type="button" onClick={toggleFullscreen}>Fullscreen <kbd>F</kbd></button>
          </div>
          <p className="control-legend"><span>← →</span> orbit<br /><span>↑ / Z</span> rotate<br /><span>↓</span> nudge inward<br /><span>SPACE</span> drive to core</p>
        </aside>
      </section>

      <nav className={`mobile-system-controls ${isOverlayVisible ? "is-obscured" : ""}`} aria-label="Mobile game system controls">
        <button id="mobile-new-game" type="button" onClick={() => act("restart")} disabled={hud.mode !== "playing" && hud.mode !== "paused"}>
          <span aria-hidden="true">↻</span> New game
        </button>
        <button id="mobile-pause" type="button" onClick={() => act("pause")} disabled={hud.mode !== "playing" && hud.mode !== "paused"}>
          <span aria-hidden="true">Ⅱ</span> {hud.mode === "paused" ? "Resume" : "Pause"}
        </button>
      </nav>

      <footer className="footer-line"><span>EXPONENTIAL FIELD MAPPING</span><p>Close every angular segment to collapse a ring.</p><span>BUILD 01.00</span></footer>
    </main>
  );
}
