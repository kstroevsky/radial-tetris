export const SECTORS = 16;
export const RINGS = 10;

export const PIECES = {
  I: [[-1, 0], [0, 0], [1, 0], [2, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[-1, 0], [0, 0], [1, 0], [0, 1]],
  L: [[-1, 0], [0, 0], [1, 0], [1, 1]],
  J: [[-1, 1], [-1, 0], [0, 0], [1, 0]],
  S: [[-1, 0], [0, 0], [0, 1], [1, 1]],
  Z: [[-1, 1], [0, 1], [0, 0], [1, 0]],
};

export const PIECE_COLORS = {
  I: "#45e7ff",
  O: "#f4e64e",
  T: "#bf78ff",
  L: "#ff9d45",
  J: "#5b8dff",
  S: "#55ef9f",
  Z: "#ff647c",
};

export const DIFFICULTIES = {
  easy: {
    label: "Easy",
    speedLabel: "Slow drop",
    intervalMultiplier: 1.34,
    minimumInterval: 0.18,
  },
  normal: {
    label: "Normal",
    speedLabel: "Standard drop",
    intervalMultiplier: 1,
    minimumInterval: 0.115,
  },
  hard: {
    label: "Hard",
    speedLabel: "Fast drop",
    intervalMultiplier: 0.7,
    minimumInterval: 0.075,
  },
};

const TYPES = Object.keys(PIECES);

function difficultyFor(game) {
  return DIFFICULTIES[game.difficulty] ?? DIFFICULTIES.normal;
}

export function makeBoard() {
  return Array.from({ length: RINGS }, () => Array(SECTORS).fill(null));
}

function takeType(bag) {
  if (bag.length === 0) {
    bag.push(...TYPES);
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[swap]] = [bag[swap], bag[index]];
    }
  }
  return bag.pop();
}

export function createGame() {
  const bag = [];
  return {
    mode: "ready",
    board: makeBoard(),
    active: null,
    nextType: takeType(bag),
    bag,
    score: 0,
    best: 0,
    difficulty: "normal",
    ringsCleared: 0,
    level: 1,
    combo: -1,
    fallAccumulator: 0,
    lastClear: [],
    clearFlash: 0,
    message: "Awaiting vector lock",
    particles: [],
  };
}

export function resetGame(game) {
  const best = Math.max(game.best || 0, game.score || 0);
  const difficulty = game.difficulty ?? "normal";
  Object.assign(game, createGame(), { best, difficulty });
  startGame(game);
}

export function setDifficulty(game, difficulty) {
  if (game.mode !== "ready" || !DIFFICULTIES[difficulty]) return false;
  game.difficulty = difficulty;
  game.message = `${DIFFICULTIES[difficulty].label} field selected`;
  return true;
}

export function startGame(game) {
  if (game.mode === "gameover") {
    resetGame(game);
    return;
  }
  game.mode = "playing";
  game.message = `${difficultyFor(game).label} vector acquired`;
  if (!game.active) spawnPiece(game);
}

export function pauseGame(game) {
  if (game.mode === "playing") {
    game.mode = "paused";
    game.message = "Orbit suspended";
  } else if (game.mode === "paused") {
    game.mode = "playing";
    game.message = "Vector reacquired";
  }
}

export function normalizeSector(sector) {
  return ((sector % SECTORS) + SECTORS) % SECTORS;
}

export function cellsFor(piece, overrides = {}) {
  const sector = overrides.sector ?? piece.sector;
  const ring = overrides.ring ?? piece.ring;
  const rotation = overrides.rotation ?? piece.rotation;

  return PIECES[piece.type].map(([baseSector, baseRing]) => {
    let angular = baseSector;
    let radial = baseRing;
    for (let turn = 0; turn < rotation; turn += 1) {
      [angular, radial] = [-radial, angular];
    }
    return {
      sector: normalizeSector(sector + angular),
      ring: ring + radial,
    };
  });
}

export function collides(game, piece, overrides = {}) {
  return cellsFor(piece, overrides).some(({ sector, ring }) => (
    ring < 0 || ring >= RINGS || Boolean(game.board[ring][sector])
  ));
}

