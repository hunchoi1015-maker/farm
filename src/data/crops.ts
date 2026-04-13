// ================================================================
// data/crops.ts — 작물 정적 데이터
// ================================================================

import type { Season } from '../types';

export interface CropData {
  id: string;
  label: string;
  season: Season;
  growthDays: number;     // 심은 날 제외, 성장에 필요한 날 수
  buyPrice: number;       // 씨앗 구매가
  sellPrice: number;      // 작물 판매가
  canDonate: boolean;     // 박물관 기증 가능 여부
  regrows: boolean;       // 수확 후 줄기 재수확 가능 여부
  baseExp: number;        // 수확 시 기본 농사 경험치
}

export const CROP_DATA: Record<string, CropData> = {
  strawberry: {
    id:         'strawberry',
    label:      '딸기',
    season:     'spring',
    growthDays: 4,
    buyPrice:   100,
    sellPrice:  120,
    canDonate:  true,
    regrows:    true,
    baseExp:    2,
  },
  spinach: {
    id:         'spinach',
    label:      '시금치',
    season:     'spring',
    growthDays: 2,
    buyPrice:   50,
    sellPrice:  60,
    canDonate:  false,
    regrows:    false,
    baseExp:    5,
  },
  cucumber: {
    id:         'cucumber',
    label:      '오이',
    season:     'summer',
    growthDays: 3,
    buyPrice:   80,
    sellPrice:  96,
    canDonate:  false,
    regrows:    true,
    baseExp:    5,
  },
  pepper: {
    id:         'pepper',
    label:      '고추',
    season:     'summer',
    growthDays: 5,
    buyPrice:   150,
    sellPrice:  180,
    canDonate:  true,
    regrows:    true,
    baseExp:    2,
  },
  rice: {
    id:         'rice',
    label:      '벼',
    season:     'autumn',
    growthDays: 7,
    buyPrice:   150,
    sellPrice:  300,
    canDonate:  true,
    regrows:    false,
    baseExp:    20,
  },
};

// ── 씨앗 id 매핑 ────────────────────────────────────────────────

/** 작물 id → 씨앗 id */
export const CROP_TO_SEED: Record<string, string> = {
  strawberry: 'seed_strawberry',
  spinach:    'seed_spinach',
  cucumber:   'seed_cucumber',
  pepper:     'seed_pepper',
  rice:       'seed_rice',
};

/** 씨앗 id → 작물 id */
export const SEED_TO_CROP: Record<string, string> = Object.fromEntries(
  Object.entries(CROP_TO_SEED).map(([crop, seed]) => [seed, crop])
);

/** 씨앗 id인지 확인 */
export function isSeedId(itemId: string): boolean {
  return itemId.startsWith('seed_');
}

// ── 음식 데이터 ─────────────────────────────────────────────────

export interface FoodData {
  id: string;
  label: string;
  energyRestore: number;  // 기력 회복량
}

export const FOOD_DATA: Record<string, FoodData> = {
  // 이장 NPC 협동 보상 음식
  mayor_lunchbox: {
    id:             'mayor_lunchbox',
    label:          '이장 도시락',
    energyRestore:  50,
  },
  // 추후 요리 시스템 추가 시 여기에 확장
};

// ── 농사 레벨 데이터 ────────────────────────────────────────────

export interface FarmLevelData {
  level: number;
  requiredExp: number;
  label: string;
}

export const FARM_LEVEL_TABLE: FarmLevelData[] = [
  { level: 1, requiredExp: 0,   label: '기본 농사' },
  { level: 2, requiredExp: 100, label: '경험치 +10%' },
  { level: 3, requiredExp: 200, label: '물뿌리개 범위 2칸' },
  { level: 4, requiredExp: 400, label: '농기구 내구도 감소 50%' },
  { level: 5, requiredExp: 800, label: '스프링클러 해금' },
];

/** 경험치로 레벨 계산 */
export function calcFarmLevel(exp: number): number {
  let level = 1;
  for (const row of FARM_LEVEL_TABLE) {
    if (exp >= row.requiredExp) level = row.level;
  }
  return level;
}