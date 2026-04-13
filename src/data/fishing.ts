// ================================================================
// data/fishing.ts — 낚시 데이터
// ================================================================

export type FishLocation = 'river' | 'stream' | 'tidal' | 'sea';

export interface FishData {
  id: string;
  label: string;
  basePrice: number;
  // 추후 난이도 차별화 시 사용
  // difficulty: number;
}

export const FISH_DATA: Record<string, FishData> = {
  // 강 (VillageScene)
  trout:    { id: 'trout',    label: '송어',   basePrice: 120 },
  mullet:   { id: 'mullet',   label: '숭어',   basePrice: 80  },
  // 시냇물 (MountainScene)
  minnow:   { id: 'minnow',   label: '송사리', basePrice: 40  },
  mandarin: { id: 'mandarin', label: '꺽지',   basePrice: 100 },
  // 갯벌 (TidalFlatScene)
  octopus:  { id: 'octopus',  label: '낙지',   basePrice: 200 },
  goby:     { id: 'goby',     label: '망둥어', basePrice: 60  },
  // 바다 (BeachScene)
  sea_bream:{ id: 'sea_bream',label: '돔',     basePrice: 300 },
  mackerel: { id: 'mackerel', label: '전갱이', basePrice: 150 },
};

// 장소별 드롭 테이블
export const FISH_DROP_TABLE: Record<FishLocation, Array<{ fishId: string; weight: number }>> = {
  river: [
    { fishId: 'trout',  weight: 50 },
    { fishId: 'mullet', weight: 50 },
  ],
  stream: [
    { fishId: 'minnow',   weight: 60 },
    { fishId: 'mandarin', weight: 40 },
  ],
  tidal: [
    { fishId: 'octopus', weight: 40 },
    { fishId: 'goby',    weight: 60 },
  ],
  sea: [
    { fishId: 'sea_bream', weight: 40 },
    { fishId: 'mackerel',  weight: 60 },
  ],
};

// 낚시 수치 상수
export const FISHING_CONFIG = {
  ENERGY_COST:       6,       // 던질 때 기력 소모
  CHARGE_MAX_SEC:    5,       // 힘 충전 최대 시간 (초)
  WAIT_MIN_SEC:      3,       // 대기 최소 시간
  WAIT_MAX_SEC:      8,       // 대기 최대 시간
  CATCH_GAUGE_MAX:   70,      // 포획 게이지 초기값
  CATCH_RATE_PER_S:  10,      // 안정 구간 유지 시 포획 게이지 감소량/초
  TENSION_MIN:       0,       // 텐션 최솟값
  TENSION_MAX:       100,     // 텐션 최댓값
  TENSION_SAFE_LOW:  40,      // 안전 구간 하한
  TENSION_SAFE_HIGH: 60,      // 안전 구간 상한
  TENSION_HOLD_RATE: 25,      // 홀드 키 유지 시 텐션 증가/초
  TENSION_DECAY:     15,      // 홀드 키 미유지 시 텐션 감소/초
  // 물고기 AI
  FISH_PULL_RATE:    8,       // PULL 상태 텐션 증가/초
  FISH_DASH_RATE:    30,      // DASH 상태 텐션 증가/초
  FISH_REST_RATE:    12,      // REST 상태 텐션 감소/초
  // 찌
  BOBBER_GRAVITY:    400,     // 찌 포물선 중력
  BOBBER_FLOAT_AMP:  2,       // 부유 진폭 (px)
  BOBBER_FLOAT_FREQ: 2,       // 부유 주파수
} as const;

// 드롭 롤
export function rollFish(location: FishLocation): string {
  const table = FISH_DROP_TABLE[location];
  const total = table.reduce((s, e) => s + e.weight, 0);
  let rand    = Math.random() * total;
  for (const entry of table) {
    rand -= entry.weight;
    if (rand <= 0) return entry.fishId;
  }
  return table[0].fishId;
}