export function spawnPiece(game) {
  const type = game.nextType;
  game.nextType = takeType(game.bag);
  const active = {
    type,
    sector: Math.floor(Math.random() * SECTORS),
    ring: RINGS - 2,
    rotation: Math.floor(Math.random() * 4),
    entrySector: 0,
  };
  active.entrySector = active.sector;

  const viableRotations = [active.rotation, 0, 1, 2, 3];
  let found = false;
  for (const rotation of viableRotations) {
    for (const ring of [RINGS - 2, RINGS - 3, RINGS - 1]) {
      if (!collides(game, active, { rotation, ring })) {
        active.rotation = rotation;
        active.ring = ring;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    game.active = active;
    game.mode = "gameover";
    game.best = Math.max(game.best, game.score);
    game.message = "Core field saturated";
    return false;
  }

  game.active = active;
  game.fallAccumulator = 0;
  game.message = `Inbound ${sectorDegrees(active.sector)}`;
  return true;
}

export function moveAround(game, direction) {
  if (game.mode !== "playing" || !game.active) return false;
  const sector = normalizeSector(game.active.sector + direction);
  if (!collides(game, game.active, { sector })) {
    game.active.sector = sector;
    game.message = `Orbit ${sectorDegrees(sector)}`;
    return true;
  }
  return false;
}

export function rotatePiece(game, direction = 1) {
  if (game.mode !== "playing" || !game.active) return false;
  const rotation = (game.active.rotation + direction + 4) % 4;
  const kicks = [
    [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0],
  ];
  for (const [sectorKick, ringKick] of kicks) {
    const sector = normalizeSector(game.active.sector + sectorKick);
    const ring = game.active.ring + ringKick;
    if (!collides(game, game.active, { rotation, sector, ring })) {
      game.active.rotation = rotation;
      game.active.sector = sector;
      game.active.ring = ring;
      game.message = direction > 0 ? "Spin clockwise" : "Spin counterclockwise";
      return true;
    }
  }
  return false;
}

export function stepInward(game, reward = false) {
  if (game.mode !== "playing" || !game.active) return false;
  const ring = game.active.ring - 1;
  if (!collides(game, game.active, { ring })) {
    game.active.ring = ring;
    if (reward) game.score += 1;
    return true;
  }
  lockPiece(game);
  return false;
}

export function hardDrop(game) {
  if (game.mode !== "playing" || !game.active) return 0;
  let distance = 0;
  while (!collides(game, game.active, { ring: game.active.ring - 1 })) {
    game.active.ring -= 1;
    distance += 1;
  }
  game.score += distance * 2;
  lockPiece(game);
  return distance;
}

export function ghostRing(game) {
  if (!game.active) return null;
  let ring = game.active.ring;
  while (!collides(game, game.active, { ring: ring - 1 })) ring -= 1;
  return ring;
}

function lockPiece(game) {
  const lockedCells = cellsFor(game.active);
  for (const cell of lockedCells) game.board[cell.ring][cell.sector] = game.active.type;

  const fullRings = [];
  for (let ring = 0; ring < RINGS; ring += 1) {
    if (game.board[ring].every(Boolean)) fullRings.push(ring);
  }

  if (fullRings.length > 0) {
    for (const ring of [...fullRings].sort((a, b) => b - a)) {
      game.board.splice(ring, 1);
      game.board.push(Array(SECTORS).fill(null));
    }
    game.combo += 1;
    game.ringsCleared += fullRings.length;
    const clearValue = [0, 600, 1500, 3000, 5200][Math.min(4, fullRings.length)];
    game.score += clearValue * game.level + Math.max(0, game.combo) * 250;
    game.lastClear = fullRings;
    game.clearFlash = 1;
    game.message = fullRings.length > 1 ? `${fullRings.length} rings collapsed` : "Ring collapsed";
    addClearParticles(game, fullRings);
  } else {
    game.combo = -1;
    game.lastClear = [];
    game.message = "Piece stabilized";
  }

  game.level = Math.floor(game.ringsCleared / 4) + 1;
  game.best = Math.max(game.best, game.score);
  game.active = null;
  spawnPiece(game);
}

function addClearParticles(game, rings) {
  for (const ring of rings) {
    for (let sector = 0; sector < SECTORS; sector += 2) {
      game.particles.push({
        sector,
        ring,
        life: 1,
        drift: (Math.random() - 0.5) * 1.6,
      });
    }
  }
}

export function updateGame(game, deltaSeconds) {
  let visualChanged = false;
  if (game.clearFlash > 0) {
    game.clearFlash = Math.max(0, game.clearFlash - deltaSeconds * 2.8);
    visualChanged = true;
  }

  if (game.particles.length > 0) {
    let writeIndex = 0;
    for (const particle of game.particles) {
      particle.life -= deltaSeconds * 1.45;
      particle.ring += deltaSeconds * 1.25;
      particle.sector += particle.drift * deltaSeconds;
      if (particle.life > 0) {
        game.particles[writeIndex] = particle;
        writeIndex += 1;
      }
    }
    game.particles.length = writeIndex;
    visualChanged = true;
  }

  if (game.mode !== "playing") return visualChanged;
  const difficulty = difficultyFor(game);
  const levelInterval = Math.max(0.115, 0.82 - (game.level - 1) * 0.07);
  const interval = Math.max(difficulty.minimumInterval, levelInterval * difficulty.intervalMultiplier);
  game.fallAccumulator += deltaSeconds;
  while (game.fallAccumulator >= interval && game.mode === "playing") {
    game.fallAccumulator -= interval;
    stepInward(game);
    visualChanged = true;
  }
  return visualChanged;
}

export function ringIntegrity(game) {
  return game.board.map((ring) => ring.filter(Boolean).length);
}

export function sectorDegrees(sector) {
  return `${String(Math.round(normalizeSector(sector) * (360 / SECTORS))).padStart(3, "0")}°`;
}

export function gameSnapshot(game) {
  const activeCells = game.active ? cellsFor(game.active) : [];
  return {
    coordinateSystem: "polar grid; sector 0 begins at 12 o'clock and increases clockwise; ring 0 is nearest the core and ring 9 is the outer edge",
    mode: game.mode,
    score: game.score,
    level: game.level,
    difficulty: game.difficulty,
    fallInterval: Math.max(
      difficultyFor(game).minimumInterval,
      Math.max(0.115, 0.82 - (game.level - 1) * 0.07) * difficultyFor(game).intervalMultiplier,
    ),
    ringsCleared: game.ringsCleared,
    combo: Math.max(0, game.combo),
    active: game.active ? {
      type: game.active.type,
      sector: game.active.sector,
      angleDegrees: normalizeSector(game.active.sector) * (360 / SECTORS),
      ring: game.active.ring,
      rotation: game.active.rotation,
      cells: activeCells,
      ghostRing: ghostRing(game),
    } : null,
    nextType: game.nextType,
    occupiedByRing: ringIntegrity(game),
    message: game.message,
  };
}
