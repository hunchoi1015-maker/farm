// ================================================================
// SouthHouseScene — 남쪽 집 내부 씬
// ================================================================
//
// 행동:
//   침대 (E키) → 취침 확인 → 취침 연출 → 저장 → 다음 날
//   세면대 (E키) → 기력 10% 회복 (하루 2회)
//   가구 드래그 → 위치 자유 이동 + GameState 저장
//
// 취침 흐름:
//   EnergySystem.recordSleepHour()
//   → 취침 연출 (플레이어 알파 감소)
//   → HUD.fadeOut()
//   → SaveSystem.save()
//   → TimeSystem.sleep()
//   → HUD.fadeIn()
//
// 씬 전환:
//   출구 (남쪽) → NorthYardScene
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import type { FurnitureItem } from '../types';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE    = 16;
const MAP_W        = 20;
const MAP_H        = 16;
const PLAYER_SPEED = 120;
const SCENE_KEY    = 'south_house';

const WASH_MAX          = 2;
const WASH_ENERGY_RATIO = 0.1;   // 최대 기력의 10%
const INTERACT_RANGE    = TILE_SIZE * 2;

// 가구 기본 위치
const DEFAULT_FURNITURE: Omit<FurnitureItem, 'sceneKey'>[] = [
  { id: 'bed',  x: MAP_W / 2 * TILE_SIZE, y: MAP_H / 2 * TILE_SIZE },
  { id: 'sink', x: 3 * TILE_SIZE,         y: 3 * TILE_SIZE          },
];

// ── SouthHouseScene ──────────────────────────────────────────────

