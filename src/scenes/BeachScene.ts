// ================================================================
// BeachScene — 동쪽 바다 씬
// ================================================================
//
// 레이아웃:
//   서쪽: 모래사장 (@) — 이동·채집 가능
//   중앙: 걸을 수 있는 바다 (O, 1칸) — 낚시 가능 구역
//   동쪽: 바다 (X) — 충돌로 막힘
//
// 진입:
//   좌측 상단 → MountainPathScene
//   좌측 중앙 → VillageScene
//
// 채집 (우클릭, 맨손):
//   조개20% / 게20% / 해초60%
//   매일 최대 7개, 하루 이내 재생성
//
// 낚시 (미구현):
//   낚싯대 장착 + O타일에서 우클릭 → 플레이스홀더
//   O타일 밖 → 헛손질 연출
//
// 날씨:
//   맑음: 잔잔한 파도
//   비: 거친 파도 (속도·진폭 증가)
// ================================================================

import Phaser from 'phaser';
import { SceneTransition } from '../ui/SceneTransition';
import { portalKey } from '../data/portals';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import type { HerbObject } from '../types';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE    = 16;
const MAP_W        = 50;
const MAP_H        = 40;
const PLAYER_SPEED = 120;
const T            = TILE_SIZE;

const MAX_GATHERS_DAY = 7;
const GATHER_RANGE    = TILE_SIZE * 2;

// ── 맵 구역 경계 (타일) ─────────────────────────────────────────

const SAND_X_END  = 28;   // 모래사장 끝
const SEA_WALK_X  = 29;   // 걸을 수 있는 바다 (O, 1칸)
const SEA_START_X = 30;   // 바다 시작

// 방파제 (ㄷ자 구조물)
const BREAKWATER = {
  top:    { x: 32, y: 5,  w: 13, h: 2  },  // 상단 가로
  right:  { x: 43, y: 5,  w: 2,  h: 21 },  // 우측 세로
  bottom: { x: 32, y: 24, w: 13, h: 2  },  // 하단 가로
  inner:  { x: 32, y: 7,  w: 11, h: 17 },  // 내부 (바다, 진입 불가)
};

// 등대
const LIGHTHOUSE = { x: 46, y: 10, w: 3, h: 10 };

// 드롭 테이블 (갯벌과 동일)
const GATHER_TABLE = [
  { itemId: 'clam',    label: '조개', weight: 20 },
  { itemId: 'crab',    label: '게',   weight: 20 },
  { itemId: 'seaweed', label: '해초', weight: 60 },
] as const;

// ── BeachScene ────────────────────────────────────────────────────

