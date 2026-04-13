// ================================================================
// data/npcs.ts — NPC 정적 데이터
// ================================================================

export type NpcId = 'farmer' | 'merchant' | 'mayor' | 'blacksmith' | 'doctor';
export type GiftReaction = 'love' | 'neutral' | 'dislike';
export type CoopType =
  | 'autoWater'        // 농부: 당일 자동 물주기
  | 'farmExpBonus'     // 농부: 작물 경험치 +10%
  | 'sellBonus'        // 상인: 판매가 +20%
  | 'energyRestore'    // 이장: 기력 +50
  | 'repairDiscount'   // 대장장이: 수리 시간 -20%
  | 'energyCostReduce' // 한의사: 기력 소모 -10%

// 이장 위치 식별자 (씬 키와 매핑)
export type MayorLocation =
  | 'mayor_home'    // 이장님 댁
  | 'mayor_garden'  // 이장님 댁 마당
  | 'village'       // 마을 중앙
  | 'shop'          // 상점
  | 'mountain'      // 북쪽 산
  | 'library'       // 폐교(도서관)
  | 'museum'        // 박물관

// ── 선물 반응 테이블 ─────────────────────────────────────────────

export const GIFT_REACTIONS: Record<NpcId, Record<string, GiftReaction>> = {
  farmer: {
    rice:        'love',
    strawberry:  'love',
    spinach:     'neutral',
    // 어종 전체 → dislike (아래 fallback으로 처리)
  },
  merchant: {
    crucian:     'love',
    sea_bream:   'love',
    mackerel:    'dislike',
    strawberry:  'dislike',
    rice:        'neutral',
    pepper:      'neutral',
    cucumber:    'neutral',
  },
  mayor: {
    cucumber:    'love',
    pepper:      'love',
    crucian:     'neutral',
    rice:        'dislike',
  },
  blacksmith: {
    spinach:     'love',
    strawberry:  'dislike',
  },
  doctor: {
    rice:        'love',
    // 나머지 모두 neutral (fallback)
  },
};

/** 아이템 타입별 기본 반응 (개별 등록 없는 경우) */
export const GIFT_TYPE_FALLBACK: Record<NpcId, GiftReaction> = {
  farmer:     'dislike', // 어종 미등록 → dislike
  merchant:   'neutral',
  mayor:      'neutral',
  blacksmith: 'neutral',
  doctor:     'neutral',
};

/** 반응별 호감도 변화량 */
export const GIFT_AFFECTION_DELTA: Record<GiftReaction, number> = {
  love:    5,
  neutral: 2,
  dislike: -2,
};

// ── NPC 메타 데이터 ──────────────────────────────────────────────

export interface NpcMeta {
  id: NpcId;
  label: string;
  coopTypes: CoopType[];
  defaultLocation: MayorLocation | null; // 이장만 이동, 나머지는 고정
}

export const NPC_META: Record<NpcId, NpcMeta> = {
  farmer: {
    id:              'farmer',
    label:           '농부',
    coopTypes:       ['autoWater', 'farmExpBonus'],
    defaultLocation: null,
  },
  merchant: {
    id:              'merchant',
    label:           '상인',
    coopTypes:       ['sellBonus'],
    defaultLocation: null,
  },
  mayor: {
    id:              'mayor',
    label:           '이장',
    coopTypes:       ['energyRestore'],
    defaultLocation: 'mayor_home',
  },
  blacksmith: {
    id:              'blacksmith',
    label:           '대장장이',
    coopTypes:       ['repairDiscount'],
    defaultLocation: null,
  },
  doctor: {
    id:              'doctor',
    label:           '한의사',
    coopTypes:       ['energyCostReduce'],
    defaultLocation: null,
  },
};

// ── 이장 이동 스케줄 ─────────────────────────────────────────────

export interface ScheduleEntry {
  fromHour: number;
  location: MayorLocation;
}

/** 월~금 스케줄 */
export const MAYOR_SCHEDULE_WEEKDAY: ScheduleEntry[] = [
  { fromHour: 0,  location: 'mayor_home' },
  { fromHour: 6,  location: 'mayor_home' },
  { fromHour: 9,  location: 'village'    },
  { fromHour: 12, location: 'shop'       },
  { fromHour: 14, location: 'mountain'   },
  { fromHour: 17, location: 'village'    },
  { fromHour: 20, location: 'mayor_home' },
];

/** 토·일 스케줄 */
export const MAYOR_SCHEDULE_WEEKEND: ScheduleEntry[] = [
  { fromHour: 0,  location: 'mayor_home'   },
  { fromHour: 6,  location: 'mayor_home'   },
  { fromHour: 8,  location: 'mayor_garden' },
  { fromHour: 9,  location: 'library'      },
  { fromHour: 12, location: 'shop'         },
  { fromHour: 14, location: 'museum'       },
  { fromHour: 16, location: 'village'      },
  { fromHour: 20, location: 'mayor_home'   },
];

/**
 * 요일 계산: totalDays 기준 (1일차 = 월요일)
 * 0=월, 1=화, 2=수, 3=목, 4=금, 5=토, 6=일
 */
export function getDayOfWeek(totalDays: number): number {
  return (totalDays - 1) % 7;
}

export function isWeekend(totalDays: number): boolean {
  const dow = getDayOfWeek(totalDays);
  return dow === 5 || dow === 6;
}

/**
 * 현재 시각 기준 이장 위치 반환.
 * 스케줄 배열에서 fromHour <= hour 인 마지막 항목 선택.
 */
export function getMayorLocation(
  hour: number,
  totalDays: number
): MayorLocation {
  const schedule = isWeekend(totalDays)
    ? MAYOR_SCHEDULE_WEEKEND
    : MAYOR_SCHEDULE_WEEKDAY;

  let location: MayorLocation = 'mayor_home';
  for (const entry of schedule) {
    if (hour >= entry.fromHour) location = entry.location;
  }
  return location;
}