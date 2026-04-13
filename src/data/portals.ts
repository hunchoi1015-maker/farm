// ================================================================
// data/portals.ts — 씬 전환 포털 정의
// ================================================================
//
// 각 씬의 출구/입구 통로 위치를 정의.
// 좌표 단위: 픽셀 (TILE_SIZE=16 기준)
//
// axis: 전환 시 유지되는 좌표 축
//   'x' → 수평 이동 (동/서), y좌표 유지
//   'y' → 수직 이동 (남/북), x좌표 유지
//
// rangeStart/rangeEnd: 통로 범위 (픽셀)
// fixedCoord: 경계선 위치 (픽셀)
// direction: 플레이어가 이동해야 하는 방향
// ================================================================

export type PortalDirection = 'up' | 'down' | 'left' | 'right';
export type PortalAxis = 'x' | 'y';

export interface PortalDef {
  axis:       PortalAxis;
  rangeStart: number;
  rangeEnd:   number;
  fixedCoord: number;
  direction:  PortalDirection;
}

// 타일 → 픽셀 변환 헬퍼
const T = 16;
const px = (tile: number) => tile * T;

// ── 포털 정의 ────────────────────────────────────────────────────

export const PORTALS: Record<string, PortalDef> = {

  // ── Village ─────────────────────────────────────────────────────
  'village→mountain': {
    axis: 'y', rangeStart: px(42), rangeEnd: px(52),
    fixedCoord: 0, direction: 'up',
  },
  'village→tidal_flat': {
    axis: 'x', rangeStart: px(25), rangeEnd: px(35),
    fixedCoord: 0, direction: 'left',
  },
  'village→beach': {
    axis: 'x', rangeStart: px(25), rangeEnd: px(35),
    fixedCoord: px(80), direction: 'right',
  },
  'village→north_yard': {
    axis: 'y', rangeStart: px(30), rangeEnd: px(36),
    fixedCoord: px(5), direction: 'up',
  },
  'village→south_yard': {
    axis: 'y', rangeStart: px(32), rangeEnd: px(38),
    fixedCoord: px(60), direction: 'down',
  },
  'village→shop': {
    axis: 'y', rangeStart: px(63), rangeEnd: px(67),
    fixedCoord: px(14), direction: 'up',
  },
  'village→library': {
    axis: 'y', rangeStart: px(13), rangeEnd: px(17),
    fixedCoord: px(40), direction: 'down',
  },

  // ── Mountain ─────────────────────────────────────────────────────
  'mountain→village': {
    axis: 'y', rangeStart: px(25), rangeEnd: px(35),
    fixedCoord: px(50), direction: 'down',
  },
  'mountain→cliff_path': {
    axis: 'x', rangeStart: px(20), rangeEnd: px(30),
    fixedCoord: 0, direction: 'left',
  },
  'mountain→mountain_path': {
    axis: 'x', rangeStart: px(20), rangeEnd: px(30),
    fixedCoord: px(60), direction: 'right',
  },

  // ── NorthYard ────────────────────────────────────────────────────
  'north_yard→village': {
    axis: 'y', rangeStart: px(16), rangeEnd: px(24),
    fixedCoord: px(40), direction: 'down',
  },
  'north_yard→mountain': {
    axis: 'y', rangeStart: px(16), rangeEnd: px(24),
    fixedCoord: 0, direction: 'up',
  },
  'north_yard→north_house': {
    axis: 'y', rangeStart: px(18), rangeEnd: px(22),
    fixedCoord: px(8), direction: 'up',
  },

  // ── SouthYard ────────────────────────────────────────────────────
  'south_yard→village': {
    axis: 'y', rangeStart: px(16), rangeEnd: px(24),
    fixedCoord: 0, direction: 'up',
  },
  'south_yard→library': {
    axis: 'y', rangeStart: px(16), rangeEnd: px(24),
    fixedCoord: px(40), direction: 'down',
  },
  'south_yard→south_house': {
    axis: 'y', rangeStart: px(18), rangeEnd: px(22),
    fixedCoord: px(32), direction: 'down',
  },

  // ── NorthHouse ───────────────────────────────────────────────────
  'north_house→north_yard': {
    axis: 'y', rangeStart: px(8), rangeEnd: px(12),
    fixedCoord: px(16), direction: 'down',
  },

  // ── SouthHouse ───────────────────────────────────────────────────
  'south_house→south_yard': {
    axis: 'y', rangeStart: px(8), rangeEnd: px(12),
    fixedCoord: px(16), direction: 'down',
  },

  // ── TidalFlat ────────────────────────────────────────────────────
  'tidal_flat→village': {
    axis: 'x', rangeStart: px(3), rangeEnd: px(13),
    fixedCoord: px(50), direction: 'right',
  },
  'tidal_flat→cliff_path': {
    axis: 'x', rangeStart: px(3), rangeEnd: px(13),
    fixedCoord: 0, direction: 'up',
  },

  // ── Beach ─────────────────────────────────────────────────────────
  'beach→village': {
    axis: 'x', rangeStart: px(15), rangeEnd: px(25),
    fixedCoord: 0, direction: 'left',
  },
  'beach→mountain_path': {
    axis: 'x', rangeStart: px(3), rangeEnd: px(13),
    fixedCoord: 0, direction: 'up',
  },

  // ── CliffPath ─────────────────────────────────────────────────────
  'cliff_path→mountain': {
    axis: 'y', rangeStart: px(6), rangeEnd: px(14),
    fixedCoord: 0, direction: 'up',
  },
  'cliff_path→tidal_flat': {
    axis: 'y', rangeStart: px(6), rangeEnd: px(14),
    fixedCoord: px(30), direction: 'down',
  },

  // ── MountainPath ──────────────────────────────────────────────────
  'mountain_path→mountain': {
    axis: 'y', rangeStart: px(6), rangeEnd: px(14),
    fixedCoord: 0, direction: 'up',
  },
  'mountain_path→beach': {
    axis: 'y', rangeStart: px(6), rangeEnd: px(14),
    fixedCoord: px(30), direction: 'down',
  },

  // ── Shop ──────────────────────────────────────────────────────────
  'shop→village': {
    axis: 'y', rangeStart: px(8), rangeEnd: px(16),
    fixedCoord: px(20), direction: 'down',
  },

  // ── Library ───────────────────────────────────────────────────────
  'library→village': {
    axis: 'y', rangeStart: px(8), rangeEnd: px(16),
    fixedCoord: px(20), direction: 'down',
  },
  'library→south_yard': {
    axis: 'y', rangeStart: px(8), rangeEnd: px(16),
    fixedCoord: px(20), direction: 'down',
  },
};

