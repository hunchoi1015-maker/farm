// ================================================================
// NorthYardScene — 북쪽 마당 씬
// ================================================================
//
// 특징:
//   - 선택한 집이 북쪽일 때만 농사 가능
//   - 40×40 타일, 전체가 잠재적 밭
//   - 마우스 클릭으로 타일 선택 → 장착 도구에 따라 행동
//   - tileId = "north_yard:tx:ty" (맵 크기 변경에 무관)
//   - 땅 모양: 반짝이는 이펙트로 표시
//   - 물뿌리개 레벨3: 2×3 범위 (플레이어 아래 2행 × 3열)
//
// 씬 전환:
//   남쪽 경계 → VillageScene
//   북쪽 경계 → MountainScene
//   북쪽 집 문 → NorthHouseScene
//
// 농사 불가 마당:
//   괭이질 시도 → 모션 + 차단 메시지
// ================================================================

import Phaser from 'phaser';
import { SceneTransition } from '../ui/SceneTransition';
import { portalKey } from '../data/portals';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import type { FarmTile, HarvestDrop } from '../types';
import { CROP_DATA } from '../data/crops';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE    = 16;
const MAP_W        = 40;
const MAP_H        = 40;
const PLAYER_SPEED = 120;
const SCENE_KEY    = 'north_yard';

// 도구별 행동
type ToolAction = 'hoe' | 'wateringCan' | 'sickle' | 'none';

// 타일 색상 (임시)
const TILE_COLOR = {
  GROUND: 0x5a8a45,
  TILLED: 0x8b6914,
  PLANTED:0x6b7c3a,
  GROWING:0x4a7a2a,
  READY:  0xffd700,
  WILTED: 0x8b5a2b,
  HOVER:  0xffffff,
} as const;

// 물뿌리개 레벨3 범위 (플레이어 기준 상대 좌표, 2×3)
const WATER_RANGE_LV3: Array<[number, number]> = [
  [-1, 1], [0, 1], [1, 1],
  [-1, 2], [0, 2], [1, 2],
];
const WATER_RANGE_LV1: Array<[number, number]> = [[0, 1]];

// ── NorthYardScene ────────────────────────────────────────────────

export class NorthYardScene extends Phaser.Scene {
  private gm!: GameManagerScene;
  private canFarm = false;  // 선택한 집이 북쪽일 때만 true

  // 타일맵
  private tileGraphics!: Phaser.GameObjects.Graphics;
  private hoverGraphics!: Phaser.GameObjects.Graphics;

  // 타일 상태 렌더링 캐시 (tileId → Graphics 오브젝트)
  private tileRects: Map<string, Phaser.GameObjects.Rectangle> = new Map();

  // 땅 모양 이펙트 (tileId → 반짝임 오브젝트)
  private groundShapeEffects: Map<string, Phaser.GameObjects.Rectangle> = new Map();

  // 수확 드롭 렌더링 (dropId → 오브젝트)
  private dropSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // 플레이어
  private player!:   Phaser.GameObjects.Rectangle;
  private cursors!:  Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:     Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private transition!: SceneTransition;
  private _fromData?: { from?: string; coord?: number; axis?: string };
  private _fromScene?: string;

  // 마우스 호버 타일
  private hoveredTileId: string | null = null;

