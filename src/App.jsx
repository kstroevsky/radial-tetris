import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Leaderboard } from "./components/Leaderboard.jsx";
import { PlayerNameDialog } from "./components/PlayerNameDialog.jsx";
import { getProfile, saveProfile, submitGameResult } from "./leaderboardApi.js";
import {
  gameResultFrom,
  pendingGameResults,
  queueGameResult,
  removePendingGameResult,
} from "./resultOutbox.js";

const TAU = Math.PI * 2;
const staticLayers = new WeakMap();
const renderMetrics = new WeakMap();
const BEST_SCORE_KEY = "radial-tetris-best-score";
const MOBILE_GESTURE_GUIDE_KEY = "radial-tetris-mobile-gesture-guide-v2";
const MOBILE_GESTURE_QUERY = "(max-width: 700px)";
const MOBILE_GESTURE_STEP_PX = 22;
const MOBILE_GESTURE_SLOP_PX = 12;
const MOBILE_GESTURE_RESOLVE_PX = 24;
const MOBILE_GESTURE_DOMINANCE = 1.25;
const MOBILE_TAP_SLOP_PX = 12;
const MOBILE_TAP_MAX_MS = 240;
const MOBILE_HOLD_NUDGE_DELAY_MS = 320;
const MOBILE_HOLD_NUDGE_REPEAT_MS = 96;
const MOBILE_FLICK_MIN_PX = 48;
const MOBILE_FLICK_MAX_MS = 180;
const MOBILE_FLICK_MIN_VELOCITY = 0.45;
const MOBILE_GUIDE_HELP_MS = 15_000;

function isMobileGestureViewport() {
  return window.matchMedia?.(MOBILE_GESTURE_QUERY).matches ?? window.innerWidth <= 700;
}

