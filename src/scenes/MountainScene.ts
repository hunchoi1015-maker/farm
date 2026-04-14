// ================================================================
// MountainScene — 북쪽 산 씬
// ================================================================
//
// 특징:
//   - 60×50 임시 맵 (초록 배경 + 시냇물)
//   - 4잎풀: 매일 아침 최대 5개 랜덤 생성, 우클릭으로 채집
//   - 드롭: 산삼(39%) / 더덕(60%) / 책(1%) → 인벤토리 직접 추가
//   - 낚시: 차후 추가 (시냇물 영역만 표시)
//
// 씬 전환:
//   남쪽 → VillageScene
//   서쪽 → CliffPathScene (→ 갯벌)
//   동쪽 → MountainPathScene (→ 바다)
//
// 채집 연출:
//   우클릭 → 파티클 이펙트 + 아이템 획득 텍스트
//   낫 미장착 / 내구도 0 / 기력 부족 → 차단 + 알림
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import type { HerbObject } from '../types';
import { CONTAINER_DATA } from '../data/records';
import { SceneTransition } from '../ui/SceneTransition';
import { portalKey } from '../data/portals';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE      = 16;
const MAP_W          = 60;
const MAP_H          = 50;
const PLAYER_SPEED   = 120;
const INTERACT_RANGE = TILE_SIZE * 2;
const MAX_HERBS_DAY  = 5;       // 하루 최대 생성 개수
const HERB_ENERGY    = 2;       // 채집 기력 소모

// 드롭 확률
const DROP_TABLE = [
  { itemId: 'ginseng',  weight: 39 },
  { itemId: 'deodeok',  weight: 60 },
  { itemId: 'book',     weight:  1 },
] as const;

// 채집 가능 구역 (벽·시냇물 제외 맵 전체)
const HERB_ZONE = { minX: 2, maxX: MAP_W - 3, minY: 2, maxY: MAP_H - 3 };

// 시냇물 영역 (y=22~25, x=10~50)
const STREAM = { x: 10, y: 22, w: 40, h: 4 };

// ── MountainScene ─────────────────────────────────────────────────