export class BeachScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // 플레이어
  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private transition!: SceneTransition;
  private _fromData?: { from?: string; coord?: number; axis?: string };
  private _fromScene?: string;

  // 충돌
  private seaGroup!: Phaser.Physics.Arcade.StaticGroup;

  // 파도 그래픽
  private waveGfx!:  Phaser.GameObjects.Graphics;
  private wavePhase  = 0;
  private waveSpeed  = 0.03;
  private waveAmp    = 3;

  // 채집 오브젝트
  private gatherSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  constructor() {
    super({ key: SCENE_KEYS.BEACH });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(data?: { from?: string; coord?: number; axis?: string }): void {
    this.gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromScene = data?.from;
    this._fromData  = data;

    this.buildBackground();
    this.buildCollision();
    this.createPlayer();
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    this.spawnGatherObjects();
    this.renderAllGatherObjects();
    this.registerFishing();
    this.subscribeEvents();
    this.applyWeather(this.gm.weatherSystem.isRaining());

    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
    console.log('[BeachScene] 생성 완료');
  }

  // ── 배경 ──────────────────────────────────────────────────────

  private buildBackground(): void {
    const W   = MAP_W * T;
    const H   = MAP_H * T;
    const gfx = this.add.graphics().setDepth(0);

    // ── 모래사장 ─────────────────────────────────────────────────
    gfx.fillStyle(0xe8d5a3);
    gfx.fillRect(0, 0, SAND_X_END * T, H);

    // 모래 텍스처
    gfx.fillStyle(0xd4c090, 0.3);
    for (let i = 0; i < 40; i++) {
      const dx = Phaser.Math.Between(T, SAND_X_END * T - T);
      const dy = Phaser.Math.Between(T, H - T);
      gfx.fillEllipse(dx, dy, Phaser.Math.Between(6, 20), Phaser.Math.Between(3, 8));
    }

    // ── O타일 (걸을 수 있는 바다, 1칸) ──────────────────────────
    gfx.fillStyle(0x5599cc);
    gfx.fillRect(SEA_WALK_X * T, 0, T, H);

    // ── 바다 ─────────────────────────────────────────────────────
    gfx.fillStyle(0x2255aa);
    gfx.fillRect(SEA_START_X * T, 0, (MAP_W - SEA_START_X) * T, H);

    // 바다 파도 질감
    gfx.fillStyle(0x3366bb, 0.3);
    for (let y = 0; y < MAP_H; y += 4) {
      gfx.fillRect(SEA_START_X * T, y * T, (MAP_W - SEA_START_X) * T, T);
    }

    // ── 방파제 (ㄷ자) ────────────────────────────────────────────
    const bwColor  = 0x555555;
    const bwStroke = 0x333333;

    // 상단 가로
    gfx.fillStyle(bwColor);
    gfx.fillRect(
      BREAKWATER.top.x * T, BREAKWATER.top.y * T,
      BREAKWATER.top.w * T, BREAKWATER.top.h * T
    );
    // 우측 세로
    gfx.fillRect(
      BREAKWATER.right.x * T, BREAKWATER.right.y * T,
      BREAKWATER.right.w * T, BREAKWATER.right.h * T
    );
    // 하단 가로
    gfx.fillRect(
      BREAKWATER.bottom.x * T, BREAKWATER.bottom.y * T,
      BREAKWATER.bottom.w * T, BREAKWATER.bottom.h * T
    );

    // 방파제 테두리
    gfx.lineStyle(1.5, bwStroke, 0.8);
    gfx.strokeRect(BREAKWATER.top.x * T, BREAKWATER.top.y * T, BREAKWATER.top.w * T, BREAKWATER.top.h * T);
    gfx.strokeRect(BREAKWATER.right.x * T, BREAKWATER.right.y * T, BREAKWATER.right.w * T, BREAKWATER.right.h * T);
    gfx.strokeRect(BREAKWATER.bottom.x * T, BREAKWATER.bottom.y * T, BREAKWATER.bottom.w * T, BREAKWATER.bottom.h * T);

    // 방파제 내부 (바다로 표시)
    gfx.fillStyle(0x1a4488);
    gfx.fillRect(
      BREAKWATER.inner.x * T, BREAKWATER.inner.y * T,
      BREAKWATER.inner.w * T, BREAKWATER.inner.h * T
    );

    // ── 등대 ─────────────────────────────────────────────────────
    gfx.fillStyle(0xdddddd);
    gfx.fillRect(LIGHTHOUSE.x * T, LIGHTHOUSE.y * T, LIGHTHOUSE.w * T, LIGHTHOUSE.h * T);
    // 등대 줄무늬 (빨강)
    gfx.fillStyle(0xcc3333, 0.7);
    for (let i = 0; i < 4; i++) {
      gfx.fillRect(LIGHTHOUSE.x * T, (LIGHTHOUSE.y + i * 2.5) * T, LIGHTHOUSE.w * T, T);
    }
    // 등대 불빛
    gfx.fillStyle(0xffff88, 0.9);
    gfx.fillCircle(
      (LIGHTHOUSE.x + LIGHTHOUSE.w / 2) * T,
      LIGHTHOUSE.y * T,
      T * 1.5
    );

    // ── 라벨 ─────────────────────────────────────────────────────
    this.add.text(SAND_X_END * T / 2, H / 2, '모래사장', {
      fontSize: '12px', color: '#8b6914',
    }).setOrigin(0.5).setDepth(1);

    this.add.text(
      (LIGHTHOUSE.x + LIGHTHOUSE.w / 2) * T,
      (LIGHTHOUSE.y + LIGHTHOUSE.h + 1) * T,
      '등대', { fontSize: '9px', color: '#ffffff' }
    ).setOrigin(0.5, 0).setDepth(1);

    this.add.text(
      (BREAKWATER.top.x + BREAKWATER.top.w / 2) * T,
      (BREAKWATER.top.y - 1) * T,
      '방파제', { fontSize: '9px', color: '#cccccc' }
    ).setOrigin(0.5, 1).setDepth(1);

    // ── 파도 그래픽 (update에서 갱신) ────────────────────────────
    this.waveGfx = this.add.graphics().setDepth(2);
  }

  // ── 충돌 ──────────────────────────────────────────────────────

  private buildCollision(): void {
    const H = MAP_H * T;
    this.seaGroup = this.physics.add.staticGroup();

    const addBlock = (px: number, py: number, pw: number, ph: number) => {
      const b = this.add.rectangle(px + pw/2, py + ph/2, pw, ph, 0x000000, 0);
      this.physics.add.existing(b, true);
      this.seaGroup.add(b);
    };

    // ── 바다 전체 (방파제 제외) ───────────────────────────────
    // SEA_START_X 이후 전체
    addBlock(SEA_START_X * T, 0, (MAP_W - SEA_START_X) * T, H);

    // ── 방파제 위는 위 블록에서 제거 (구멍 뚫기) ─────────────
    // Phaser StaticGroup은 구멍 뚫기가 안 되므로
    // 방파제 영역을 세부 블록으로 쪼개서 재구성

    // 바다를 방파제 주변으로 분할 (방파제 y=5~26 범위)
    // 방파제 y 위 (y=0~5)
    // 방파제 y 아래 (y=26~40)
    // 방파제 좌측 바다 (x=30~32, y=5~26)
    // 방파제 내부 (x=32~43, y=7~24)

    // 일단 전체 바다 블록 제거하고 세부 분할
    this.seaGroup.clear(true, true);

    const seaX   = SEA_START_X * T;
    const seaW   = (MAP_W - SEA_START_X) * T;
    const bwTopY = BREAKWATER.top.y * T;
    const bwBotY = (BREAKWATER.bottom.y + BREAKWATER.bottom.h) * T;

    // 방파제 위 바다 (y=0 ~ bwTopY)
    addBlock(seaX, 0, seaW, bwTopY);

    // 방파제 아래 바다 (y=bwBotY ~ H)
    addBlock(seaX, bwBotY, seaW, H - bwBotY);

    // 방파제 좌측 바다 (x=SEA_START_X ~ bw.top.x, y=bwTopY~bwBotY)
    const leftW = (BREAKWATER.top.x - SEA_START_X) * T;
    if (leftW > 0) addBlock(seaX, bwTopY, leftW, bwBotY - bwTopY);

    // 방파제 내부 바다 (x=bw.inner, y=bw.inner)
    addBlock(
      BREAKWATER.inner.x * T,
      BREAKWATER.inner.y * T,
      BREAKWATER.inner.w * T,
      BREAKWATER.inner.h * T
    );

    // 방파제 우측 바다 (x=bw.right 우측 ~ MAP_W)
    const bwRightEnd = (BREAKWATER.right.x + BREAKWATER.right.w) * T;
    const rightW     = MAP_W * T - bwRightEnd;
    if (rightW > 0) addBlock(bwRightEnd, bwTopY, rightW, bwBotY - bwTopY);

    // ── 등대 충돌 ────────────────────────────────────────────
    addBlock(
      LIGHTHOUSE.x * T, LIGHTHOUSE.y * T,
      LIGHTHOUSE.w * T, LIGHTHOUSE.h * T
    );
  }

  // ── 플레이어 ──────────────────────────────────────────────────

  private createPlayer(): void {
    // from에 따라 스폰 위치
    const spawnX = (SAND_X_END - 4) * TILE_SIZE;
    const spawnY = this._fromScene === 'mountain_path'
      ? 4 * TILE_SIZE                // 산길에서 → 상단
      : MAP_H / 2 * TILE_SIZE;       // 마을에서 → 중앙

    this.player = this.add.rectangle(spawnX, spawnY, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.seaGroup);
  }

  private setupCamera(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;
    this.physics.world.setBounds(0, 0, W, H);
    this.cameras.main.setBounds(0, 0, W, H).startFollow(this.player, true, 0.1, 0.1);
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

    // 우클릭 누르기 → 채집 or 낚시 충전 시작
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 2) return;
      const fs = this.gm.fishingSystem;
      if (fs.isBusy() && fs.getState() !== 'charging') return;
      if (this.playerBlocked && fs.getState() !== 'charging') return;
      this.handleRightClick();
    });

    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── 씬 전환 ───────────────────────────────────────────────────

  private createExitZones(): void {
    const T = TILE_SIZE;
    this.transition = new SceneTransition(this, this.gm);
    this.transition.setPlayer(this.player);

    const blocked = () => this.playerBlocked;

    const portals = [
      { fromKey: 'beach', toKey: 'village',       target: SCENE_KEYS.VILLAGE,
        x: 0, y: T*15, w: T*2, h: T*10, dir: 'left' as const },
      { fromKey: 'beach', toKey: 'mountain_path', target: SCENE_KEYS.MOUNTAIN_PATH,
        x: 0, y: T*3,  w: T*2, h: T*10, dir: 'left' as const },
    ];

    portals.forEach(p => {
      this.transition.addPortal({
        fromKey: p.fromKey, toKey: p.toKey,
        targetScene: p.target,
        zoneX: p.x, zoneY: p.y, zoneW: p.w, zoneH: p.h,
        direction: p.dir, isBlocked: blocked,
      });
    });

    const hintGfx = this.add.graphics().setDepth(1);
    portals.forEach(p => SceneTransition.drawPortalHint(hintGfx, portalKey(p.fromKey, p.toKey)));
  }

  // ── 우클릭 처리 ───────────────────────────────────────────────

  private handleRightClick(): void {
    const tileX = Math.floor(this.player.x / T);

    // 낚싯대 장착 시 어디서든 던지기 시도
    const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
    const quickSlots  = this.gm.inventorySystem.getQuickSlots();
    const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;

    if (tool?.type === 'fishingRod') {
      this.handleFishing();
      return;
    }

    // 모래사장 또는 방파제 위에서 채집
    if (tileX <= SAND_X_END) {
      this.tryGatherNearby();
      return;
    }
  }

  // ── 물 타일 판정 ──────────────────────────────────────────────

  isWaterTile(px: number, py: number): boolean {
    const tx = Math.floor(px / T);
    const ty = Math.floor(py / T);

    // O타일
    if (tx === SEA_WALK_X) return true;

    // 바다 영역 미만
    if (tx < SEA_START_X) return false;

    // 방파제 구조물 위는 물 아님
    const onTop    = tx >= BREAKWATER.top.x    && tx < BREAKWATER.top.x + BREAKWATER.top.w
                  && ty >= BREAKWATER.top.y    && ty < BREAKWATER.top.y + BREAKWATER.top.h;
    const onRight  = tx >= BREAKWATER.right.x  && tx < BREAKWATER.right.x + BREAKWATER.right.w
                  && ty >= BREAKWATER.right.y  && ty < BREAKWATER.right.y + BREAKWATER.right.h;
    const onBottom = tx >= BREAKWATER.bottom.x && tx < BREAKWATER.bottom.x + BREAKWATER.bottom.w
                  && ty >= BREAKWATER.bottom.y && ty < BREAKWATER.bottom.y + BREAKWATER.bottom.h;
    if (onTop || onRight || onBottom) return false;

    // 등대
    const onLH = tx >= LIGHTHOUSE.x && tx < LIGHTHOUSE.x + LIGHTHOUSE.w
              && ty >= LIGHTHOUSE.y && ty < LIGHTHOUSE.y + LIGHTHOUSE.h;
    if (onLH) return false;

    return true;  // 바다 + 방파제 내부
  }


  // ── 낚시 등록 ─────────────────────────────────────────────────

  private registerFishing(): void {
    this.gm.setWaterChecker((px, py) => this.isWaterTile(px, py));

    // playerBlocked 해제만 담당 (catch 게임 로직은 HUDScene에서 처리)
    const fs = this.gm.fishingSystem;
    fs.on('catch', () => { this.playerBlocked = false; });
    fs.on('fail',  () => { this.playerBlocked = false; });
    fs.on('reset', () => { this.playerBlocked = false; });
  }

  // ── 낚시 ──────────────────────────────────────────────────────

  private handleFishing(): void {
    const fs = this.gm.fishingSystem;
    if (!fs.isIdle()) return;

    const hud         = this.scene.get(SCENE_KEYS.HUD) as any;
    const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
    const quickSlots  = this.gm.inventorySystem.getQuickSlots();
    const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;

    if (!tool || tool.type !== 'fishingRod') {
      this.playMisscastAnim();
      hud?.showToast?.('낚싯대가 필요해요.', 'warn');
      return;
    }

    if (!this.gm.energySystem.consume(6)) {
      hud?.showToast?.('기력이 부족해요.', 'warn');
      return;
    }

    this.gm.toolSystem.useTool(tool.id);

    // FishingUI에 낚싯대 위치 전달
    hud?.getFishingUI?.()?.setRodPosition(this.player.x - this.cameras.main.scrollX, this.player.y - 8 - this.cameras.main.scrollY);

    this.playerBlocked = true;
    fs.startCharging();
  }

  private playMisscastAnim(): void {
    // 헛손질 연출 (좌우 흔들기)
    this.tweens.add({
      targets:  this.player,
      x:        this.player.x + 5,
      duration: 60,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   2,
    });

    // 물음표 이펙트
    const txt = this.add.text(
      this.player.x, this.player.y - 20, '?',
      { fontSize: '16px', color: '#ffffff', fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(7);

    this.tweens.add({
      targets:  txt,
      y:        this.player.y - 40,
      alpha:    0,
      duration: 600,
      onComplete: () => txt.destroy(),
    });
  }

  // ── 채집 ──────────────────────────────────────────────────────

  private getGatherObjects(): HerbObject[] {
    return this.gm.gameState.herbObjects.filter(h => h.id.startsWith('beach_'));
  }

  private spawnGatherObjects(): void {
    const existing  = this.getGatherObjects();
    const toSpawn   = MAX_GATHERS_DAY - existing.length;
    if (toSpawn <= 0) return;

    for (let i = 0; i < toSpawn; i++) {
      const pos = this.randomGatherPos(existing);
      if (!pos) break;

      const obj: HerbObject = {
        id:         `beach_${Date.now()}_${i}`,
        tileX:      pos.tx,
        tileY:      pos.ty,
        spawnedDay: this.gm.timeSystem.getTotalDays(),
      };
      this.gm.gameState.herbObjects.push(obj);
      existing.push(obj);
    }
  }

  private randomGatherPos(existing: HerbObject[]): { tx: number; ty: number } | null {
    const occupied = new Set(existing.map(h => `${h.tileX}:${h.tileY}`));
    for (let i = 0; i < 50; i++) {
      const tx = Phaser.Math.Between(2, SAND_X_END - 2);
      const ty = Phaser.Math.Between(2, MAP_H - 3);
      if (!occupied.has(`${tx}:${ty}`)) return { tx, ty };
    }
    return null;
  }

  private renderAllGatherObjects(): void {
    this.getGatherObjects().forEach(obj => this.renderGatherObject(obj));
  }

  private renderGatherObject(obj: HerbObject): void {
    if (this.gatherSprites.has(obj.id)) return;

    const x = obj.tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = obj.tileY * TILE_SIZE + TILE_SIZE / 2;

    const drop   = this.rollDrop();
    const colors: Record<string, number> = {
      clam: 0xeeeecc, crab: 0xff8844, seaweed: 0x44aa44,
    };
    const emojis: Record<string, string> = {
      clam: '🐚', crab: '🦀', seaweed: '🌿',
    };

    const circle = this.add.circle(0, 0, 5, colors[drop] ?? 0xcccccc).setDepth(3);
    const label  = this.add.text(0, -10, emojis[drop] ?? '?', {
      fontSize: '10px',
    }).setOrigin(0.5).setDepth(4);

    const container = this.add.container(x, y, [circle, label])
      .setDepth(3).setData('drop', drop);

    this.gatherSprites.set(obj.id, container);
  }

  private rollDrop(): string {
    const rand = Math.random() * 100;
    let acc = 0;
    for (const entry of GATHER_TABLE) {
      acc += entry.weight;
      if (rand < acc) return entry.itemId;
    }
    return 'seaweed';
  }

  private tryGatherNearby(): void {
    const objs = this.getGatherObjects();
    let nearest: HerbObject | null = null;
    let minDist = Infinity;

    objs.forEach(obj => {
      const ox   = obj.tileX * TILE_SIZE + TILE_SIZE / 2;
      const oy   = obj.tileY * TILE_SIZE + TILE_SIZE / 2;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, ox, oy);
      if (dist < GATHER_RANGE && dist < minDist) {
        minDist  = dist;
        nearest  = obj;
      }
    });

    if (!nearest) return;
    this.gatherObject(nearest);
  }

  private gatherObject(obj: HerbObject): void {
    const hud    = this.scene.get(SCENE_KEYS.HUD) as any;
    const sprite = this.gatherSprites.get(obj.id);
    const drop   = sprite?.getData('drop') ?? this.rollDrop();
    const entry  = GATHER_TABLE.find(d => d.itemId === drop);

    if (!this.gm.energySystem.consume(2)) {
      hud?.showToast?.('기력이 부족해요.', 'warn');
      return;
    }

    const added = this.gm.inventorySystem.addItem({
      itemId:    drop,
      itemType:  'crop',
      condition: 'normal',
      quantity:  1,
    });

    if (!added) {
      hud?.showToast?.('인벤토리가 꽉 찼어요.', 'warn');
      return;
    }

    hud?.showToast?.(`${entry?.label ?? drop} 획득!`, 'ok');
    this.playGatherEffect(obj.tileX, obj.tileY, entry?.label ?? drop);

    // GameState에서 제거
    this.gm.gameState.herbObjects = this.gm.gameState.herbObjects.filter(h => h.id !== obj.id);

    if (sprite) {
      this.tweens.add({
        targets:  sprite,
        alpha:    0,
        y:        sprite.y - 16,
        duration: 250,
        onComplete: () => { sprite.destroy(); this.gatherSprites.delete(obj.id); },
      });
    }

    // 하루 최대 개수 이내 재생성
    if (this.getGatherObjects().length < MAX_GATHERS_DAY) {
      const pos = this.randomGatherPos(this.getGatherObjects());
      if (pos) {
        const newObj: HerbObject = {
          id:         `beach_${Date.now()}_respawn`,
          tileX:      pos.tx,
          tileY:      pos.ty,
          spawnedDay: this.gm.timeSystem.getTotalDays(),
        };
        this.gm.gameState.herbObjects.push(newObj);
        this.renderGatherObject(newObj);
      }
    }
  }

  private playGatherEffect(tileX: number, tileY: number, label: string): void {
    const cx = tileX * TILE_SIZE + TILE_SIZE / 2;
    const cy = tileY * TILE_SIZE + TILE_SIZE / 2;

    for (let i = 0; i < 4; i++) {
      const angle    = (i / 4) * Math.PI * 2;
      const particle = this.add.circle(cx, cy, 3, 0xffd700, 0.8).setDepth(6);
      this.tweens.add({
        targets:  particle,
        x:        cx + Math.cos(angle) * 18,
        y:        cy + Math.sin(angle) * 18,
        alpha:    0,
        duration: 300,
        onComplete: () => particle.destroy(),
      });
    }

    const txt = this.add.text(cx, cy - 8, `+${label}`, {
      fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(7);
    this.tweens.add({
      targets:  txt,
      y:        cy - 30,
      alpha:    0,
      duration: 700,
      onComplete: () => txt.destroy(),
    });
  }

  // ── 파도 ──────────────────────────────────────────────────────

  private applyWeather(isRaining: boolean): void {
    this.waveSpeed = isRaining ? 0.08 : 0.03;
    this.waveAmp   = isRaining ? 6    : 3;
  }

  private drawWaves(): void {
    this.waveGfx.clear();
    const H = MAP_H * TILE_SIZE;
    const isRaining = this.gm.weatherSystem.isRaining();

    // 파도 색상 (비 오는 날 더 어둡게)
    this.waveGfx.lineStyle(
      isRaining ? 2 : 1.5,
      isRaining ? 0x3366aa : 0x55aadd,
      isRaining ? 0.7 : 0.5
    );

    // 여러 줄 파도
    /*
    const waveLines = isRaining ? 5 : 3;
    for (let w = 0; w < waveLines; w++) {
      const offsetX = SEA_BLOCK_X * TILE_SIZE + w * TILE_SIZE * 2;
      this.waveGfx.beginPath();
      for (let y = 0; y <= H; y += 4) {
        const x = offsetX + Math.sin(y * 0.05 + this.wavePhase + w) * this.waveAmp;
        if (y === 0) this.waveGfx.moveTo(x, y);
        else         this.waveGfx.lineTo(x, y);
      }
      this.waveGfx.strokePath();
    }

    this.wavePhase += this.waveSpeed;
    */
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    this.gm.timeSystem.on('weatherChanged', () => {
      this.applyWeather(this.gm.weatherSystem.isRaining());
    });

    this.gm.timeSystem.on('dayChanged', () => {
      this.spawnGatherObjects();
      this.renderAllGatherObjects();
    });
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    this.drawWaves();

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
    this.registerFishing();
    this.applyWeather(this.gm.weatherSystem.isRaining());
    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
  }
}