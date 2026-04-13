// ================================================================
// data/records.ts — 기록물 정적 데이터
// ================================================================

export type ContainerType = 'book' | 'bottle';
export type RecordObtainMethod =
  | 'container'   // 용기(책/병속의 배)에서 획득
  | 'npc'         // NPC 호감도 100
  | 'library';    // 도서관 2단계 상호작용

// ── 내용(Content) 데이터 ────────────────────────────────────────
// 용기를 열었을 때 랜덤 배정되는 실제 스토리 기록물

export interface RecordContentData {
  id: string;
  label: string;
  story: string;
  availableIn: ContainerType[];  // 등장 가능한 용기 타입
  obtainMethod: RecordObtainMethod;
}

export const RECORD_CONTENT_DATA: Record<string, RecordContentData> = {
  school_photo: {
    id:            'school_photo',
    label:         '폐교 사진',
    story:         '사라진 학교의 흑백 사진. 많은 아이들이 웃고 있다.',
    availableIn:   ['book', 'bottle'],
    obtainMethod:  'container',
  },
  village_map: {
    id:            'village_map',
    label:         '마을 지도',
    story:         '오래된 마을 지도. 지금과 많이 달랐던 것 같다.',
    availableIn:   ['book'],
    obtainMethod:  'container',
  },
  child_drawing: {
    id:            'child_drawing',
    label:         '어린이 그림',
    story:         '아이가 그린 마을 그림. 폐교 뒷면에 이름이 적혀있다.',
    availableIn:   ['book', 'bottle'],
    obtainMethod:  'container',
  },
  rice_record: {
    id:            'rice_record',
    label:         '벼 재배 기록',
    story:         '전통 농업 방식이 빼곡히 적힌 노트.',
    availableIn:   ['book'],
    obtainMethod:  'container',
  },
  // 고정 획득 기록물
  mayor_record: {
    id:            'mayor_record',
    label:         '이장의 기록',
    story:         '이장이 평생 기록한 마을 역사.',
    availableIn:   [],
    obtainMethod:  'npc',
  },
  merchant_ledger: {
    id:            'merchant_ledger',
    label:         '상인의 장부',
    story:         '수십 년치 거래가 담긴 낡은 장부.',
    availableIn:   [],
    obtainMethod:  'npc',
  },
  last_letter: {
    id:            'last_letter',
    label:         '마지막 편지',
    story:         '도서관 깊은 곳에 숨겨진 편지. 메인 스토리의 열쇠.',
    availableIn:   [],
    obtainMethod:  'library',
  },
};

// ── 용기(Container) 데이터 ───────────────────────────────────────

export interface ContainerData {
  type: ContainerType;
  label: string;
  itemId: string;   // 인벤토리 아이템 id
  availableContents: string[];  // 담길 수 있는 content id 목록
}

export const CONTAINER_DATA: Record<ContainerType, ContainerData> = {
  book: {
    type:              'book',
    label:             '낡은 책',
    itemId:            'container_book',
    availableContents: ['school_photo', 'village_map', 'child_drawing', 'rice_record'],
  },
  bottle: {
    type:              'bottle',
    label:             '병속의 배',
    itemId:            'container_bottle',
    availableContents: ['school_photo', 'child_drawing'],
  },
};

// ── 도서관 보상 데이터 ────────────────────────────────────────────

export interface LibraryReward {
  stage: 1 | 2;
  itemId: string;
  label: string;
  quantity: number;
}

export const LIBRARY_REWARDS: Record<1 | 2, LibraryReward> = {
  1: {
    stage:    1,
    itemId:   'seed_strawberry',
    label:    '딸기 씨앗',
    quantity: 5,
  },
  2: {
    stage:    2,
    itemId:   'last_letter_unlock',  // 도서관 내부 상호작용 해금 플래그
    label:    '마지막 편지 해금',
    quantity: 1,
  },
};

// ── NPC 호감도 100 기록물 매핑 ───────────────────────────────────

export const NPC_RECORD_MAP: Partial<Record<string, string>> = {
  mayor:    'mayor_record',
  merchant: 'merchant_ledger',
};