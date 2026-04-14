// ================================================================
// GameManagerScene — 영구 실행 씬 (Additive Scene Loading 핵심)
// ================================================================
//
// 역할:
//   1. 모든 시스템 초기화 및 보유
//   2. 씬 전환 총괄 (switchMap)
//   3. TimeSystem.update(delta) 매 프레임 호출
//   4. 취침 시 SaveSystem 저장
//   5. HUDScene launch 및 유지
//
// 생명주기:
//   BootScene → launch('GameManagerScene') → 영구 실행
//   맵 씬들은 sleep/wake로 교체됨
//
// 맵 씬에서 시스템 접근:
//   const gm = this.scene.get('GameManagerScene') as GameManagerScene;
//   gm.farmSystem.tillTile(id);
// ================================================================

import Phaser from 'phaser';
import { SaveSystem } from '../systems/SaveSystem';
import { TimeSystem } from '../systems/TimeSystem';
import { WeatherSystem } from '../systems/WeatherSystem';
import { EnergySystem } from '../systems/EnergySystem';
import { FarmSystem } from '../systems/FarmSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { NPCSystem } from '../systems/NPCSystem';
import { RecordSystem } from '../systems/RecordSystem';
import { ToolSystem } from '../systems/ToolSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { FishingSystem } from '../systems/FishingSystem';
import type { GameState } from '../types';

// ── 씬 키 상수 ───────────────────────────────────────────────────

export const SCENE_KEYS = {
  BOOT:          'BootScene',
  GAME_MANAGER:  'GameManagerScene',
  HUD:           'HUDScene',
  VILLAGE:       'VillageScene',
  NORTH_YARD:    'NorthYardScene',
  SOUTH_YARD:    'SouthYardScene',
  NORTH_HOUSE:   'NorthHouseScene',
  SOUTH_HOUSE:   'SouthHouseScene',
  MOUNTAIN:      'MountainScene',
  CLIFF_PATH:    'CliffPathScene',
  MOUNTAIN_PATH: 'MountainPathScene',
  TIDAL_FLAT:    'TidalFlatScene',
  BEACH:         'BeachScene',
  LIBRARY:       'LibraryScene',
  MUSEUM:        'MuseumScene',
  SHOP:          'ShopScene',
} as const;

export type SceneKey = typeof SCENE_KEYS[keyof typeof SCENE_KEYS];

// ── 첫 진입 씬 결정 ──────────────────────────────────────────────

const INITIAL_MAP_SCENE: SceneKey = SCENE_KEYS.VILLAGE;

// ── GameManagerScene ──────────────────────────────────────────────

export class GameManagerScene extends Phaser.Scene {

  // ── 시스템 (public — 맵 씬에서 직접 참조) ──────────────────────
  saveSystem!:      SaveSystem;
  timeSystem!:      TimeSystem;
  weatherSystem!:   WeatherSystem;
  energySystem!:    EnergySystem;
  farmSystem!:      FarmSystem;
  inventorySystem!: InventorySystem;
  npcSystem!:       NPCSystem;
  recordSystem!:    RecordSystem;
  toolSystem!:      ToolSystem;
  economySystem!:   EconomySystem;
  fishingSystem!:   FishingSystem;

  // 씬별 물 타일 판정 콜백
  private _waterChecker?: (px: number, py: number) => boolean;

  setWaterChecker(fn: (px: number, py: number) => boolean): void {
    this._waterChecker = fn;
    // HUDScene의 FishingUI에 전달
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.setFishingWaterChecker?.(fn);
  }

  isWater(px: number, py: number): boolean {
    return this._waterChecker?.(px, py) ?? false;
  }

  // ── 씬 상태 ─────────────────────────────────────────────────────
  private _currentMapKey: SceneKey | null = null;
  get currentMapKey(): SceneKey | null { return this._currentMapKey; }
  private isTransitioning = false;
  gameState!: GameState;

  constructor() {
    super({ key: SCENE_KEYS.GAME_MANAGER });
  }

  // ── 초기화 ────────────────────────────────────────────────────

  async create(data: { gameState: GameState; saveSystem: SaveSystem; savedAt: string | null }): Promise<void> {
    this.gameState   = data.gameState;
    this.saveSystem  = data.saveSystem;

    // 시스템 초기화 (순서 중요)
    await this.initSystems(this.gameState);

    // HUD 씬 Additive 실행 (항상 위에 떠있음)
    this.scene.launch(SCENE_KEYS.HUD);

    // 첫 맵 씬 실행
    this.scene.launch(INITIAL_MAP_SCENE);
    this._currentMapKey = INITIAL_MAP_SCENE;

    // 취침 이벤트 → 자동 저장
    this.timeSystem.on('slept', () => this.handleSleep());

    // 날짜 변경 → washCount 초기화
    this.timeSystem.on('dayChanged', () => {
      this.gameState.washCount = 0;
    });

    console.log('[GameManagerScene] 초기화 완료');
  }

  // ── 시스템 초기화 ─────────────────────────────────────────────