export class SouthHouseScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // 플레이어
  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;

  // 가구
  private furnitureObjects: Map<string, Phaser.GameObjects.Container> = new Map();
  private draggingFurniture: string | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // 상호작용
  private interactKey!: Phaser.Input.Keyboard.Key;
  private nearbyFurnitureId: string | null = null;
  private interactHint!: Phaser.GameObjects.Text;

  // 취침
  private isSleeping = false;

  constructor() {
    super({ key: SCENE_KEYS.SOUTH_HOUSE });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(): void {
    this.gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;

    this.buildBackground();
    this.buildWallCollision();
    this.createPlayer();
    this.setupCamera();
    this.setupInput();
    this.createExitZone();
    this.loadFurniture();
    this.createInteractHint();

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();

    console.log('[SouthHouseScene] 생성 완료');
  }

  // ── 배경 ──────────────────────────────────────────────────────

  private buildBackground(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;
    const gfx = this.add.graphics().setDepth(0);

    // 바닥 (나무 바닥 느낌)
    gfx.fillStyle(0xd4a96a); gfx.fillRect(0, 0, W, H);

    // 벽
    gfx.fillStyle(0x8b6914);
    gfx.fillRect(0, 0, W, TILE_SIZE);           // 상단 벽
    gfx.fillRect(0, 0, TILE_SIZE, H);           // 좌측 벽
    gfx.fillRect(W - TILE_SIZE, 0, TILE_SIZE, H); // 우측 벽
    gfx.fillRect(0, H - TILE_SIZE, W, TILE_SIZE); // 하단 벽 (출구 제외)

    // 출구 (하단 중앙)
    gfx.fillStyle(0x4a3000);
    gfx.fillRect(W / 2 - TILE_SIZE, H - TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);

    // 격자 (바닥 패턴)
    gfx.lineStyle(0.5, 0xc49055, 0.3);
    for (let x = 0; x <= MAP_W; x++) {
      gfx.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, H);
    }
    for (let y = 0; y <= MAP_H; y++) {
      gfx.lineBetween(0, y * TILE_SIZE, W, y * TILE_SIZE);
    }

    // 씬 라벨
    this.add.text(W / 2, TILE_SIZE + 4, '남쪽 집', {
      fontSize: '10px', color: '#3d2b1f',
    }).setOrigin(0.5, 0).setDepth(1);
  }


  private buildWallCollision(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;
    this.wallGroup = this.physics.add.staticGroup();

    // 상단 벽
    this.addWallBlock(0, 0, W, TILE_SIZE);
    // 좌측 벽
    this.addWallBlock(0, 0, TILE_SIZE, H);
    // 우측 벽
    this.addWallBlock(W - TILE_SIZE, 0, TILE_SIZE, H);
    // 하단 벽 (출구 제외: 중앙 TILE_SIZE*2 구간)
    this.addWallBlock(0, H - TILE_SIZE, W / 2 - TILE_SIZE, TILE_SIZE);
    this.addWallBlock(W / 2 + TILE_SIZE, H - TILE_SIZE, W / 2 - TILE_SIZE, TILE_SIZE);
  }

  private addWallBlock(x: number, y: number, w: number, h: number): void {
    const block = this.add.rectangle(x + w/2, y + h/2, w, h, 0x000000, 0);
    this.physics.add.existing(block, true);
    this.wallGroup.add(block);
  }

  // ── 플레이어 ──────────────────────────────────────────────────

  private createPlayer(): void {
    const spawnX = MAP_W / 2 * TILE_SIZE;
    const spawnY = (MAP_H - 3) * TILE_SIZE;

    this.player = this.add.rectangle(spawnX, spawnY, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
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
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.interactKey.on('down', () => this.handleInteract());

    // 가구 드래그
    this.input.on('pointerdown',  (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove',  (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup',    ()                         => this.onPointerUp());
  }

  // ── 씬 전환 ───────────────────────────────────────────────────

  private createExitZone(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;

    const zone = this.add.zone(W / 2, H - TILE_SIZE / 2, TILE_SIZE * 2, TILE_SIZE);
    this.physics.add.existing(zone, true);
    this.physics.add.overlap(this.player, zone, () => {
      if (this.playerBlocked || this.isSleeping) return;
      this.gm.switchMap(SCENE_KEYS.SOUTH_YARD);
    });
  }

  // ── 가구 로딩 ─────────────────────────────────────────────────

  private loadFurniture(): void {
    // GameState에서 이 집 가구 위치 복원, 없으면 기본값 사용
    const saved = this.gm.gameState.furniture.filter(f => f.sceneKey === SCENE_KEY);

    const furnitureData = DEFAULT_FURNITURE.map(def => {
      const found = saved.find(f => f.id === def.id);
      return found ?? { ...def, sceneKey: SCENE_KEY };
    });

    // GameState에 없으면 기본값으로 초기화
    if (saved.length === 0) {
      this.gm.gameState.furniture.push(...furnitureData.map(f => ({ ...f, sceneKey: SCENE_KEY })));
    }

    furnitureData.forEach(f => this.createFurnitureObject(f.id, f.x, f.y));
  }

  private createFurnitureObject(id: string, x: number, y: number): void {
    const configs: Record<string, { w: number; h: number; color: number; label: string }> = {
      bed:  { w: 32, h: 24, color: 0xf0d080, label: '침대' },
      sink: { w: 16, h: 16, color: 0xa0c8e8, label: '세면대' },
    };
    const cfg = configs[id];
    if (!cfg) return;

    const bg = this.add.rectangle(0, 0, cfg.w, cfg.h, cfg.color)
      .setStrokeStyle(1, 0x888888);
    const lbl = this.add.text(0, 0, cfg.label, {
      fontSize: '8px', color: '#333333',
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, lbl]).setDepth(3);
    container.setSize(cfg.w, cfg.h);
    this.furnitureObjects.set(id, container);
  }

  // ── 가구 드래그 ───────────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const wx = pointer.worldX;
    const wy = pointer.worldY;

    for (const [id, container] of this.furnitureObjects) {
      const hw = (container.width  || 32) / 2;
      const hh = (container.height || 24) / 2;

      if (wx >= container.x - hw && wx <= container.x + hw &&
          wy >= container.y - hh && wy <= container.y + hh) {
        this.draggingFurniture = id;
        this.dragOffsetX = container.x - wx;
        this.dragOffsetY = container.y - wy;
        container.setDepth(8);
        break;
      }
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.draggingFurniture) return;
    const container = this.furnitureObjects.get(this.draggingFurniture);
    if (!container) return;

    const hw = (container.width  || 32) / 2;
    const hh = (container.height || 24) / 2;

    // 벽 안쪽으로 클램프
    const minX = TILE_SIZE + hw;
    const minY = TILE_SIZE + hh;
    const maxX = MAP_W * TILE_SIZE - TILE_SIZE - hw;
    const maxY = MAP_H * TILE_SIZE - TILE_SIZE - hh;

    container.x = Phaser.Math.Clamp(pointer.worldX + this.dragOffsetX, minX, maxX);
    container.y = Phaser.Math.Clamp(pointer.worldY + this.dragOffsetY, minY, maxY);
  }

  private onPointerUp(): void {
    if (!this.draggingFurniture) return;
    const container = this.furnitureObjects.get(this.draggingFurniture);
    if (container) {
      container.setDepth(3);
      // GameState 가구 위치 업데이트
      this.saveFurniturePosition(this.draggingFurniture, container.x, container.y);
    }
    this.draggingFurniture = null;
  }

  private saveFurniturePosition(id: string, x: number, y: number): void {
    const furniture = this.gm.gameState.furniture;
    const idx = furniture.findIndex(f => f.id === id && f.sceneKey === SCENE_KEY);
    if (idx >= 0) {
      furniture[idx].x = x;
      furniture[idx].y = y;
    } else {
      furniture.push({ id, sceneKey: SCENE_KEY, x, y });
    }
  }

  // ── 상호작용 ──────────────────────────────────────────────────

  private createInteractHint(): void {
    this.interactHint = this.add.text(0, 0, '', {
      fontSize: '10px', color: '#ffffff',
      backgroundColor: '#00000099', padding: { x: 3, y: 2 },
    }).setOrigin(0.5, 1).setDepth(10).setVisible(false).setScrollFactor(0);
  }

  private handleInteract(): void {
    if (this.playerBlocked || this.isSleeping) return;
    if (!this.nearbyFurnitureId) return;

    switch (this.nearbyFurnitureId) {
      case 'bed':  this.startSleepFlow(); break;
      case 'sink': this.doWash();         break;
    }
  }

  // ── 취침 ──────────────────────────────────────────────────────

  private startSleepFlow(): void {
    this.playerBlocked = true;
    this.isSleeping    = true;

    // 취침 확인 UI
    this.showSleepConfirm();
  }

  private showSleepConfirm(): void {
    const cx = this.cameras.main.width  / 2;
    const cy = this.cameras.main.height / 2;

    const bg = this.add.rectangle(cx, cy, 220, 80, 0x1a1a2e, 0.95)
      .setStrokeStyle(1.5, 0xaaaaaa).setDepth(20).setScrollFactor(0);

    const txt = this.add.text(cx, cy - 16, '취침할까요?', {
      fontSize: '14px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    const yesBtn = this.add.text(cx - 40, cy + 14, '[예]', {
      fontSize: '13px', color: '#aaffaa',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    const noBtn = this.add.text(cx + 40, cy + 14, '[아니오]', {
      fontSize: '13px', color: '#ffaaaa',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    const cleanup = () => { bg.destroy(); txt.destroy(); yesBtn.destroy(); noBtn.destroy(); };

    yesBtn.on('pointerdown', () => {
      cleanup();
      this.executeSleep();
    });

    noBtn.on('pointerdown', () => {
      cleanup();
      this.playerBlocked = false;
      this.isSleeping    = false;
    });
  }

  private async executeSleep(): Promise<void> {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);

    // 취침 시각 기록
    this.gm.energySystem.recordSleepHour(this.gm.timeSystem.getHour());

    // 취침 연출: 플레이어 페이드아웃
    await new Promise<void>(resolve => {
      this.tweens.add({
        targets:  this.player,
        alpha:    0,
        duration: 600,
        ease:     'Power2',
        onComplete: () => resolve(),
      });
    });

    // HUD 페이드아웃
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    await new Promise<void>(resolve => {
      hud?.fadeOut?.(() => resolve()) ?? resolve();
    });

    // 저장 (실패해도 취침 진행)
    const snapshot  = this.gm.buildSnapshot();
    const saveResult = await this.gm.saveSystem.save(snapshot);
    if (!saveResult.success) {
      console.warn('[SouthHouseScene] 저장 실패:', saveResult.reason);
      // HUD 토스트 알림
      const hudScene = this.scene.get(SCENE_KEYS.HUD) as any;
      hudScene?.showToast?.(`저장 실패: ${saveResult.reason}`, 'warn');
    }

    // 취침 처리 (TimeSystem → slept 이벤트 → EnergySystem 회복)
    this.gm.timeSystem.sleep(false);

    // 플레이어 복귀
    this.player.setAlpha(1);
    this.playerBlocked = false;
    this.isSleeping    = false;

    // HUD 페이드인
    hud?.fadeIn?.();

    console.log('[SouthHouseScene] 취침 완료');
  }

  // ── 씻기 ──────────────────────────────────────────────────────

  private doWash(): void {
    if (this.gm.gameState.washCount >= WASH_MAX) {
      const hud = this.scene.get(SCENE_KEYS.HUD) as any;
      hud?.showToast?.('오늘은 더 이상 씻을 수 없어요.', 'info');
      return;
    }

    const restoreAmount = Math.floor(this.gm.energySystem.getMax() * WASH_ENERGY_RATIO);
    this.gm.energySystem.restore(restoreAmount);
    this.gm.gameState.washCount++;

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.showToast?.(`개운해요! 기력 +${restoreAmount} (${this.gm.gameState.washCount}/${WASH_MAX})`, 'ok');

    // 씻기 연출: 플레이어 반짝임
    this.tweens.add({
      targets:  this.player,
      alpha:    0.3,
      duration: 100,
      yoyo:     true,
      repeat:   3,
    });
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(): void {
    this.handleMovement();
    this.checkNearbyFurniture();
  }

  private handleMovement(): void {
    if (this.playerBlocked || this.isSleeping || this.draggingFurniture) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0, vy = 0;

    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  PLAYER_SPEED;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -PLAYER_SPEED;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  PLAYER_SPEED;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    body.setVelocity(vx, vy);
  }

  private checkNearbyFurniture(): void {
    let found: string | null = null;

    for (const [id, container] of this.furnitureObjects) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        container.x, container.y
      );
      if (dist < INTERACT_RANGE) { found = id; break; }
    }

    this.nearbyFurnitureId = found;

    if (found) {
      const container  = this.furnitureObjects.get(found)!;
      const cam        = this.cameras.main;
      const sx         = (container.x - cam.scrollX);
      const sy         = (container.y - cam.scrollY) - 20;
      const hints: Record<string, string> = {
        bed:  '[E] 취침',
        sink: '[E] 씻기',
      };
      this.interactHint
        .setText(hints[found] ?? '[E] 상호작용')
        .setPosition(sx, sy)
        .setVisible(true);
    } else {
      this.interactHint.setVisible(false);
    }
  }

  // ── wake ──────────────────────────────────────────────────────

  wake(): void {
    this.isSleeping    = false;
    this.playerBlocked = false;
    this.player.setAlpha(1);

    // 가구 위치 재동기화
    this.furnitureObjects.forEach((container, id) => {
      const saved = this.gm.gameState.furniture.find(f => f.id === id && f.sceneKey === SCENE_KEY);
      if (saved) { container.x = saved.x; container.y = saved.y; }
    });

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();
  }
}