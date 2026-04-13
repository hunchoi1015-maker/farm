// ================================================================
// 나의 귀농 일지 — 공통 타입 정의
// ================================================================

// ── 기본 열거형 ─────────────────────────────────────────────────

export type Season        = 'spring' | 'summer' | 'autumn';
export type Weather       = 'sunny' | 'rainy';
export type ToolType      = 'hoe' | 'wateringCan' | 'sickle' | 'fishingRod';
export type HouseLocation = 'north' | 'south';
export type ItemType      = 'crop' | 'seed' | 'tool' | 'food' | 'fish';
export type ItemCondition = 'normal' | 'wilted';

export type TileState =
  | 'empty'    // 빈 땅
  | 'tilled'   // 갈아엎은 밭
  | 'planted'  // 씨앗 심음 (심은 당일)
  | 'growing'  // 성장 중
  | 'ready'    // 수확 가능
  | 'wilted';  // 시들어버림

// ── 시간 ────────────────────────────────────────────────────────

export interface GameTime {
  day: number;
  hour: number;
  minute: number;
  season: Season;
  weather: Weather;
  totalDays: number;
}

// ── 농기구 ──────────────────────────────────────────────────────

export interface Tool {
  id: string;
  type: ToolType;
  durability: number;
  maxDurability: number;
  isRepairing: boolean;
  repairCompleteHour?: number;
}

// ── 밭 타일 ─────────────────────────────────────────────────────

export interface FarmTile {
  id: string;  // "sceneKey:tx:ty" 형식 (예: "north_yard:5:12")
  state: TileState;
  cropId: string | null;
  plantedDay: number;
  wateredToday: boolean;
  regrowthCount: number;
  hasGroundShape: boolean;  // 특이한 땅 모양 존재 여부
}

// ── 구덩이 ──────────────────────────────────────────────────────

export interface Hole {
  id: string;
  worldX: number;
  worldY: number;
  buriedItem: BuriedItem | null;
  diggedDay: number;  // 판 날 (totalDays 기준)
}

export interface BuriedItem {
  itemId: string;
  itemType: ItemType;
  condition: ItemCondition;
  quantity: number;
  buriedDay: number;
}

// ── 인벤토리 ─────────────────────────────────────────────────────

export interface InventoryItem {
  itemId: string;
  itemType: ItemType;
  condition: ItemCondition;
  quantity: number;       // 최대 64
}

export interface Inventory {
  slots: (InventoryItem | null)[];  // 20칸
  quickSlots: (Tool | null)[];      // 3칸 (도구 전용)
  equippedSlotIndex: number | null; // 현재 장착 퀵슬롯 인덱스
}

// ── 땅 모양 (특수 아이템 매장지) ────────────────────────────────

export interface GroundShape {
  id: string;
  tileId: string;      // 어느 FarmTile 위에 있는지 ("sceneKey:tx:ty")
  spawnedDay: number;  // 생성된 날 (totalDays 기준)
}

// ── 기록물 용기 ──────────────────────────────────────────────────

export interface RecordContainer {
  id: string;
  containerType: 'book' | 'bottle';
  isOpened: boolean;
  contentRecordId: string | null;  // 열었을 때 배정된 내용 id
  obtainedDay: number;
}

// ── 수확 드롭 (FarmSystem 전용) ──────────────────────────────────

export interface HarvestDrop {
  id: string;
  itemId: string;
  itemType: ItemType;
  condition: ItemCondition;
  quantity: number;
  tileId: string;       // 수확한 밭 타일 id ("sceneKey:tx:ty")
  droppedDay: number;
}

// ── 바닥 드롭 (플레이어가 버린 아이템) ──────────────────────────

export interface DroppedItem {
  id: string;
  itemId: string;
  itemType: ItemType;
  condition: ItemCondition;
  quantity: number;
  worldX: number;       // 버린 위치 (씬 좌표)
  worldY: number;
  droppedDay: number;
}

// ── NPC ──────────────────────────────────────────────────────────

export interface NPC {
  id: string;
  affection: number;
  isCoopUnlocked: boolean;
  isEventDone: boolean;
  giftsGivenThisWeek: number;
  lastTalkedDay: number;
  coopUsedToday: boolean;
}

// ── 기록물 ──────────────────────────────────────────────────────

export interface RecordItem {
  id: string;
  isCollected: boolean;
  isDonated: boolean;
  collectedDay: number;
}

// ── 도서관 / 박물관 ──────────────────────────────────────────────

export interface LibraryState {
  stage: 0 | 1 | 2;
  donatedRecordIds: string[];
}

export interface MuseumState {
  donatedItemIds: string[];
}

// ── 농사 레벨 ────────────────────────────────────────────────────

export interface FarmLevel {
  level: number;
  exp: number;
}

// ── 산 채집 오브젝트 ────────────────────────────────────────────

export interface HerbObject {
  id: string;
  tileX: number;
  tileY: number;
  spawnedDay: number;
}

// ── 기록 도감 ────────────────────────────────────────────────────

export interface RecordBookEntry {
  id: string;
  containerType: 'book' | 'bottle';
  contentId: string;       // RECORD_CONTENT_DATA의 id
  isDonated: boolean;
  obtainedDay: number;
}

// ── 가구 ────────────────────────────────────────────────────────

export interface FurnitureItem {
  id: string;       // 'bed', 'sink' 등
  sceneKey: string; // 어느 집 씬인지
  x: number;        // 픽셀 좌표
  y: number;
}

// ── 전체 게임 상태 ───────────────────────────────────────────────

export interface GameState {
  houseLocation: HouseLocation;
  time: GameTime;
  energy: number;
  maxEnergy: number;
  gold: number;
  farmTiles: FarmTile[];
  farmLevel: FarmLevel;
  tools: Tool[];
  inventory: Inventory;
  npcs: Record<string, NPC>;
  records: Record<string, RecordItem>;
  library: LibraryState;
  museum: MuseumState;
  harvestDrops: HarvestDrop[];
  droppedItems: DroppedItem[];
  holes: Hole[];
  groundShapes: GroundShape[];
  recordContainers: RecordContainer[];
  furniture: FurnitureItem[];   // 가구 위치
  washCount: number;            // 오늘 씻기 횟수 (최대 2)
  receivedStarterTools: boolean;  // 이장 첫 대화 도구 수령 여부
  recordBook: RecordBookEntry[];  // 기록 도감
  herbObjects: HerbObject[];      // 산 채집 오브젝트 (4잎풀)
  isSleeping: boolean;
}

// ── 저장 데이터 래퍼 ────────────────────────────────────────────

export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  savedAt: string;
  state: GameState;
}

// ── 저장 결과 ────────────────────────────────────────────────────

export type SaveResult =
  | { success: true }
  | { success: false; reason: string };

export type LoadResult =
  | { success: true; data: SaveData }
  | { success: false; reason: 'not_found' | 'corrupted' | 'unknown' };