function shortestAngleDelta(next, previous) {
  let delta = next - previous;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

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
  const outerRadius = size * 0.475;
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
  const angleLabelRadius = Math.min(outerRadius + 12, size / 2 - 8);
  for (let sector = 0; sector < SECTORS; sector += 2) {
    const angle = sector * TAU / SECTORS - Math.PI / 2;
    const [x, y] = polarPoint(cx, cy, angleLabelRadius, angle);
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
  // layer is cached and dynamic draws are demand-driven, so a 3× mobile cap
  // preserves native high-density phone detail without forcing a full redraw
  // every animation frame.
  const dprCap = cssWidth <= 540 ? 3 : 2;
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

const IntegrityReadout = memo(function IntegrityReadout({ values }) {
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
});

function hudSnapshot(game) {
  return {
    mode: game.mode,
    score: game.score,
    best: game.best,
    level: game.level,
    difficulty: game.difficulty,
    ringsCleared: game.ringsCleared,
    combo: Math.max(0, game.combo),
    active: game.active ? {
      type: game.active.type,
      sector: game.active.sector,
      ring: game.active.ring,
    } : null,
    nextType: game.nextType,
    message: game.message,
  };
}

export function App() {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const gameRef = useRef(null);
  const pointerRef = useRef({ active: false, sector: null });
  const pendingPointerSectorRef = useRef(null);
  const orbitFrameRef = useRef(0);
  const mobileGestureRef = useRef(null);
  const mobileGestureFrameRef = useRef(0);
  const pendingMobilePointRef = useRef(null);
  const clearMobileInputsRef = useRef(() => {});
  const refreshGameLoopRef = useRef(() => {});
  const gestureGuideRef = useRef({ open: false, source: null, resumeOnClose: false });
  const gestureGuideSeenRef = useRef(false);
  const gestureGuideTimerRef = useRef({ id: 0, remaining: MOBILE_GUIDE_HELP_MS, startedAt: 0 });
  const dismissGestureGuideRef = useRef(() => {});
  const gestureGuideDialogRef = useRef(null);
  const previousModeRef = useRef("ready");
  const finalizedGameIdsRef = useRef(new Set());
  if (!gameRef.current) {
    gameRef.current = createGame();
    try {
      gameRef.current.best = Math.max(0, Number(window.localStorage.getItem(BEST_SCORE_KEY)) || 0);
    } catch {
      // Private browsing and embedded webviews may disallow local storage.
    }
  }

  const [hud, setHud] = useState(() => ({
    ...hudSnapshot(gameRef.current),
    integrity: ringIntegrity(gameRef.current),
  }));
  const [profile, setProfile] = useState({ status: "loading", player: null });
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [resultStatus, setResultStatus] = useState("idle");
  const [gestureGuide, setGestureGuide] = useState({ open: false, source: null });
  const [gestureGuideSeen, setGestureGuideSeen] = useState(() => {
    try {
      const seen = window.localStorage.getItem(MOBILE_GESTURE_GUIDE_KEY) === "seen";
      gestureGuideSeenRef.current = seen;
      return seen;
    } catch {
      return false;
    }
  });

  const syncHud = useCallback((updateIntegrity = true) => {
    const game = gameRef.current;
    const nextHud = hudSnapshot(game);
    if (updateIntegrity) {
      setHud({ ...nextHud, integrity: ringIntegrity(game) });
    } else {
      setHud((current) => ({ ...nextHud, integrity: current.integrity }));
    }
  }, []);

  const redraw = useCallback(() => drawScene(canvasRef.current, gameRef.current), []);

  useEffect(() => {
    let active = true;
    getProfile()
      .then(({ player }) => {
        if (!active) return;
        if (player) {
          setProfile({ status: "ready", player });
        } else {
          setProfile({ status: "needs-name", player: null });
          setNameDialogOpen(true);
        }
      })
      .catch(() => {
        if (active) setProfile({ status: "offline", player: null });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(hud.best));
    } catch {
      // The game remains playable when storage is unavailable.
    }
  }, [hud.best]);

  useEffect(() => {
    if (profile.status !== "ready") return undefined;
    let active = true;

    const flushPendingResults = async () => {
      let savedAny = false;
      for (const result of pendingGameResults()) {
        try {
          await submitGameResult(result);
          removePendingGameResult(result.gameId);
          savedAny = true;
        } catch {
          break;
        }
      }
      if (active && savedAny) setLeaderboardRefreshKey((value) => value + 1);
    };

    void flushPendingResults();
    return () => { active = false; };
  }, [profile.status]);

  const deliverGameResult = useCallback((result, { silent = false } = {}) => {
    queueGameResult(result);
    if (profile.status !== "ready") {
      if (!silent) setResultStatus("offline");
      return Promise.resolve(false);
    }

    if (!silent) setResultStatus("submitting");
    return submitGameResult(result)
      .then(() => {
        removePendingGameResult(result.gameId);
        if (!silent) setResultStatus("saved");
        setLeaderboardRefreshKey((value) => value + 1);
        return true;
      })
      .catch(() => {
        if (!silent) setResultStatus("error");
        return false;
      });
  }, [profile.status]);

  const finalizeGame = useCallback((game, endedReason, options) => {
    const result = gameResultFrom(game, endedReason);
    if (!result || finalizedGameIdsRef.current.has(result.gameId)) return Promise.resolve(false);
    finalizedGameIdsRef.current.add(result.gameId);
    return deliverGameResult(result, options);
  }, [deliverGameResult]);

  const act = useCallback((action) => {
    const game = gameRef.current;
    const activeBefore = game.active;
    const modeBefore = game.mode;
    let changed = false;
    if (action === "pause" || action === "restart") clearMobileInputsRef.current();
    if (action === "left") changed = moveAround(game, -1);
    if (action === "right") changed = moveAround(game, 1);
    if (action === "rotate") changed = rotatePiece(game, 1);
    if (action === "counterRotate") changed = rotatePiece(game, -1);
    if (action === "down") changed = stepInward(game, true);
    if (action === "drop") changed = hardDrop(game) >= 0;
    if (action === "pause") { pauseGame(game); changed = true; }
    if (action === "restart") {
      void finalizeGame(game, "restart");
      resetGame(game);
      setResultStatus("idle");
      changed = true;
    }
    if (game.active !== activeBefore) clearMobileInputsRef.current();
    if (game.active !== activeBefore || game.mode !== modeBefore) changed = true;
    if (changed) {
      syncHud(action === "restart" || game.active !== activeBefore);
      redraw();
      refreshGameLoopRef.current();
    }
  }, [finalizeGame, redraw, syncHud]);

  const clearMobileGesture = useCallback((pointerId) => {
    const gesture = mobileGestureRef.current;
    if (!gesture || (pointerId != null && gesture.pointerId !== pointerId)) return false;
    gesture.stopped = true;
    if (gesture.holdTimerId) window.clearTimeout(gesture.holdTimerId);
    if (mobileGestureFrameRef.current) cancelAnimationFrame(mobileGestureFrameRef.current);
    mobileGestureFrameRef.current = 0;
    pendingMobilePointRef.current = null;
    mobileGestureRef.current = null;
    try {
      if (gesture.target?.hasPointerCapture?.(gesture.pointerId)) {
        gesture.target.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // Capture may be unavailable or already released by the browser.
    }
    return true;
  }, []);

  const clearMobileInputs = useCallback(() => {
    clearMobileGesture();
  }, [clearMobileGesture]);

  clearMobileInputsRef.current = clearMobileInputs;

  const applyMobileOrbitSteps = useCallback((gesture) => {
    const steps = Math.min(4, Math.floor(Math.abs(gesture.orbitAccumulator) / MOBILE_GESTURE_STEP_PX));
    if (!steps) return false;
    const direction = Math.sign(gesture.orbitAccumulator);
    let moved = false;
    for (let step = 0; step < steps; step += 1) {
      moved = moveAround(gameRef.current, direction) || moved;
    }
    gesture.orbitAccumulator -= direction * steps * MOBILE_GESTURE_STEP_PX;
    if (moved) {
      syncHud(false);
      redraw();
      if (navigator.vibrate) navigator.vibrate(5);
    }
    return moved;
  }, [redraw, syncHud]);

  const applyMobileHoldNudge = useCallback(function applyMobileHoldNudge(gesture) {
    if (!gesture || gesture.stopped || mobileGestureRef.current !== gesture) return;
    if (gameRef.current.mode !== "playing" || gameRef.current.active !== gesture.active) {
      clearMobileGesture(gesture.pointerId);
      return;
    }
    if (gesture.intent !== "pending" && gesture.intent !== "hold") return;
    if (gesture.intent === "pending" && gesture.travelDistance > MOBILE_GESTURE_SLOP_PX) return;

    gesture.intent = "hold";
    gesture.holdActive = true;
    const activeBefore = gameRef.current.active;
    const moved = stepInward(gameRef.current, true);
    const pieceChanged = gameRef.current.active !== activeBefore;
    if (moved || pieceChanged) {
      syncHud(pieceChanged);
      redraw();
      refreshGameLoopRef.current();
      if (navigator.vibrate) navigator.vibrate(5);
    }
    if (pieceChanged) {
      clearMobileGesture(gesture.pointerId);
      return;
    }
    gesture.holdTimerId = window.setTimeout(
      () => applyMobileHoldNudge(gesture),
      MOBILE_HOLD_NUDGE_REPEAT_MS,
    );
  }, [clearMobileGesture, redraw, syncHud]);

  const processMobileGesturePoint = useCallback((gesture, point) => {
    if (!gesture || gesture.stopped || mobileGestureRef.current !== gesture) return;
    if (gameRef.current.mode !== "playing" || gameRef.current.active !== gesture.active) {
      clearMobileGesture(gesture.pointerId);
      return;
    }

    const x = point.clientX - gesture.centerX;
    const y = point.clientY - gesture.centerY;
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const segmentArc = shortestAngleDelta(angle, gesture.lastAngle)
      * Math.max(40, (radius + gesture.lastRadius) / 2);
    gesture.lastAngle = angle;
    gesture.lastRadius = radius;
    gesture.lastX = point.clientX;
    gesture.lastY = point.clientY;
    gesture.totalTangential += segmentArc;
    gesture.orbitAccumulator += segmentArc;
    gesture.inwardDistance = Math.max(0, gesture.startRadius - radius);
    gesture.outwardDistance = Math.max(0, radius - gesture.startRadius);
    gesture.travelDistance = Math.hypot(point.clientX - gesture.startX, point.clientY - gesture.startY);
    gesture.lastPointTime = point.time;

    const tangential = Math.abs(gesture.totalTangential);
    const inward = gesture.inwardDistance;
    if (gesture.intent === "hold") return;
    if (gesture.intent === "pending" && gesture.travelDistance >= MOBILE_GESTURE_SLOP_PX) {
      if (gesture.outwardDistance >= MOBILE_GESTURE_SLOP_PX
        && gesture.outwardDistance >= tangential * MOBILE_GESTURE_DOMINANCE) {
        gesture.intent = "ignored";
      } else if (tangential >= MOBILE_GESTURE_SLOP_PX
        && tangential >= inward * MOBILE_GESTURE_DOMINANCE) {
        gesture.intent = "orbit";
      } else if (inward >= MOBILE_GESTURE_SLOP_PX
        && inward >= tangential * MOBILE_GESTURE_DOMINANCE) {
        gesture.intent = "flick";
      } else if (gesture.travelDistance >= MOBILE_GESTURE_RESOLVE_PX) {
        gesture.intent = inward > tangential ? "flick" : tangential > inward ? "orbit" : "ignored";
      }
    }

    if (gesture.intent !== "pending" && gesture.holdTimerId) {
      window.clearTimeout(gesture.holdTimerId);
      gesture.holdTimerId = 0;
    }

    if (gesture.intent === "orbit") {
      applyMobileOrbitSteps(gesture);
    }
  }, [applyMobileOrbitSteps, clearMobileGesture]);

  const flushMobileGestureFrame = useCallback(function flushMobileGestureFrame() {
    mobileGestureFrameRef.current = 0;
    const gesture = mobileGestureRef.current;
    if (!gesture || gesture.stopped) return;

    const point = pendingMobilePointRef.current;
    pendingMobilePointRef.current = null;
    if (point) processMobileGesturePoint(gesture, point);
    if (mobileGestureRef.current !== gesture || gesture.stopped) return;

    if (!point && gesture.intent === "orbit") applyMobileOrbitSteps(gesture);
    if (mobileGestureRef.current !== gesture || gesture.stopped) return;

    const hasOrbitBacklog = gesture.intent === "orbit"
      && Math.abs(gesture.orbitAccumulator) >= MOBILE_GESTURE_STEP_PX;
    if (pendingMobilePointRef.current || hasOrbitBacklog) {
      mobileGestureFrameRef.current = requestAnimationFrame(flushMobileGestureFrame);
    } else if (gesture.released) {
      clearMobileGesture(gesture.pointerId);
    }
  }, [applyMobileOrbitSteps, clearMobileGesture, processMobileGesturePoint]);

  const beginMobileGesture = useCallback((event) => {
    if (gameRef.current.mode !== "playing" || gestureGuideRef.current.open) return;
    event.preventDefault();
    const existing = mobileGestureRef.current;
    if (existing && existing.pointerId !== event.pointerId) return;
    if (existing) clearMobileGesture(existing.pointerId);
    const target = event.currentTarget;
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Global pointer-end listeners provide the fallback when capture is unavailable.
    }
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const x = event.clientX - centerX;
    const y = event.clientY - centerY;
    const now = performance.now();
    const gesture = {
      pointerId: event.pointerId,
      target,
      active: gameRef.current.active,
      stopped: false,
      startTime: now,
      lastPointTime: now,
      centerX,
      centerY,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startRadius: Math.hypot(x, y),
      lastRadius: Math.hypot(x, y),
      lastAngle: Math.atan2(y, x),
      intent: "pending",
      totalTangential: 0,
      orbitAccumulator: 0,
      inwardDistance: 0,
      outwardDistance: 0,
      travelDistance: 0,
      holdActive: false,
      holdTimerId: 0,
      released: false,
    };
    mobileGestureRef.current = gesture;
    gesture.holdTimerId = window.setTimeout(
      () => applyMobileHoldNudge(gesture),
      MOBILE_HOLD_NUDGE_DELAY_MS,
    );
  }, [applyMobileHoldNudge, clearMobileGesture]);

  const moveMobileGesture = useCallback((event) => {
    const gesture = mobileGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    pendingMobilePointRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      time: performance.now(),
    };
    if (mobileGestureFrameRef.current) return;
    mobileGestureFrameRef.current = requestAnimationFrame(flushMobileGestureFrame);
  }, [flushMobileGestureFrame]);

  const finishMobileGesture = useCallback((event) => {
    const gesture = mobileGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault?.();
    if (mobileGestureFrameRef.current) cancelAnimationFrame(mobileGestureFrameRef.current);
    mobileGestureFrameRef.current = 0;
    pendingMobilePointRef.current = null;
    const point = { clientX: event.clientX, clientY: event.clientY, time: performance.now() };
    processMobileGesturePoint(gesture, point);
    if (mobileGestureRef.current !== gesture || gesture.stopped) return;

    const elapsed = Math.max(1, point.time - gesture.startTime);
    if (gesture.intent === "pending"
      && gesture.travelDistance <= MOBILE_TAP_SLOP_PX
      && elapsed <= MOBILE_TAP_MAX_MS) {
      act("rotate");
      if (navigator.vibrate) navigator.vibrate(6);
    } else if (gesture.intent === "flick") {
      const inwardVelocity = gesture.inwardDistance / elapsed;
      const isHardDrop = gesture.inwardDistance >= MOBILE_FLICK_MIN_PX
        && elapsed <= MOBILE_FLICK_MAX_MS
        && inwardVelocity >= MOBILE_FLICK_MIN_VELOCITY
        && gesture.inwardDistance >= Math.abs(gesture.totalTangential) * MOBILE_GESTURE_DOMINANCE;
      if (isHardDrop) {
        act("drop");
        if (navigator.vibrate) navigator.vibrate(14);
      }
    }
    if (mobileGestureRef.current !== gesture || gesture.stopped) return;
    gesture.released = true;
    const hasOrbitBacklog = gesture.intent === "orbit"
      && Math.abs(gesture.orbitAccumulator) >= MOBILE_GESTURE_STEP_PX;
    if (hasOrbitBacklog) {
      mobileGestureFrameRef.current = requestAnimationFrame(flushMobileGestureFrame);
    } else {
      clearMobileGesture(gesture.pointerId);
    }
  }, [act, clearMobileGesture, flushMobileGestureFrame, processMobileGesturePoint]);

  const cancelMobileGesture = useCallback((event) => {
    clearMobileGesture(event?.pointerId);
  }, [clearMobileGesture]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") clearMobileInputs();
    };
    window.addEventListener("blur", clearMobileInputs);
    window.addEventListener("pointerup", finishMobileGesture);
    window.addEventListener("pointercancel", cancelMobileGesture);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearMobileInputs);
      window.removeEventListener("pointerup", finishMobileGesture);
      window.removeEventListener("pointercancel", cancelMobileGesture);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearMobileInputs();
    };
  }, [cancelMobileGesture, clearMobileInputs, finishMobileGesture]);

  useEffect(() => {
    if (hud.mode !== "playing") clearMobileInputs();
  }, [clearMobileInputs, hud.mode]);

  const stopGestureGuideTimer = useCallback((preserveRemaining = false) => {
    const timer = gestureGuideTimerRef.current;
    if (timer.id) {
      if (preserveRemaining && timer.startedAt) {
        timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.startedAt));
      }
      window.clearTimeout(timer.id);
    }
    timer.id = 0;
    timer.startedAt = 0;
    if (!preserveRemaining) timer.remaining = MOBILE_GUIDE_HELP_MS;
  }, []);

  const scheduleGestureGuideTimer = useCallback(() => {
    const guide = gestureGuideRef.current;
    const timer = gestureGuideTimerRef.current;
    if (!guide.open || guide.source !== "help" || document.visibilityState !== "visible" || timer.id) return;
    if (timer.remaining <= 0) {
      dismissGestureGuideRef.current();
      return;
    }
    timer.startedAt = performance.now();
    timer.id = window.setTimeout(() => {
      timer.id = 0;
      timer.startedAt = 0;
      timer.remaining = 0;
      dismissGestureGuideRef.current();
    }, timer.remaining);
  }, []);

  const openGestureGuide = useCallback((source, resumeOnClose) => {
    stopGestureGuideTimer(false);
    const guide = { open: true, source, resumeOnClose };
    gestureGuideRef.current = guide;
    setGestureGuide({ open: true, source });
    if (source === "help") scheduleGestureGuideTimer();
  }, [scheduleGestureGuideTimer, stopGestureGuideTimer]);

  const dismissGestureGuide = useCallback(() => {
    const guide = gestureGuideRef.current;
    if (!guide.open) return;
    stopGestureGuideTimer(false);
    gestureGuideRef.current = { open: false, source: null, resumeOnClose: false };
    setGestureGuide({ open: false, source: null });
    if (guide.source === "first") {
      gestureGuideSeenRef.current = true;
      setGestureGuideSeen(true);
      try {
        window.localStorage.setItem(MOBILE_GESTURE_GUIDE_KEY, "seen");
      } catch {
        // Keep the guide dismissed for this page session when storage is unavailable.
      }
    }
    if (guide.resumeOnClose && gameRef.current.mode === "paused") {
      pauseGame(gameRef.current);
      syncHud();
      redraw();
      refreshGameLoopRef.current();
    }
    canvasRef.current?.focus();
  }, [redraw, stopGestureGuideTimer, syncHud]);

  dismissGestureGuideRef.current = dismissGestureGuide;

  useEffect(() => {
    if (!gestureGuide.open) return;
    gestureGuideDialogRef.current?.focus();
  }, [gestureGuide.open]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleGestureGuideTimer();
      else stopGestureGuideTimer(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopGestureGuideTimer(false);
    };
  }, [scheduleGestureGuideTimer, stopGestureGuideTimer]);

  const showGestureHelp = useCallback(() => {
    if (!isMobileGestureViewport() || gestureGuideRef.current.open || gameRef.current.mode !== "playing") return;
    clearMobileInputsRef.current();
    pauseGame(gameRef.current);
    syncHud();
    redraw();
    refreshGameLoopRef.current();
    openGestureGuide("help", true);
  }, [openGestureGuide, redraw, syncHud]);

  const start = useCallback((difficulty = "normal") => {
    if (profile.status === "loading") return;
    if (profile.status === "needs-name") {
      setNameDialogOpen(true);
      return;
    }
    clearMobileInputsRef.current();
    const gameIdBefore = gameRef.current.gameId;
    const showFirstGestureGuide = gameRef.current.mode === "ready"
      && isMobileGestureViewport()
      && !gestureGuideSeenRef.current;
    if (gameRef.current.mode === "gameover") void finalizeGame(gameRef.current, "gameover");
    if (gameRef.current.mode === "ready") {
      setDifficulty(gameRef.current, typeof difficulty === "string" ? difficulty : "normal");
    }
    startGame(gameRef.current);
    if (showFirstGestureGuide) {
      pauseGame(gameRef.current);
      openGestureGuide("first", true);
    }
    if (gameRef.current.gameId !== gameIdBefore) setResultStatus("idle");
    syncHud();
    redraw();
    refreshGameLoopRef.current();
    if (!showFirstGestureGuide) canvasRef.current?.focus();
  }, [finalizeGame, openGestureGuide, profile.status, redraw, syncHud]);

  const savePlayerName = useCallback(async (name) => {
    const { player } = await saveProfile(name);
    setProfile({ status: "ready", player });
    setNameDialogOpen(false);
  }, []);

  const editPlayerName = useCallback(() => {
    setLeaderboardOpen(false);
    setNameDialogOpen(true);
  }, []);

  const continueOffline = useCallback(() => {
    setProfile({ status: "offline", player: null });
    setNameDialogOpen(false);
  }, []);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = hud.mode;
    if (previousMode === "gameover" || hud.mode !== "gameover") return;

    void finalizeGame(gameRef.current, "gameover");
  }, [finalizeGame, hud.mode]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const game = gameRef.current;
      if (document.visibilityState === "hidden") {
        const checkpoint = gameResultFrom(game, "pagehide");
        if (checkpoint && !finalizedGameIdsRef.current.has(checkpoint.gameId)) queueGameResult(checkpoint);
      } else if (!finalizedGameIdsRef.current.has(game.gameId)) {
        removePendingGameResult(game.gameId);
      }
    };
    const onPageHide = (event) => {
      if (!event.persisted) void finalizeGame(gameRef.current, "pagehide", { silent: true });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [finalizeGame]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameRef.current?.requestFullscreen();
    } catch {
      gameRef.current.message = "Fullscreen unavailable";
      syncHud(false);
    }
  }, [syncHud]);

  useEffect(() => {
    let animationId = 0;
    let disposed = false;
    let previous = performance.now();

    const shouldRun = () => {
      const game = gameRef.current;
      return document.visibilityState === "visible" && (
        game.mode === "playing" || game.clearFlash > 0 || game.particles.length > 0
      );
    };

    const requestNextFrame = () => {
      if (disposed || animationId || !shouldRun()) return;
      animationId = requestAnimationFrame(frame);
    };

    const refreshGameLoop = () => {
      if (disposed) return;
      if (!shouldRun()) {
        if (animationId) cancelAnimationFrame(animationId);
        animationId = 0;
        return;
      }
      if (!animationId) {
        previous = performance.now();
        requestNextFrame();
      }
    };

    const frame = (now) => {
      animationId = 0;
      if (disposed) return;
      const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      const game = gameRef.current;
      const hudBefore = {
        active: game.active,
        activeRing: game.active?.ring,
        mode: game.mode,
        score: game.score,
        best: game.best,
        level: game.level,
        ringsCleared: game.ringsCleared,
        combo: game.combo,
        nextType: game.nextType,
        message: game.message,
      };
      const sceneChanged = updateGame(game, delta);
      if (game.active !== hudBefore.active) clearMobileInputsRef.current();
      if (sceneChanged) {
        drawScene(canvasRef.current, game);
        const hudChanged = (
          game.active !== hudBefore.active
          || game.active?.ring !== hudBefore.activeRing
          || game.mode !== hudBefore.mode
          || game.score !== hudBefore.score
          || game.best !== hudBefore.best
          || game.level !== hudBefore.level
          || game.ringsCleared !== hudBefore.ringsCleared
          || game.combo !== hudBefore.combo
          || game.nextType !== hudBefore.nextType
          || game.message !== hudBefore.message
        );
        if (hudChanged) syncHud(game.active !== hudBefore.active);
      }
      requestNextFrame();
    };

    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      const gameKeys = ["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "enter", "a", "d", "w", "s", "x", "z", "p", "r", "f", "escape"];
      if (gestureGuideRef.current.open) {
        if (gameKeys.includes(key)) event.preventDefault();
        if (key === "escape") dismissGestureGuideRef.current();
        return;
      }
      if (document.querySelector("[data-game-input-blocking='true']")) return;
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
    const onVisibilityChange = () => {
      previous = performance.now();
      refreshGameLoop();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    drawScene(canvasRef.current, gameRef.current);
    refreshGameLoopRef.current = refreshGameLoop;
    refreshGameLoop();
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
      disposed = true;
      if (animationId) cancelAnimationFrame(animationId);
      if (refreshGameLoopRef.current === refreshGameLoop) refreshGameLoopRef.current = () => {};
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
    syncHud(false);
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

  const beginBoardPointer = useCallback((event) => {
    if (isMobileGestureViewport()) {
      beginMobileGesture(event);
      return;
    }
    pointerRef.current = { active: true, sector: null };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Desktop dragging remains usable even when pointer capture is unavailable.
    }
    orbitToPointer(event);
  }, [beginMobileGesture, orbitToPointer]);

  const moveBoardPointer = useCallback((event) => {
    if (mobileGestureRef.current) moveMobileGesture(event);
    else if (pointerRef.current.active) orbitToPointer(event);
  }, [moveMobileGesture, orbitToPointer]);

  const finishBoardPointer = useCallback((event) => {
    if (mobileGestureRef.current) finishMobileGesture(event);
    else finishPointerOrbit();
  }, [finishMobileGesture, finishPointerOrbit]);

  const cancelBoardPointer = useCallback((event) => {
    if (mobileGestureRef.current) cancelMobileGesture(event);
    else finishPointerOrbit();
  }, [cancelMobileGesture, finishPointerOrbit]);

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
  const resultStatusCopy = {
    submitting: "Transmitting result…",
    saved: "Leaderboard updated",
    error: "Result could not be saved",
    offline: "Offline game · result not submitted",
  }[resultStatus];

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
          <div className="player-tools">
            {profile.player && <button className="player-callsign" type="button" onClick={() => setNameDialogOpen(true)}>{profile.player.name}</button>}
            <button className="leaderboard-trigger" type="button" onClick={() => setLeaderboardOpen(true)}>Leaderboard</button>
          </div>
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
              aria-label="Circular Tetris board. On mobile, swipe along the ring to orbit, tap to rotate clockwise, hold to soft drop, or quickly swipe inward and release to hard drop."
              onPointerDown={beginBoardPointer}
              onPointerMove={moveBoardPointer}
              onPointerUp={finishBoardPointer}
              onPointerCancel={cancelBoardPointer}
              onLostPointerCapture={cancelBoardPointer}
            />
            <div className="frame-label frame-label-bottom">16θ / 10r / CORE ORIGIN 0,0</div>
            {gestureGuideSeen && hud.mode === "playing" && !gestureGuide.open && (
              <button
                id="mobile-gesture-help"
                className="mobile-gesture-help"
                type="button"
                aria-label="Show mobile gesture guide"
                onClick={showGestureHelp}
              >
                <span className="mobile-gesture-help-mark" aria-hidden="true">?</span>
              </button>
            )}
            {gestureGuide.open ? (
              <div
                id="mobile-gesture-guide"
                className="gesture-guide-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="gesture-guide-title"
                data-game-input-blocking="true"
                tabIndex="-1"
                ref={gestureGuideDialogRef}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) dismissGestureGuide();
                }}
              >
                <section className="gesture-guide-card">
                  <span className="eyebrow">Mobile field gestures</span>
                  <h2 id="gesture-guide-title">Swipe the board</h2>
                  <p>The whole polar field is your controller.</p>
                  <div className="gesture-guide-list" aria-label="Mobile gesture controls">
                    <div className="gesture-guide-row"><strong>Swipe arc</strong><span>Orbit</span></div>
                    <div className="gesture-guide-row"><strong>Tap</strong><span>Rotate clockwise</span></div>
                    <div className="gesture-guide-row"><strong>Hold</strong><span>Soft drop</span></div>
                    <div className="gesture-guide-row is-hard-drop"><strong>Quick swipe in</strong><span>Hard drop</span></div>
                  </div>
                  <small>{gestureGuide.source === "first" ? "Tap outside to start" : "Tap outside to return · closes after 15 seconds"}</small>
                </section>
              </div>
            ) : isOverlayVisible && (
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
                  </>}
                  {hud.mode === "gameover" && resultStatusCopy && <small className={`result-status is-${resultStatus}`}>{resultStatusCopy}</small>}
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

      <div className="mobile-footer-credit">
        <span>2026 | Created and delivered by </span><a href="https://github.com/kstroevsky" target="_blank" rel="noreferrer">kstroevsky</a>
      </div>

      <footer className="footer-line">
        <span>EXPONENTIAL FIELD MAPPING</span>
        <p>Close every angular segment to collapse a ring.</p>
        <span className="footer-credit">2026 | Created and delivered by <a href="https://github.com/kstroevsky" target="_blank" rel="noreferrer">kstroevsky</a></span>
      </footer>

      <PlayerNameDialog
        open={nameDialogOpen}
        initialName={profile.player?.name ?? ""}
        required={profile.status === "needs-name"}
        onSave={savePlayerName}
        onCancel={() => setNameDialogOpen(false)}
        onPlayOffline={continueOffline}
      />
      <Leaderboard
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        playerName={profile.player?.name}
        onEditName={editPlayerName}
        refreshKey={leaderboardRefreshKey}
      />
    </main>
  );
}