  // UI
  private actionHint!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: SCENE_KEYS.NORTH_YARD });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(): void {
    this.gm       = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this.canFarm  = this.gm.gameState.houseLocation === 'north';

    this.buildBackground();
    this.createPlayer(this._fromData);
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    this.createActionHint();
    this.renderAllTiles();
    this.renderAllGroundShapes();
    this.renderAllDrops();
    this.subscribeEvents();

    // 날씨 자동 물주기 적용
    if (this.gm.weatherSystem.isRaining()) {
      this.applyRainWatering();
    }

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();

    console.log(`[NorthYardScene] 생성 완료 — 농사 가능: ${this.canFarm}`);
  }

  // ── 배경 ──────────────────────────────────────────────────────

  private buildBackground(): void {
    const worldW = MAP_W * TILE_SIZE;
    const worldH = MAP_H * TILE_SIZE;

    // 기본 땅 배경
    this.tileGraphics = this.add.graphics().setDepth(0);
    this.tileGraphics.fillStyle(TILE_COLOR.GROUND);
    this.tileGraphics.fillRect(0, 0, worldW, worldH);

    // 격자선
    this.tileGraphics.lineStyle(0.5, 0x000000, 0.15);
    for (let x = 0; x <= MAP_W; x++) {
      this.tileGraphics.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, worldH);
    }
    for (let y = 0; y <= MAP_H; y++) {
      this.tileGraphics.lineBetween(0, y * TILE_SIZE, worldW, y * TILE_SIZE);
    }

    // 호버 그래픽 (마우스 위치 표시)
    this.hoverGraphics = this.add.graphics().setDepth(3);

    // 집 위치 표시 (임시)
    this.add.rectangle(20 * TILE_SIZE, 4 * TILE_SIZE, 6 * TILE_SIZE, 4 * TILE_SIZE, 0xb8a090)
      .setOrigin(0, 0).setDepth(1);
    this.add.text(20 * TILE_SIZE + 4, 4 * TILE_SIZE + 4, '북쪽 집', {
      fontSize: '10px', color: '#3d2b1f',
    }).setDepth(2);

    // 농사 불가 마당 표시
    if (!this.canFarm) {
      this.add.rectangle(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE, 0x000000, 0.3)
        .setOrigin(0, 0).setDepth(2);
      this.add.text(MAP_W * TILE_SIZE / 2, MAP_H * TILE_SIZE / 2, '이 마당을 이용하려면\n집을 구매해야 해요', {
        fontSize: '14px', color: '#ffffff', align: 'center',
        backgroundColor: '#00000088', padding: { x: 8, y: 6 },
      }).setOrigin(0.5).setDepth(3);
    }
  }

  // ── 플레이어 ──────────────────────────────────────────────────

  private getSpawnPos(data?: { from?: string; coord?: number; axis?: string }): { x: number; y: number } {
    if (data?.from && data.coord !== undefined && data.coord >= 0) {
      return SceneTransition.calcSpawn(data, data.from, { x: MAP_W / 2 * TILE_SIZE, y: (MAP_H - 4) * TILE_SIZE });
    }
    const cx = MAP_W / 2 * TILE_SIZE;
    switch (data?.from) {
      case 'mountain':    return { x: cx, y: 4 * TILE_SIZE };             // 산에서 → 상단
      case 'north_house': return { x: 20 * TILE_SIZE, y: 8 * TILE_SIZE }; // 집에서 → 집 문 앞
      default:            return { x: cx, y: (MAP_H - 4) * TILE_SIZE };   // 마을에서 → 하단
    }
  }

  private createPlayer(data?: { from?: string; coord?: number; axis?: string }): void {
    const { x: spawnX, y: spawnY } = this.getSpawnPos(data);

    this.player = this.add.rectangle(spawnX, spawnY, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
  }

  private setupCamera(): void {
    const worldW = MAP_W * TILE_SIZE;
    const worldH = MAP_H * TILE_SIZE;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main
      .setBounds(0, 0, worldW, worldH)
      .startFollow(this.player, true, 0.1, 0.1);
  }

  // ── 입력 ──────────────────────────────────────────────────────

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // 마우스 이동 → 호버 타일 계산
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const tx = Math.floor(pointer.worldX / TILE_SIZE);
      const ty = Math.floor(pointer.worldY / TILE_SIZE);

      if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
        this.hoveredTileId = this.toTileId(tx, ty);
        this.renderHover(tx, ty);
      } else {
        this.hoveredTileId = null;
        this.hoverGraphics.clear();
      }
    });

    // 우클릭 → 타일 액션 (채집/수확 통일)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 2) return; // 우클릭만
      if (this.playerBlocked) return;
      if (!this.hoveredTileId) return;

      this.handleTileAction(this.hoveredTileId);
    });

    // 우클릭 컨텍스트 메뉴 방지
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── 씬 전환 존 ────────────────────────────────────────────────

  private createExitZones(): void {
    const worldW = MAP_W * TILE_SIZE;
    const worldH = MAP_H * TILE_SIZE;
    const T      = TILE_SIZE;

    const exits = [
      { name: 'exit_south',  x: 0,          y: worldH - T * 2, w: worldW, h: T * 2, target: SCENE_KEYS.VILLAGE     },
      { name: 'exit_north',  x: 0,          y: 0,              w: worldW, h: T * 2, target: SCENE_KEYS.MOUNTAIN    },
      { name: 'exit_house',  x: T * 18,     y: T * 2,          w: T * 4,  h: T * 3, target: SCENE_KEYS.NORTH_HOUSE },
    ];

    exits.forEach(exit => {
      const zone = this.add.zone(
        exit.x + exit.w / 2, exit.y + exit.h / 2, exit.w, exit.h
      );
      this.physics.add.existing(zone, true);
      this.physics.add.overlap(this.player, zone, () => {
        if (this.playerBlocked) return;
        const fromMap: Record<string, string> = {
          [SCENE_KEYS.VILLAGE]:     'north_yard',
          [SCENE_KEYS.MOUNTAIN]:    'north_yard',
          [SCENE_KEYS.NORTH_HOUSE]: 'north_yard',
        };
        this.gm.switchMap(exit.target as any, { from: fromMap[exit.target] ?? 'north_yard' });
      });
    });
  }

  // ── 타일 ID 유틸 ──────────────────────────────────────────────

  /** 좌표 → tileId (맵 크기 무관) */
  private toTileId(tx: number, ty: number): string {
    return `${SCENE_KEY}:${tx}:${ty}`;
  }

  /** tileId → 좌표 */
  private fromTileId(id: string): { tx: number; ty: number } | null {
    const parts = id.split(':');
    if (parts[0] !== SCENE_KEY) return null;
    return { tx: parseInt(parts[1]), ty: parseInt(parts[2]) };
  }

  /** tileId → 픽셀 중심 좌표 */
  private tileIdToWorld(id: string): Phaser.Math.Vector2 | null {
    const pos = this.fromTileId(id);
    if (!pos) return null;
    return new Phaser.Math.Vector2(
      pos.tx * TILE_SIZE + TILE_SIZE / 2,
      pos.ty * TILE_SIZE + TILE_SIZE / 2
    );
  }

  /** 플레이어 현재 타일 좌표 */
  private getPlayerTile(): { tx: number; ty: number } {
    return {
      tx: Math.floor(this.player.x / TILE_SIZE),
      ty: Math.floor(this.player.y / TILE_SIZE),
    };
  }

  // ── 타일 액션 ─────────────────────────────────────────────────

  private handleTileAction(tileId: string): void {
    const action = this.getCurrentAction();

    // 농사 불가 마당
    if (!this.canFarm) {
      this.showCannotFarmAnim(tileId);
      return;
    }

    switch (action) {
      case 'hoe':          this.doHoe(tileId);         break;
      case 'wateringCan':  this.doWater(tileId);        break;
      case 'sickle':       this.doSickle(tileId);       break;
      case 'none':         this.doPickup(tileId);       break;
    }
  }

  private getCurrentAction(): ToolAction {
    const equipped = this.gm.inventorySystem.getEquippedSlot();
    if (equipped === null) return 'none';
    const tool = this.gm.inventorySystem.getQuickSlots()[equipped];
    if (!tool) return 'none';
    if (tool.type === 'hoe')         return 'hoe';
    if (tool.type === 'wateringCan') return 'wateringCan';
    if (tool.type === 'sickle')      return 'sickle';
    return 'none';
  }

  // ── 괭이 ──────────────────────────────────────────────────────

  private doHoe(tileId: string): void {
    const equipped = this.getEquippedToolId();
    if (!equipped) return;

    // 도구 사용 (내구도 + 기력 소모)
    const multiplier = this.gm.farmSystem.getFarmLevel() >= 4 ? 0.5 : 1.0;
    if (!this.gm.toolSystem.useTool(equipped, multiplier)) return;
    if (!this.gm.energySystem.consume(4)) return;

    // 밭 일구기
    const result = this.gm.farmSystem.tillTile(tileId);
    if (!result) return;

    // 땅 모양 생성 시도 (RecordSystem)
    this.gm.recordSystem.trySpawnGroundShape(tileId);

    this.renderTile(tileId);
    this.playHoeAnim(tileId);
  }

  // ── 물뿌리개 ──────────────────────────────────────────────────

  private doWater(tileId: string): void {
    const equipped = this.getEquippedToolId();
    if (!equipped) return;

    const multiplier = this.gm.farmSystem.getFarmLevel() >= 4 ? 0.5 : 1.0;
    if (!this.gm.toolSystem.useTool(equipped, multiplier)) return;
    if (!this.gm.energySystem.consume(1)) return;

    const farmLevel = this.gm.farmSystem.getFarmLevel();
    const pos       = this.fromTileId(tileId);
    if (!pos) return;

    // 레벨별 범위 계산
    const range = farmLevel >= 3 ? WATER_RANGE_LV3 : WATER_RANGE_LV1;
    const tileIds = range
      .map(([dx, dy]) => {
        const tx = pos.tx + dx;
        const ty = pos.ty + dy;
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return null;
        return this.toTileId(tx, ty);
      })
      .filter((id): id is string => id !== null);

    // 물 주기
    tileIds.forEach(id => {
      this.gm.farmSystem.waterTile(id);
      this.renderTile(id);
    });

    this.playWaterAnim(pos.tx, pos.ty, range);
  }

  // ── 낫 ────────────────────────────────────────────────────────

  private doSickle(tileId: string): void {
    const tile = this.gm.farmSystem.getTiles().find(t => t.id === tileId);
    if (!tile || tile.state !== 'ready') {
      const hud = this.scene.get(SCENE_KEYS.HUD) as any;
      hud?.showToast?.('수확할 작물이 없어요.', 'info');
      return;
    }

    const equipped = this.getEquippedToolId();
    if (!equipped) return;

    const multiplier = this.gm.farmSystem.getFarmLevel() >= 4 ? 0.5 : 1.0;
    if (!this.gm.toolSystem.useTool(equipped, multiplier)) return;
    if (!this.gm.energySystem.consume(2)) return;

    const drop = this.gm.farmSystem.harvest(tileId);
    if (drop) {
      this.renderDrop(drop);
      this.renderTile(tileId);
    }
  }

  // ── 아이템 줍기 ───────────────────────────────────────────────

  private doPickup(tileId: string): void {
    const drops   = this.gm.farmSystem.getHarvestDrops();
    const nearby  = drops.find(d => d.tileId === tileId);
    if (!nearby) return;

    const success = this.gm.farmSystem.pickUpItem(
      nearby.id,
      this.gm.inventorySystem
    );

    if (success) {
      this.dropSprites.get(nearby.id)?.destroy();
      this.dropSprites.delete(nearby.id);
    }
  }

  // ── 농사 불가 모션 ────────────────────────────────────────────

  private showCannotFarmAnim(tileId: string): void {
    const world = this.tileIdToWorld(tileId);
    if (!world) return;

    // 플레이어 좌우 흔들기
    this.tweens.add({
      targets:  this.player,
      x:        this.player.x + 4,
      duration: 60,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   2,
    });

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.showToast?.('이 타일에서는 농사가 불가능해요.', 'warn');
  }

  // ── 렌더링 ────────────────────────────────────────────────────

  /** 모든 FarmTile 렌더링 */
  private renderAllTiles(): void {
    this.gm.farmSystem.getTiles().forEach(tile => {
      if (tile.id.startsWith(SCENE_KEY)) {
        this.renderTile(tile.id);
      }
    });
  }

  /** 단일 타일 렌더링 */
  private renderTile(tileId: string): void {
    const pos = this.fromTileId(tileId);
    if (!pos) return;

    const tile  = this.gm.farmSystem.getTiles().find(t => t.id === tileId);
    const color = this.getTileColor(tile);
    const x     = pos.tx * TILE_SIZE;
    const y     = pos.ty * TILE_SIZE;

    // 기존 rect 재사용 or 생성
    let rect = this.tileRects.get(tileId);
    if (!rect) {
      rect = this.add.rectangle(
        x + TILE_SIZE / 2, y + TILE_SIZE / 2,
        TILE_SIZE - 1, TILE_SIZE - 1, color
      ).setDepth(1);
      this.tileRects.set(tileId, rect);
    } else {
      rect.setFillStyle(color);
    }

    // 작물 레이블 (ready 상태)
    if (tile?.state === 'ready' && tile.cropId) {
      const cropData = CROP_DATA[tile.cropId];
      const key = `label_${tileId}`;
      let label = this.tileRects.get(key) as any;
      if (!label) {
        label = this.add.text(x + TILE_SIZE / 2, y + TILE_SIZE / 2, '', {
          fontSize: '8px', color: '#ffffff',
        }).setOrigin(0.5).setDepth(2);
        this.tileRects.set(key, label);
      }
      label.setText(cropData?.label?.slice(0, 2) ?? '');
    }
  }

  private getTileColor(tile: FarmTile | undefined): number {
    if (!tile) return TILE_COLOR.GROUND;
    switch (tile.state) {
      case 'tilled':  return TILE_COLOR.TILLED;
      case 'planted': return TILE_COLOR.PLANTED;
      case 'growing': return TILE_COLOR.GROWING;
      case 'ready':   return TILE_COLOR.READY;
      case 'wilted':  return TILE_COLOR.WILTED;
      default:        return TILE_COLOR.GROUND;
    }
  }

  /** 호버 타일 표시 */
  private renderHover(tx: number, ty: number): void {
    this.hoverGraphics.clear();
    this.hoverGraphics.lineStyle(1.5, TILE_COLOR.HOVER, 0.6);
    this.hoverGraphics.strokeRect(
      tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE
    );

    // 액션 힌트 업데이트
    const action = this.getCurrentAction();
    const hints: Record<ToolAction, string> = {
      hoe:        '클릭: 밭 일구기',
      wateringCan:'클릭: 물 주기',
      sickle:     '클릭: 수확',
      none:       '클릭: 줍기',
    };
    this.actionHint.setText(hints[action]);
  }

  // ── 땅 모양 이펙트 ────────────────────────────────────────────

  private renderAllGroundShapes(): void {
    this.gm.recordSystem.getGroundShapes().forEach(shape => {
      if (shape.tileId.startsWith(SCENE_KEY)) {
        this.renderGroundShape(shape.id, shape.tileId);
      }
    });
  }

  private renderGroundShape(shapeId: string, tileId: string): void {
    const pos = this.fromTileId(tileId);
    if (!pos) return;

    const x = pos.tx * TILE_SIZE + TILE_SIZE / 2;
    const y = pos.ty * TILE_SIZE + TILE_SIZE / 2;

    const effect = this.add.rectangle(x, y, TILE_SIZE - 2, TILE_SIZE - 2, 0xffdd00, 0.7)
      .setDepth(2);

    // 반짝임 트윈
    this.tweens.add({
      targets:  effect,
      alpha:    0.2,
      duration: 600,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   -1,
    });

    this.groundShapeEffects.set(shapeId, effect);
  }

  // ── 수확 드롭 렌더링 ──────────────────────────────────────────

  private renderAllDrops(): void {
    this.gm.farmSystem.getHarvestDrops().forEach(drop => {
      if (drop.tileId.startsWith(SCENE_KEY)) {
        this.renderDrop(drop);
      }
    });
  }

  private renderDrop(drop: HarvestDrop): void {
    const pos = this.fromTileId(drop.tileId);
    if (!pos) return;

    const x = pos.tx * TILE_SIZE + TILE_SIZE / 2;
    const y = pos.ty * TILE_SIZE + TILE_SIZE / 2;

    const circle = this.add.circle(0, 0, 5, 0xffaa00).setDepth(4);
    const label  = this.add.text(0, -10, CROP_DATA[drop.itemId]?.label?.slice(0, 2) ?? '?', {
      fontSize: '8px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(4);

    const container = this.add.container(x, y, [circle, label]).setDepth(4);

    // 통통 튀는 트윈
    this.tweens.add({
      targets:  container,
      y:        y - 3,
      duration: 400,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   -1,
    });

    this.dropSprites.set(drop.id, container);
  }

  // ── 애니메이션 ────────────────────────────────────────────────

  private playHoeAnim(tileId: string): void {
    const world = this.tileIdToWorld(tileId);
    if (!world) return;

    const flash = this.add.rectangle(world.x, world.y, TILE_SIZE, TILE_SIZE, 0xffffff, 0.5)
      .setDepth(3);
    this.tweens.add({
      targets:  flash,
      alpha:    0,
      duration: 200,
      onComplete: () => flash.destroy(),
    });
  }

  private playWaterAnim(tx: number, ty: number, range: Array<[number, number]>): void {
    range.forEach(([dx, dy]) => {
      const x = (tx + dx) * TILE_SIZE + TILE_SIZE / 2;
      const y = (ty + dy) * TILE_SIZE + TILE_SIZE / 2;
      const drop = this.add.circle(x, y, 3, 0x44aaff, 0.8).setDepth(3);
      this.tweens.add({
        targets:  drop,
        alpha:    0,
        y:        y + 4,
        duration: 400,
        onComplete: () => drop.destroy(),
      });
    });
  }

  // ── 비 자동 물주기 ────────────────────────────────────────────

  private applyRainWatering(): void {
    const tiles = this.gm.farmSystem.getTiles().filter(t => t.id.startsWith(SCENE_KEY));
    const updated = this.gm.weatherSystem.applyRainToFarm(tiles);
    updated.forEach(t => this.renderTile(t.id));
    console.log('[NorthYardScene] 비로 인한 자동 물주기 완료');
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    // 타일 변경 → 재렌더링
    this.gm.farmSystem.on('tileChanged', (tile: FarmTile) => {
      if (tile.id.startsWith(SCENE_KEY)) {
        this.renderTile(tile.id);
      }
    });

    // 수확 드롭 → 렌더링
    this.gm.farmSystem.on('itemDropped', (drop: HarvestDrop) => {
      if (drop.tileId.startsWith(SCENE_KEY)) {
        this.renderDrop(drop);
      }
    });

    // 땅 모양 생성
    this.gm.recordSystem.on('groundShapeSpawned', (tileId: string, shapeId: string) => {
      if (tileId.startsWith(SCENE_KEY)) {
        this.renderGroundShape(shapeId, tileId);
      }
    });

    // 땅 모양 제거 (플레이어가 팠을 때)
    this.gm.recordSystem.on('groundShapeRemoved', (shapeId: string) => {
      const effect = this.groundShapeEffects.get(shapeId);
      if (effect) { effect.destroy(); this.groundShapeEffects.delete(shapeId); }
    });

    // 날씨 변경 → 비면 자동 물주기
    this.gm.timeSystem.on('weatherChanged', () => {
      if (this.gm.weatherSystem.isRaining()) {
        this.applyRainWatering();
      }
    });

    // 날짜 변경 → 타일 전체 재렌더링 (성장·시들기 반영)
    this.gm.timeSystem.on('dayChanged', () => {
      this.time.delayedCall(100, () => this.renderAllTiles());
    });
  }

  // ── UI ────────────────────────────────────────────────────────

  private createActionHint(): void {
    this.actionHint = this.add.text(8, 8, '', {
      fontSize: '11px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(10);
  }

  // ── 유틸 ──────────────────────────────────────────────────────

  private getEquippedToolId(): string | null {
    const idx  = this.gm.inventorySystem.getEquippedSlot();
    if (idx === null) return null;
    const tool = this.gm.inventorySystem.getQuickSlots()[idx];
    return tool?.id ?? null;
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(): void {
    this.handleMovement();
  }

  private handleMovement(): void {
    if (this.playerBlocked) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0, vy = 0;

    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  PLAYER_SPEED;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -PLAYER_SPEED;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  PLAYER_SPEED;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    body.setVelocity(vx, vy);
  }

  // ── wake ──────────────────────────────────────────────────────

  wake(data?: { from?: string; coord?: number; axis?: string }): void {
    const { x, y } = this.getSpawnPos(data);
    this.player.setPosition(x, y);
    this.renderAllTiles();
    this.renderAllDrops();
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();
  }
}