  private async initSystems(state: GameState): Promise<void> {
    const ts  = TimeSystem.getInstance();
    ts.init(state.time);
    this.timeSystem = ts;

    const ws = WeatherSystem.getInstance();
    ws.init(ts, state.time.weather);
    this.weatherSystem = ws;

    const es = EnergySystem.getInstance();
    es.init(ts, state.energy);
    this.energySystem = es;

    const fs = FarmSystem.getInstance();
    fs.init(ts, state);
    this.farmSystem = fs;

    const inv = InventorySystem.getInstance();
    inv.init(state, es);
    this.inventorySystem = inv;

    const npc = NPCSystem.getInstance();
    await npc.init(state, ts, es, fs, inv);
    this.npcSystem = npc;

    const eco = EconomySystem.getInstance();
    eco.init(state, ts, inv, npc);
    this.economySystem = eco;

    const tool = ToolSystem.getInstance();
    tool.init(state, ts, eco);
    this.toolSystem = tool;

    const rec = RecordSystem.getInstance();
    rec.init(state, inv);
    this.recordSystem = rec;

    // FishingSystem (씬 독립적 전역 시스템)
    this.fishingSystem = new FishingSystem();
    // HUDScene 초기화 이후 연결 (delayedCall로 처리)

    console.log('[GameManagerScene] 모든 시스템 초기화 완료');
  }

  // ── 매 프레임 업데이트 ───────────────────────────────────────

  update(_time: number, delta: number): void {
    this.timeSystem.update(delta);
  }

  // ── 씬 전환 ───────────────────────────────────────────────────

  /**
   * 맵 씬 전환. 페이드아웃 → sleep → wake/launch → 페이드인.
   * 모든 맵 씬 전환은 이 메서드를 통해서만.
   */
  switchMap(nextKey: SceneKey, data?: object): void {
    if (this.isTransitioning) return;
    if (nextKey === this._currentMapKey) return;

    this.isTransitioning = true;

    // 씬 전환 시 낚시 강제 리셋
    this.fishingSystem?.forceReset();
    // waterChecker 초기화 (다음 씬에서 새로 등록)
    this._waterChecker = undefined;

    // HUD에 페이드 아웃 요청
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    const fadeOut = hud?.fadeOut?.bind(hud) ?? ((cb: () => void) => cb());

    fadeOut(() => {
      const prev = this._currentMapKey;

      // 이전 씬 sleep
      if (prev && this.scene.isActive(prev)) {
        this.scene.sleep(prev);
      }

      // 다음 씬 wake or launch
      if (this.scene.isSleeping(nextKey)) {
        this.scene.wake(nextKey, data);
      } else if (!this.scene.isActive(nextKey)) {
        this.scene.launch(nextKey, data);
      }

      this._currentMapKey    = nextKey;
      this.isTransitioning  = false;

      // 페이드 인
      hud?.fadeIn?.();
    });
  }

  // ── 취침 처리 ────────────────────────────────────────────────

  private async handleSleep(): Promise<void> {
    // GameState 스냅샷 수집 후 저장
    const snapshot = this.buildSnapshot();
    const result   = await this.saveSystem.save(snapshot);

    if (!result.success) {
      console.error('[GameManagerScene] 저장 실패:', result.reason);
      // HUD에 저장 실패 알림 전달
      this.events.emit('saveFailed', result.reason);
    } else {
      console.log('[GameManagerScene] 취침 저장 완료');
      this.events.emit('saveDone');
    }
  }

  // ── GameState 스냅샷 ──────────────────────────────────────────

  /**
   * 모든 시스템에서 현재 상태를 모아 GameState 재구성.
   * SaveSystem.save()에 전달.
   */
  buildSnapshot(): GameState {
    const farmSnap  = this.farmSystem.getSnapshot();
    const invSnap   = this.inventorySystem.getSnapshot();
    const npcSnap   = this.npcSystem.getSnapshot();
    const recSnap   = this.recordSystem.getSnapshot();
    const toolSnap  = this.toolSystem.getSnapshot();
    const ecoSnap   = this.economySystem.getSnapshot();

    return {
      ...this.gameState,       // houseLocation 등 변하지 않는 기본값
      time:             this.timeSystem.getTime() as GameState['time'],
      energy:           this.energySystem.getCurrent(),
      maxEnergy:        this.energySystem.getMax(),
      gold:             ecoSnap.gold,
      farmTiles:        farmSnap.farmTiles,
      farmLevel:        farmSnap.farmLevel,
      harvestDrops:     farmSnap.harvestDrops,
      tools:            toolSnap.tools,
      inventory:        invSnap.inventory,
      droppedItems:     invSnap.droppedItems,
      holes:            invSnap.holes,
      npcs:             npcSnap.npcs,
      records:          recSnap.records,
      library:          recSnap.library,
      museum:           ecoSnap.museum,
      groundShapes:     recSnap.groundShapes,
      recordContainers: recSnap.recordContainers,
      recordBook:       recSnap.recordBook,
      herbObjects:      this.gameState.herbObjects,
      receivedStarterTools: this.gameState.receivedStarterTools,
      furniture:        this.gameState.furniture,
      washCount:        this.gameState.washCount,
      isSleeping:       false,
    };
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getCurrentMapKey(): SceneKey | null { return this._currentMapKey; }
  isInTransition(): boolean           { return this.isTransitioning; }
}