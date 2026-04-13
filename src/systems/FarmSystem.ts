// ================================================================
// FarmSystem — 농사 시스템
// ================================================================
//
// 담당:
//   - 밭 일구기 / 씨앗 심기 / 물 주기 / 수확 / 타일 제거
//   - 작물 성장 및 시들기 (하루 종료 시 처리)
//   - 수확 시 바닥 드롭 → 플레이어가 주울 때 인벤토리 추가 + 경험치
//
// 상태 전이:
//   empty → tilled → planted(심은 당일)
//   → growing(다음 날부터, 물주기 패널티 적용)
//   → ready(성장 완료)
//   → harvest → 재수확 작물: planted / 줄기 없는 작물: tilled
//   → wilted(시들어버림) → tilled(괭이로 제거)
//
// 물주기 패널티:
//   growing 상태에서 wateredToday=false이면
//   하루 종료 시 50% 확률로 wilted
//   (planted 상태는 패널티 없음)
//
// 날씨 우선순위:
//   WeatherSystem.applyRainToFarm() 먼저 → 농부 NPC 협동 보상 나중
//
// 경험치 적용 시점:
//   수확(바닥 드롭) 시가 아닌, 플레이어가 아이템을 주울 때 적용
//   레벨 2 이후 줍는 모든 작물에 +10% 보정
//
// 발행 이벤트:
//   'tileChanged'    (tile: FarmTile)
//   'itemDropped'    (item: DroppedItem)
//   'itemPickedUp'   (item: DroppedItem)
//   'farmExpGained'  (amount: number, newExp: number, newLevel: number)
//   'farmLevelUp'    (newLevel: number)
// ================================================================

import Phaser from 'phaser';
import type {
  FarmTile, TileState, HarvestDrop,
  DroppedItem, GameState,
} from '../types';
import type { TimeSystem } from './TimeSystem';
import type { EnergySystem } from './EnergySystem';
import type { InventorySystem } from './InventorySystem';
import { CROP_DATA, calcFarmLevel } from '../data/crops';
import { TOOL_DATA } from '../data/tools';

// ── 상수 ────────────────────────────────────────────────────────

/** 물주기 미이행 시 시들기 확률 */
const WILT_PROBABILITY = 0.5;

/** 경험치 보정 (레벨 2 이상) */
const EXP_BONUS_MULT = 1.1;

/** 드롭 아이템 id 생성용 카운터 */
let dropIdCounter = 0;

// ── FarmSystem ───────────────────────────────────────────────────

export class FarmSystem extends Phaser.Events.EventEmitter {
  private static instance: FarmSystem | null = null;