export class MountainScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // 플레이어
  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private _fromScene?: string;
  private _fromData?: { from?: string; coord?: number; axis?: string };

  // 충돌 그룹
  private streamGroup!: Phaser.Physics.Arcade.StaticGroup;

  // 4잎풀 오브젝트
  private herbSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private transition!: SceneTransition;

  constructor() {
    super({ key: SCENE_KEYS.MOUNTAIN });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(data?: { from?: string; coord?: number; axis?: string }): void {
    this.gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromScene = data?.from;
    this._fromData  = data;

    this.buildBackground();
    this.createPlayer(this._fromData);
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    this.spawnHerbs();
    this.renderAllHerbs();
    this.subscribeEvents();
    this.registerFishing();

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();

    console.log('[MountainScene] 생성 완료');
  }

  // ── 배경 ──────────────────────────────────────────────────────

  private buildBackground(): void {
    const W   = MAP_W * TILE_SIZE;
    const H   = MAP_H * TILE_SIZE;
    const gfx = this.add.graphics().setDepth(0);

    // 배경 (산 초록)
    gfx.fillStyle(0x3a6b35); gfx.fillRect(0, 0, W, H);

    // 나무 느낌 어두운 구역들
    gfx.fillStyle(0x2d5428, 0.6);
    [[5,3,8,6],[20,5,6,8],[40,2,10,7],[52,8,6,10],
     [3,30,8,6],[25,35,6,8],[45,28,8,6]].forEach(([x,y,w,h]) => {
      gfx.fillRect(x*TILE_SIZE, y*TILE_SIZE, w*TILE_SIZE, h*TILE_SIZE);
    });

    // 시냇물
    gfx.fillStyle(0x4488cc);
    gfx.fillRect(STREAM.x*TILE_SIZE, STREAM.y*TILE_SIZE, STREAM.w*TILE_SIZE, STREAM.h*TILE_SIZE);

    // 시냇물 반짝임
    gfx.fillStyle(0x88bbee, 0.4);
    for (let i = 0; i < STREAM.w; i += 3) {
      gfx.fillRect((STREAM.x + i)*TILE_SIZE + 4, STREAM.y*TILE_SIZE + 6, TILE_SIZE - 8, 4);
    }

    // 시냇물 라벨
    this.add.text(
      (STREAM.x + STREAM.w / 2) * TILE_SIZE,
      (STREAM.y + STREAM.h / 2) * TILE_SIZE,
      '시냇물 (낚시 가능 예정)',
      { fontSize: '9px', color: '#ffffff88' }
    ).setOrigin(0.5).setDepth(1);

    // 경계 어두운 테두리
    gfx.fillStyle(0x1a3a18);
    gfx.fillRect(0, 0, W, TILE_SIZE);
    gfx.fillRect(0, 0, TILE_SIZE, H);
    gfx.fillRect(W - TILE_SIZE, 0, TILE_SIZE, H);
    gfx.fillRect(0, H - TILE_SIZE, W, TILE_SIZE);

    // 시냇물 충돌 그룹
    this.streamGroup = this.physics.add.staticGroup();
    const streamBlock = this.add.rectangle(
      (STREAM.x + STREAM.w / 2) * TILE_SIZE,
      (STREAM.y + STREAM.h / 2) * TILE_SIZE,
      STREAM.w * TILE_SIZE, STREAM.h * TILE_SIZE,
      0x000000, 0
    );
    this.physics.add.existing(streamBlock, true);
    this.streamGroup.add(streamBlock);
  }

  // ── 플레이어 ──────────────────────────────────────────────────

  private getSpawnPos(data?: { from?: string; coord?: number; axis?: string }): { x: number; y: number } {
    if (data?.from && data.coord !== undefined && data.coord >= 0) {
      return SceneTransition.calcSpawn(data, data.from, {
        x: MAP_W / 2 * TILE_SIZE, y: (MAP_H - 4) * TILE_SIZE,
      });
    }
    const cy = MAP_H / 2 * TILE_SIZE;
    switch (data?.from) {
      case 'cliff_path':    return { x: 4 * TILE_SIZE,           y: cy };
      case 'mountain_path': return { x: (MAP_W - 4) * TILE_SIZE, y: cy };
      default:              return { x: MAP_W / 2 * TILE_SIZE,   y: (MAP_H - 4) * TILE_SIZE };
    }
  }

  private createPlayer(data?: { from?: string; coord?: number; axis?: string }): void {
    const { x: spawnX, y: spawnY } = this.getSpawnPos(data);

    this.player = this.add.rectangle(spawnX, spawnY, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.streamGroup);
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

    // 우클릭 → 낚싯대 장착 시 낚시, 아니면 채집
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 2) return;
      if (this.playerBlocked) return;

      const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
      const quickSlots  = this.gm.inventorySystem.getQuickSlots();
      const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;

      if (tool?.type === 'fishingRod') {
        this.handleFishing();
      } else {
        this.tryHarvestNearby();
      }
    });

    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  private handleFishing(): void {
    const fs = this.gm.fishingSystem;
    if (!fs.isIdle()) return;
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
    const quickSlots  = this.gm.inventorySystem.getQuickSlots();
    const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;
    if (!tool || tool.type !== 'fishingRod') return;
    if (!this.gm.energySystem.consume(6)) { hud?.showToast?.('기력이 부족해요.', 'warn'); return; }
    this.gm.toolSystem.useTool(tool.id);
    hud?.getFishingUI?.()?.setRodPosition(this.player.x - this.cameras.main.scrollX, this.player.y - 8 - this.cameras.main.scrollY);
    this.playerBlocked = true;
    fs.startCharging();
  }

  // ── 씬 전환 ───────────────────────────────────────────────────

  private createExitZones(): void {
    const T = TILE_SIZE;
    this.transition = new SceneTransition(this, this.gm);
    this.transition.setPlayer(this.player);

    const blocked = () => this.playerBlocked;

    const portals = [
      { fromKey: 'mountain', toKey: 'village',       target: SCENE_KEYS.VILLAGE,
        x: T*25, y: T*50-T*2,  w: T*10, h: T*2, dir: 'down'  as const },
      { fromKey: 'mountain', toKey: 'cliff_path',    target: SCENE_KEYS.CLIFF_PATH,
        x: 0,    y: T*20,      w: T*2,  h: T*10, dir: 'left'  as const },
      { fromKey: 'mountain', toKey: 'mountain_path', target: SCENE_KEYS.MOUNTAIN_PATH,
        x: T*60-T*2, y: T*20, w: T*2,  h: T*10, dir: 'right' as const },
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

  // ── 4잎풀 생성 ────────────────────────────────────────────────

  /**
   * 매일 아침 호출. 현재 herbObjects 개수가 MAX_HERBS_DAY 미만이면 추가 생성.
   */
  private spawnHerbs(): void {
    const herbs      = this.gm.gameState.herbObjects;
    const totalDays  = this.gm.timeSystem.getTotalDays();
    const todayHerbs = herbs.filter(h => h.spawnedDay === totalDays);

    const toSpawn = MAX_HERBS_DAY - herbs.length;
    if (toSpawn <= 0) return;

    for (let i = 0; i < toSpawn; i++) {
      const pos = this.randomHerbPosition(herbs);
      if (!pos) break;

      const herb: HerbObject = {
        id:         `herb_${Date.now()}_${i}`,
        tileX:      pos.tx,
        tileY:      pos.ty,
        spawnedDay: totalDays,
      };
      herbs.push(herb);
    }

    console.log(`[MountainScene] 4잎풀 생성 — 총 ${herbs.length}개`);
  }

  private randomHerbPosition(
    existing: HerbObject[]
  ): { tx: number; ty: number } | null {
    const occupied = new Set(existing.map(h => `${h.tileX}:${h.tileY}`));

    // 최대 50회 시도
    for (let i = 0; i < 50; i++) {
      const tx = Phaser.Math.Between(HERB_ZONE.minX, HERB_ZONE.maxX);
      const ty = Phaser.Math.Between(HERB_ZONE.minY, HERB_ZONE.maxY);

      // 시냇물 구역 제외
      if (tx >= STREAM.x && tx < STREAM.x + STREAM.w &&
          ty >= STREAM.y && ty < STREAM.y + STREAM.h) continue;

      if (!occupied.has(`${tx}:${ty}`)) return { tx, ty };
    }
    return null;
  }

  // ── 4잎풀 렌더링 ──────────────────────────────────────────────

  private renderAllHerbs(): void {
    this.gm.gameState.herbObjects.forEach(herb => {
      this.renderHerb(herb);
    });
  }

  private renderHerb(herb: HerbObject): void {
    const x = herb.tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = herb.tileY * TILE_SIZE + TILE_SIZE / 2;

    const circle = this.add.circle(0, 0, 6, 0x44dd44).setDepth(3);
    const dot    = this.add.circle(0, 0, 2, 0xffffff).setDepth(4);
    const label  = this.add.text(0, -12, '🌿', {
      fontSize: '10px',
    }).setOrigin(0.5).setDepth(4);

    const container = this.add.container(x, y, [circle, dot, label]).setDepth(3);

    // 살랑살랑 트윈
    this.tweens.add({
      targets:  circle,
      scaleX:   1.2,
      scaleY:   0.9,
      duration: 800 + Math.random() * 400,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   -1,
    });

    this.herbSprites.set(herb.id, container);
  }

  // ── 채집 ──────────────────────────────────────────────────────

  private tryHarvestNearby(): void {
    const herbs = this.gm.gameState.herbObjects;

    // 가장 가까운 4잎풀 찾기
    let nearest: HerbObject | null = null;
    let minDist = Infinity;

    herbs.forEach(herb => {
      const hx   = herb.tileX * TILE_SIZE + TILE_SIZE / 2;
      const hy   = herb.tileY * TILE_SIZE + TILE_SIZE / 2;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, hx, hy);
      if (dist < INTERACT_RANGE && dist < minDist) {
        minDist  = dist;
        nearest  = herb;
      }
    });

    if (!nearest) return;
    this.harvestHerb(nearest);
  }

  private harvestHerb(herb: HerbObject): void {
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;

    // 낫 장착 확인
    const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
    if (equippedIdx === null) {
      hud?.showToast?.('낫을 퀵슬롯에 장착해주세요.', 'warn');
      return;
    }
    const quickSlots = this.gm.inventorySystem.getQuickSlots();
    const tool       = quickSlots[equippedIdx];
    if (!tool || tool.type !== 'sickle') {
      hud?.showToast?.('낫이 필요해요.', 'warn');
      return;
    }

    // 도구 사용 (내구도 소모)
    const multiplier = this.gm.farmSystem.getFarmLevel() >= 4 ? 0.5 : 1.0;
    if (!this.gm.toolSystem.useTool(tool.id, multiplier)) return;

    // 기력 소모
    if (!this.gm.energySystem.consume(HERB_ENERGY)) {
      hud?.showToast?.('기력이 부족해요.', 'warn');
      return;
    }

    // 드롭 결정
    const drop = this.rollDrop();

    // 인벤토리 추가
    if (drop === 'book') {
      // 책 → RecordSystem으로 용기 생성
      this.gm.recordSystem.digGroundShape(`mountain:${herb.tileX}:${herb.tileY}`);
      hud?.showToast?.('낡은 책을 발견했어요!', 'ok');
    } else {
      const added = this.gm.inventorySystem.addItem({
        itemId:    drop,
        itemType:  'crop',
        condition: 'normal',
        quantity:  1,
      });

      const label = drop === 'ginseng' ? '산삼' : '더덕';
      if (added) {
        hud?.showToast?.(`${label} 획득!`, 'ok');
      } else {
        hud?.showToast?.('인벤토리가 꽉 찼어요.', 'warn');
        return;
      }
    }

    // 채집 이펙트
    this.playHarvestEffect(herb.tileX, herb.tileY, drop);

    // GameState에서 제거
    this.gm.gameState.herbObjects = this.gm.gameState.herbObjects.filter(h => h.id !== herb.id);

    // 스프라이트 제거
    const sprite = this.herbSprites.get(herb.id);
    if (sprite) {
      this.tweens.add({
        targets:  sprite,
        alpha:    0,
        scaleX:   1.5,
        scaleY:   1.5,
        duration: 200,
        onComplete: () => { sprite.destroy(); this.herbSprites.delete(herb.id); },
      });
    }
  }

  private rollDrop(): 'ginseng' | 'deodeok' | 'book' {
    const rand = Math.random() * 100;
    let acc = 0;
    for (const entry of DROP_TABLE) {
      acc += entry.weight;
      if (rand < acc) return entry.itemId as any;
    }
    return 'deodeok';
  }

  // ── 채집 이펙트 ───────────────────────────────────────────────

  private playHarvestEffect(tileX: number, tileY: number, drop: string): void {
    const cx = tileX * TILE_SIZE + TILE_SIZE / 2;
    const cy = tileY * TILE_SIZE + TILE_SIZE / 2;

    // 파티클 (녹색 원들 퍼지기)
    for (let i = 0; i < 6; i++) {
      const angle  = (i / 6) * Math.PI * 2;
      const dist   = Phaser.Math.Between(20, 40);
      const px     = cx + Math.cos(angle) * dist;
      const py     = cy + Math.sin(angle) * dist;

      const particle = this.add.circle(cx, cy, 4, 0x88ee88, 0.9).setDepth(6);
      this.tweens.add({
        targets:  particle,
        x:        px,
        y:        py,
        alpha:    0,
        duration: 300 + i * 30,
        ease:     'Power2',
        onComplete: () => particle.destroy(),
      });
    }

    // 아이템 획득 텍스트
    const labels: Record<string, string> = {
      ginseng: '+산삼',
      deodeok: '+더덕',
      book:    '+낡은 책',
    };
    const txt = this.add.text(cx, cy - 10, labels[drop] ?? '+?', {
      fontSize: '12px',
      color:    drop === 'book' ? '#f9c74f' : '#aaffaa',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(7);

    this.tweens.add({
      targets:  txt,
      y:        cy - 35,
      alpha:    0,
      duration: 800,
      ease:     'Power2',
      onComplete: () => txt.destroy(),
    });
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    this.gm.timeSystem.on('dayChanged', () => {
      this.spawnHerbs();
      this.renderAllHerbs();
    });
  }

  private registerFishing(): void {
    this.gm.setWaterChecker((px, py) => {
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);
      return tx >= STREAM.x && tx < STREAM.x + STREAM.w
          && ty >= STREAM.y && ty < STREAM.y + STREAM.h;
    });

    const fs = this.gm.fishingSystem;
    fs.on('catch', () => { this.playerBlocked = false; });
    fs.on('fail',  () => { this.playerBlocked = false; });
    fs.on('reset', () => { this.playerBlocked = false; });
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(): void {
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
    this.herbSprites.forEach((sprite, id) => {
      const exists = this.gm.gameState.herbObjects.some(h => h.id === id);
      if (!exists) { sprite.destroy(); this.herbSprites.delete(id); }
    });
    this.registerFishing();

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();
  }
}