// ── 좌표 변환 유틸 ───────────────────────────────────────────────

/**
 * 이전 씬 통로 내 좌표를 다음 씬 통로 좌표로 변환.
 */
export function mapPortalCoord(
  playerCoord: number,
  fromKey: string,
  toKey: string,
): number {
  const from = PORTALS[fromKey];
  const to   = PORTALS[toKey];
  if (!from || !to) return -1;

  // 통로 내 상대 비율 (0~1), 범위 밖이면 클램프
  const ratio = Math.max(0, Math.min(1,
    (playerCoord - from.rangeStart) / (from.rangeEnd - from.rangeStart)
  ));

  return to.rangeStart + ratio * (to.rangeEnd - to.rangeStart);
}

/**
 * 방향별 velocity 체크.
 * velocity가 threshold 이상이면 해당 방향으로 이동 중으로 판정.
 */
export function isMovingToward(
  vx: number, vy: number,
  direction: PortalDirection,
  threshold = 10
): boolean {
  switch (direction) {
    case 'up':    return vy < -threshold;
    case 'down':  return vy >  threshold;
    case 'left':  return vx < -threshold;
    case 'right': return vx >  threshold;
  }
}

/**
 * 포털 키 생성 헬퍼.
 */
export function portalKey(from: string, to: string): string {
  return `${from}→${to}`;
}