  private tiles: FarmTile[]           = [];
  private harvestDrops: HarvestDrop[] = [];
  private droppedItems: DroppedItem[] = [];
  private farmExp   = 0;
  private farmLevel = 1;
  private totalDays = 0;

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): FarmSystem {
    if (!FarmSystem.instance) {
      FarmSystem.instance = new FarmSystem();
    }
    return FarmSystem.instance;
  }

  static resetInstance(): void {
    FarmSystem.instance?.destroy();
    FarmSystem.instance = null;
  }

  private constructor() { super(); }

  // ── 초기화 ────────────────────────────────────────────────────

  init(
    timeSystem: TimeSystem,
    state: Pick<GameState, 'farmTiles' | 'farmLevel' | 'harvestDrops' | 'time'>
  ): void {
    this.tiles        = state.farmTiles.map(t => ({ ...t }));
    this.harvestDrops = state.harvestDrops.map(d => ({ ...d }));
    this.farmExp      = state.farmLevel.exp;
    this.farmLevel    = state.farmLevel.level;
    this.totalDays    = state.time.totalDays;

    this.registerEvents(timeSystem);
    console.log(`[FarmSystem] 초기화 완료 — 타일: ${this.tiles.length}개, 레벨: ${this.farmLevel}`);
  }

  private registerEvents(timeSystem: TimeSystem): void {
    timeSystem.on('dayChanged', () => {
      this.totalDays++;
      this.processDayEnd(timeSystem.getSeason());
    });

    timeSystem.on('seasonChanged', () => {
      this.wiltOffSeasonCrops(timeSystem.getSeason());
    });
  }

  // ── 밭 일구기 ─────────────────────────────────────────────────

  /**
   * 빈 땅을 괭이로 일구어 밭 타일로 만들기.
   * 기력·내구도 소모는 호출 전 ToolSystem에서 처리.
   */
  tillTile(tileId: string): boolean {
    const tile = this.getTile(tileId);
    if (!tile) {
      const newTile: FarmTile = {
        id:             tileId,
        state:          'tilled',
        cropId:         null,
        plantedDay:     0,
        wateredToday:   false,
        regrowthCount:  0,
        hasGroundShape: false,
      };
      this.tiles.push(newTile);
      this.emit('tileChanged', { ...newTile });
      return true;
    }

    // wilted 상태 → tilled로 초기화
    if (tile.state === 'wilted') {
      this.updateTile(tileId, { state: 'tilled', cropId: null, plantedDay: 0, regrowthCount: 0 });
      return true;
    }

    return false;
  }

  /**
   * 밭 타일 제거 시도.
   * 작물 있음 → 항상 실패 / 없음 → 50% 확률 소멸
   */
  removeTile(tileId: string): 'removed' | 'kept' | 'blocked' {
    const tile = this.getTile(tileId);
    if (!tile) return 'blocked';

    // 작물이 있으면 (시든 상태 포함) 제거 불가
    if (tile.cropId !== null) return 'blocked';

    if (Math.random() < 0.5) {
      this.tiles = this.tiles.filter(t => t.id !== tileId);
      return 'removed';
    }
    return 'kept';
  }

  // ── 씨앗 심기 ─────────────────────────────────────────────────

  /**
   * tilled 상태 타일에 씨앗 심기.
   * 씨앗 차감은 InventorySystem에서 처리 후 이 메서드 호출.
   */
  plantSeed(tileId: string, cropId: string): boolean {
    const tile = this.getTile(tileId);
    if (!tile || tile.state !== 'tilled') return false;
    if (!CROP_DATA[cropId]) return false;

    this.updateTile(tileId, {
      state:         'planted',
      cropId,
      plantedDay:    this.totalDays,
      wateredToday:  false,
      regrowthCount: 0,
    });
    return true;
  }

  // ── 물 주기 ───────────────────────────────────────────────────

  /**
   * 단일 타일 물 주기.
   * planted / growing 상태에만 적용.
   */
  waterTile(tileId: string): boolean {
    const tile = this.getTile(tileId);
    if (!tile) return false;
    if (tile.state !== 'planted' && tile.state !== 'growing') return false;
    if (tile.wateredToday) return true; // 이미 줬으면 성공으로 처리

    this.updateTile(tileId, { wateredToday: true });
    return true;
  }

  /**
   * 범위 물 주기 (물뿌리개 레벨 3 이상).
   * 타일 id 배열을 받아 일괄 처리.
   */
  waterTiles(tileIds: string[]): void {
    tileIds.forEach(id => this.waterTile(id));
  }

  /**
   * 전체 밭 자동 물주기 (비 / 농부 NPC 협동 보상).
   * WeatherSystem이 먼저 호출, NPC 보상이 나중에 호출.
   */
  waterAllTiles(): void {
    this.tiles.forEach(tile => {
      if (tile.state === 'planted' || tile.state === 'growing') {
        this.updateTile(tile.id, { wateredToday: true });
      }
    });
    console.log('[FarmSystem] 전체 물주기 적용');
  }

  // ── 수확 ──────────────────────────────────────────────────────

  /**
   * ready 상태 타일 수확.
   * 작물을 바닥에 드롭하고 타일 상태를 업데이트.
   * 경험치는 플레이어가 아이템을 주울 때 적용.
   */
  harvest(tileId: string): HarvestDrop | null {
    const tile = this.getTile(tileId);
    if (!tile || tile.state !== 'ready') return null;

    const cropData = CROP_DATA[tile.cropId!];
    if (!cropData) return null;

    const drop: HarvestDrop = {
      id:        `harvest_${Date.now()}_${dropIdCounter++}`,
      itemId:    tile.cropId!,
      itemType:  'crop',
      condition: 'normal',
      quantity:  1,
      tileId,
      droppedDay: this.totalDays,
    };
    this.harvestDrops.push(drop);
    this.emit('itemDropped', { ...drop });

    // 타일 상태 업데이트
    if (cropData.regrows) {
      // 재수확 가능 작물: planted 상태로 전환 (다음 날부터 growing)
      this.updateTile(tileId, {
        state:         'planted',
        plantedDay:    this.totalDays,
        wateredToday:  false,
        regrowthCount: tile.regrowthCount + 1,
      });
    } else {
      // 재수확 불가 작물: 빈 밭으로 초기화
      this.updateTile(tileId, {
        state:         'tilled',
        cropId:        null,
        plantedDay:    0,
        wateredToday:  false,
        regrowthCount: 0,
      });
    }

    return drop;
  }

  // ── 아이템 줍기 ───────────────────────────────────────────────

  /**
   * 바닥에 떨어진 아이템 줍기.
   * InventorySystem에서 추가 성공 시 경험치 부여.
   *
   * @param dropId     DroppedItem.id
   * @param inventory  InventorySystem 인스턴스 (순환 참조 방지용 주입)
   * @returns 줍기 성공 여부
   */
  pickUpItem(dropId: string, inventory: InventorySystem): boolean {
    const item = this.harvestDrops.find(d => d.id === dropId);
    if (!item) return false;

    const added = inventory.addItem({
      itemId:    item.itemId,
      itemType:  item.itemType,
      condition: item.condition,
      quantity:  item.quantity,
    });
    if (!added) return false;

    this.harvestDrops = this.harvestDrops.filter(d => d.id !== dropId);
    this.emit('itemPickedUp', { ...item });

    const cropData = CROP_DATA[item.itemId];
    if (cropData) {
      const exp = this.farmLevel >= 2
        ? Math.floor(cropData.baseExp * EXP_BONUS_MULT)
        : cropData.baseExp;
      this.gainExp(exp);
    }
    return true;
  }

  // ── 하루 종료 처리 ────────────────────────────────────────────

  /**
   * TimeSystem 'dayChanged' 이벤트 수신 시 호출.
   * 1. planted → growing 전환 (심은 다음 날부터)
   * 2. growing → ready 전환 (성장 완료)
   * 3. 물주기 미이행 → 50% 확률 wilted
   * 4. 모든 타일 wateredToday 초기화
   */
  private processDayEnd(currentSeason: string): void {
    this.tiles = this.tiles.map(tile => {
      // 성장 중이 아닌 타일은 wateredToday만 초기화
      if (tile.state === 'empty' || tile.state === 'tilled' || tile.state === 'wilted') {
        return { ...tile, wateredToday: false };
      }

      const cropData = CROP_DATA[tile.cropId!];
      if (!cropData) return tile;

      // 계절 불일치 → 즉시 시들기 (seasonChanged에서도 처리되지만 이중 안전망)
      if (cropData.season !== currentSeason) {
        return { ...tile, state: 'wilted', wateredToday: false };
      }

      // planted(심은 당일) → growing(다음 날부터)
      if (tile.state === 'planted') {
        return { ...tile, state: 'growing', wateredToday: false };
      }

      // growing 상태 처리
      if (tile.state === 'growing') {
        // 물주기 미이행 → 50% 확률 시들기
        if (!tile.wateredToday && Math.random() < WILT_PROBABILITY) {
          const wilted = { ...tile, state: 'wilted' as TileState, wateredToday: false };
          this.emit('tileChanged', wilted);
          return wilted;
        }

        // 성장일 체크: 심은 날 제외하고 growthDays 경과 시 ready
        const daysSincePlanted = this.totalDays - tile.plantedDay;
        if (daysSincePlanted >= cropData.growthDays) {
          const ready = { ...tile, state: 'ready' as TileState, wateredToday: false };
          this.emit('tileChanged', ready);
          return ready;
        }
      }

      // ready 상태: wateredToday만 초기화 (수확 전까지 유지)
      return { ...tile, wateredToday: false };
    });

    console.log(`[FarmSystem] 하루 종료 처리 완료 — ${this.tiles.length}개 타일`);
  }

  /**
   * 계절 전환 시 이전 계절 작물 즉시 시들기.
   * TimeSystem 'seasonChanged' 이벤트 수신 시 호출.
   */
  private wiltOffSeasonCrops(currentSeason: string): void {
    let wilted = 0;
    this.tiles = this.tiles.map(tile => {
      if (!tile.cropId) return tile;
      const cropData = CROP_DATA[tile.cropId];
      if (cropData && cropData.season !== currentSeason &&
          tile.state !== 'wilted' && tile.state !== 'tilled') {
        wilted++;
        const updated = { ...tile, state: 'wilted' as TileState };
        this.emit('tileChanged', updated);
        return updated;
      }
      return tile;
    });
    if (wilted > 0) {
      console.log(`[FarmSystem] 계절 전환 — ${wilted}개 작물 시들어짐`);
    }
  }

  // ── 경험치 & 레벨 ─────────────────────────────────────────────

  private gainExp(amount: number): void {
    this.farmExp += amount;
    const newLevel = calcFarmLevel(this.farmExp);

    if (newLevel > this.farmLevel) {
      this.farmLevel = newLevel;
      this.emit('farmLevelUp', newLevel);
      console.log(`[FarmSystem] 농사 레벨업 → ${newLevel}`);
    }

    this.emit('farmExpGained', amount, this.farmExp, this.farmLevel);
  }

  // ── 유틸리티 ──────────────────────────────────────────────────

  private getTile(id: string): FarmTile | undefined {
    return this.tiles.find(t => t.id === id);
  }

  private updateTile(id: string, partial: Partial<FarmTile>): void {
    this.tiles = this.tiles.map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, ...partial };
      this.emit('tileChanged', { ...updated });
      return updated;
    });
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getTiles(): Readonly<FarmTile[]>             { return this.tiles; }
  getHarvestDrops(): Readonly<HarvestDrop[]>   { return this.harvestDrops; }
  getFarmLevel(): number                       { return this.farmLevel; }
  getFarmExp(): number                         { return this.farmExp; }

  getSnapshot(): Pick<GameState, 'farmTiles' | 'farmLevel' | 'harvestDrops'> {
    return {
      farmTiles:    this.tiles.map(t => ({ ...t })),
      farmLevel:    { level: this.farmLevel, exp: this.farmExp },
      harvestDrops: this.harvestDrops.map(d => ({ ...d })),
    };
  }
}