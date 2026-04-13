// ================================================================
// LibraryScene — 도서관(폐교) 씬
// ================================================================
//
// 도서관 단계:
//   0단계: 폐허 (어두운 색, 먼지 효과)
//   1단계: 외관 복구 (밝은 색)
//   2단계: 내부 활성화 (table 원상복구 + 마지막 편지 등장)
//
// 행동:
//   기증함 (E키) → 미기증 기록물 선택 → 기증
//   중앙 table (E키, 2단계) → 마지막 편지 획득
//
// 씬 전환:
//   출구 → VillageScene (북쪽) or SouthYardScene (남쪽)
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import { RECORD_CONTENT_DATA } from '../data/records';
import type { RecordBookEntry } from '../types';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE    = 16;
const MAP_W        = 24;
const MAP_H        = 20;
const PLAYER_SPEED = 120;
const INTERACT_RANGE = TILE_SIZE * 2.5;

// 단계별 색상
const STAGE_COLORS = {
  0: { floor: 0x5a5040, wall: 0x3a3028, shelf: 0x4a4030, table: 0x4a4030 },
  1: { floor: 0xc8b48a, wall: 0x8b6914, shelf: 0x7a5c30, table: 0x7a5c30 },
  2: { floor: 0xd4b87a, wall: 0x9b7040, shelf: 0x8b6428, table: 0xa07840 },
} as const;

// ── LibraryScene ──────────────────────────────────────────────────

export class LibraryScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // 플레이어
  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private _fromScene?: string;

  // 오브젝트
  private donationBox!:    Phaser.GameObjects.Container;
  private centerTable!:    Phaser.GameObjects.Container;
  private lastLetterObj:   Phaser.GameObjects.Container | null = null;

  // 충돌 그룹
  private obstacleGroup!: Phaser.Physics.Arcade.StaticGroup;

  // 상호작용
  private interactKey!:   Phaser.Input.Keyboard.Key;
  private nearbyObject:   string | null = null;
  private interactHint!:  Phaser.GameObjects.Text;

  // UI
  private activeUI: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: SCENE_KEYS.LIBRARY });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(data?: { from?: string }): void {
    this.gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromScene = data?.from;

    const stage = this.gm.recordSystem.getLibrary().stage as 0 | 1 | 2;

    this.buildBackground(stage);
    this.buildFurniture(stage);
    this.createPlayer();
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    this.createInteractHint();
    this.subscribeEvents();

    // 2단계면 마지막 편지 표시
    if (stage >= 2) this.showLastLetter();

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();

    console.log(`[LibraryScene] 생성 완료 — 단계: ${stage}`);
  }

  // ── 배경 ──────────────────────────────────────────────────────

  private buildBackground(stage: 0 | 1 | 2): void {
    const W   = MAP_W * TILE_SIZE;
    const H   = MAP_H * TILE_SIZE;
    const col = STAGE_COLORS[stage];
    const gfx = this.add.graphics().setDepth(0);

    // 바닥
    gfx.fillStyle(col.floor); gfx.fillRect(0, 0, W, H);

    // 벽
    gfx.fillStyle(col.wall);
    gfx.fillRect(0, 0, W, TILE_SIZE);
    gfx.fillRect(0, 0, TILE_SIZE, H);
    gfx.fillRect(W - TILE_SIZE, 0, TILE_SIZE, H);
    gfx.fillRect(0, H - TILE_SIZE, W, TILE_SIZE);

    // 출구
    gfx.fillStyle(0x1a1000);
    gfx.fillRect(W / 2 - TILE_SIZE, H - TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);

    // 창문 (상단 5개)
    gfx.fillStyle(0x88bbdd);
    for (let i = 0; i < 5; i++) {
      gfx.fillRect(TILE_SIZE * 2 + i * (TILE_SIZE * 4), TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);
    }

    // 0단계: 금 간 효과 (어두운 선)
    if (stage === 0) {
      gfx.lineStyle(1, 0x000000, 0.4);
      gfx.lineBetween(TILE_SIZE * 3, 0, TILE_SIZE * 5, TILE_SIZE * 8);
      gfx.lineBetween(TILE_SIZE * 15, 0, TILE_SIZE * 13, TILE_SIZE * 6);
      gfx.lineBetween(0, TILE_SIZE * 10, TILE_SIZE * 6, TILE_SIZE * 14);

      // 먼지 효과 (작은 점들)
      gfx.fillStyle(0x888878, 0.3);
      for (let i = 0; i < 20; i++) {
        const dx = Phaser.Math.Between(TILE_SIZE * 2, W - TILE_SIZE * 2);
        const dy = Phaser.Math.Between(TILE_SIZE * 2, H - TILE_SIZE * 2);
        gfx.fillCircle(dx, dy, 2);
      }

      this.add.text(W / 2, H / 2 - 20, '폐허가 된 도서관이에요...', {
        fontSize: '11px', color: '#888878',
      }).setOrigin(0.5).setDepth(2);
    }
  }

  // ── 가구 ──────────────────────────────────────────────────────

  private buildFurniture(stage: 0 | 1 | 2): void {
    const T   = TILE_SIZE;
    const W   = MAP_W * T;
    const H   = MAP_H * T;
    const col = STAGE_COLORS[stage];

    this.obstacleGroup = this.physics.add.staticGroup();

    // 벽 충돌 (출구 하단 중앙 제외)
    const addWall = (x: number, y: number, w: number, h: number) => {
      const b = this.add.rectangle(x + w/2, y + h/2, w, h, 0x000000, 0);
      this.physics.add.existing(b, true);
      this.obstacleGroup.add(b);
    };
    addWall(0,            0, W,              T);           // 상단
    addWall(0,            0, T,              H);           // 좌측
    addWall(W - T,        0, T,              H);           // 우측
    addWall(0,       H - T, W/2 - T,        T);           // 하단 좌
    addWall(W/2 + T, H - T, W/2 - T,        T);           // 하단 우 (출구 제외)

    // 책장 위치 (레이아웃 기반)
    const shelves = [
      // 상단 행
      { x: T * 3,       y: T * 3  },
      { x: T * 8,       y: T * 3  },
      { x: T * 15,      y: T * 3  },
      { x: T * 20,      y: T * 3  },
      // 중간 행
      { x: T * 3,       y: T * 9  },
      { x: T * 20,      y: T * 9  },
      // 하단 행
      { x: T * 3,       y: T * 14 },
      { x: T * 20,      y: T * 14 },
    ];

    shelves.forEach(({ x, y }) => {
      this.addFurniture(x + T, y + T * 1.5, T * 2, T * 3, col.shelf, '책장');
    });

    // 중앙 table (2단계: 원상복구, 나머지: 부서진 모습)
    const tableColor = stage >= 2 ? col.table : 0x3a3028;
    const tableLabel = stage >= 2 ? '탁자' : '부서진 탁자';
    this.centerTable = this.addFurniture(
      W / 2, H / 2, T * 6, T * 4, tableColor, tableLabel
    );

    // 좌하단 desk (항상 먼지 쌓인 모습)
    this.donationBox = this.addFurniture(
      T * 3, H - T * 4, T * 4, T * 3, 0x6a5030, '기증함'
    );
    this.add.text(T * 3, H - T * 4 - T * 1.5 - 4, '[기록물 기증]', {
      fontSize: '8px', color: '#f9c74f',
    }).setOrigin(0.5).setDepth(3);
  }

  private addFurniture(
    cx: number, cy: number,
    w: number, h: number,
    color: number, label: string
  ): Phaser.GameObjects.Container {
    const rect = this.add.rectangle(0, 0, w, h, color)
      .setStrokeStyle(0.5, 0x000000, 0.4);
    const txt  = this.add.text(0, 0, label, {
      fontSize: '8px', color: '#ffffff88',
    }).setOrigin(0.5);

    const container = this.add.container(cx, cy, [rect, txt]).setDepth(2);
    container.setSize(w, h);

    // 충돌 블록
    const block = this.add.rectangle(cx, cy, w, h, 0x000000, 0).setDepth(0);
    this.physics.add.existing(block, true);
    this.obstacleGroup.add(block);

    return container;
  }

  // ── 마지막 편지 ───────────────────────────────────────────────

  private showLastLetter(): void {
    if (this.gm.recordSystem.getRecords()['last_letter']?.isCollected) return;

    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;

    const glow  = this.add.rectangle(W / 2, H / 2, TILE_SIZE * 2, TILE_SIZE * 2, 0xf9c74f, 0.8)
      .setDepth(4);
    const label = this.add.text(W / 2, H / 2, '✉', {
      fontSize: '14px', color: '#1a1a00',
    }).setOrigin(0.5).setDepth(5);
    const hint  = this.add.text(W / 2, H / 2 - TILE_SIZE * 2, '마지막 편지', {
      fontSize: '9px', color: '#f9c74f',
    }).setOrigin(0.5).setDepth(5);

    // 반짝임 트윈
    this.tweens.add({
      targets:  glow,
      alpha:    0.3,
      duration: 800,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   -1,
    });

    this.lastLetterObj = this.add.container(0, 0, [glow, label, hint]).setDepth(4);
  }

  // ── 플레이어 ──────────────────────────────────────────────────

  private createPlayer(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;

    this.player = this.add.rectangle(W / 2, H - TILE_SIZE * 3, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);
    (this.player.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(false);
    this.physics.add.collider(this.player, this.obstacleGroup);
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
  }

  // ── 씬 전환 ───────────────────────────────────────────────────

  private createExitZones(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;

    // 출구 (하단)
    const zone = this.add.zone(W / 2, H - TILE_SIZE / 2, TILE_SIZE * 2, TILE_SIZE);
    this.physics.add.existing(zone, true);
    this.physics.add.overlap(this.player, zone, () => {
      if (this.playerBlocked) return;
      this.closeUI();
      // 남쪽 마당 or 마을로 전환
      const target = this.gm.gameState.houseLocation === 'south'
        ? SCENE_KEYS.SOUTH_YARD
        : SCENE_KEYS.VILLAGE;
      this.gm.switchMap(target);
    });
  }

  // ── 상호작용 ──────────────────────────────────────────────────

  private createInteractHint(): void {
    this.interactHint = this.add.text(0, 0, '', {
      fontSize: '10px', color: '#ffffff',
      backgroundColor: '#00000099', padding: { x: 3, y: 2 },
    }).setOrigin(0.5, 1).setDepth(10).setVisible(false).setScrollFactor(0);
  }

  private handleInteract(): void {
    if (this.activeUI) {
      this.closeUI();
      return;
    }
    if (this.playerBlocked) return;

    switch (this.nearbyObject) {
      case 'donationBox':  this.openDonationUI();  break;
      case 'lastLetter':   this.pickupLastLetter(); break;
    }
  }

  // ── 기증 UI ───────────────────────────────────────────────────

  private openDonationUI(): void {
    this.playerBlocked = true;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

    const W   = this.cameras.main.width;
    const H   = this.cameras.main.height;
    const cx  = W / 2;
    const cy  = H / 2;

    const undoanted = this.gm.recordSystem.getRecordBook()
      .filter(e => !e.isDonated);

    const bg = this.add.rectangle(cx, cy, 360, 300, 0x1a1a2e, 0.96)
      .setStrokeStyle(1.5, 0x888888).setScrollFactor(0).setDepth(20);

    const title = this.add.text(cx, cy - 128, '기록물 기증', {
      fontSize: '14px', color: '#f9c74f', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    const donated  = this.gm.recordSystem.getDonatedCount();
    const progress = this.add.text(cx, cy - 108, `기증 현황: ${donated} / 10`, {
      fontSize: '11px', color: '#a8d8a8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    const rows: Phaser.GameObjects.GameObject[] = [];

    if (undoanted.length === 0) {
      rows.push(
        this.add.text(cx, cy, '기증할 기록물이 없어요.\n도감에서 기록물을 수집해보세요.', {
          fontSize: '11px', color: '#666666', align: 'center', lineSpacing: 6,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(21)
      );
    } else {
      undoanted.slice(0, 6).forEach((entry, i) => {
        const y    = cy - 70 + i * 36;
        const data = RECORD_CONTENT_DATA[entry.contentId];
        const icon = entry.containerType === 'book' ? '📖' : '🍶';

        const row = this.add.text(cx, y,
          `${icon} ${data?.label ?? entry.contentId}  [기증]`,
          {
            fontSize: '12px', color: '#ffffff',
            backgroundColor: '#2a2a4a',
            padding: { x: 8, y: 6 },
          }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(21)
          .setInteractive({ useHandCursor: true });

        row.on('pointerover', () => row.setColor('#f9c74f'));
        row.on('pointerout',  () => row.setColor('#ffffff'));
        row.on('pointerdown', () => {
          this.gm.recordSystem.donateRecord(entry.contentId);
          const hud = this.scene.get(SCENE_KEYS.HUD) as any;
          hud?.showToast?.(`"${data?.label}" 기증 완료!`, 'ok');
          this.closeUI();
          this.openDonationUI();  // UI 갱신
        });

        rows.push(row);
      });
    }

    const closeTxt = this.add.text(cx, cy + 128, '[E] 닫기', {
      fontSize: '10px', color: '#888888',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.activeUI = this.add.container(0, 0, [
      bg, title, progress, closeTxt, ...rows,
    ]).setDepth(20);
  }

  // ── 마지막 편지 획득 ──────────────────────────────────────────

  private pickupLastLetter(): void {
    const ok = this.gm.recordSystem.unlockLastLetter();
    if (!ok) return;

    // 반짝임 이펙트 후 제거
    if (this.lastLetterObj) {
      this.tweens.add({
        targets:  this.lastLetterObj,
        alpha:    0,
        duration: 400,
        onComplete: () => {
          this.lastLetterObj?.destroy();
          this.lastLetterObj = null;
        },
      });
    }

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.showToast?.('마지막 편지를 획득했어요!', 'ok');
    console.log('[LibraryScene] 마지막 편지 획득');
  }

  // ── UI 닫기 ───────────────────────────────────────────────────

  private closeUI(): void {
    this.activeUI?.destroy();
    this.activeUI     = null;
    this.playerBlocked = false;
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    // 도서관 단계 업그레이드
    this.gm.recordSystem.on('libraryStageUp', (stage: 1 | 2) => {
      // 씬을 다시 그려서 시각적 변화 반영
      this.rebuildForStage(stage);
    });
  }

  private rebuildForStage(stage: 1 | 2): void {
    // 간단하게 씬 재시작으로 처리 (sleep → wake 사이클)
    console.log(`[LibraryScene] ${stage}단계 도달 → 시각 갱신`);
    if (stage === 2) this.showLastLetter();
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(): void {
    this.handleMovement();
    this.checkNearbyObject();
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

  private checkNearbyObject(): void {
    let found: string | null = null;
    const stage = this.gm.recordSystem.getLibrary().stage;

    // 기증함 거리 체크
    const distDonation = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.donationBox.x, this.donationBox.y
    );
    if (distDonation < INTERACT_RANGE) found = 'donationBox';

    // 마지막 편지 (2단계, 미수집)
    if (stage >= 2 && this.lastLetterObj && !found) {
      const W = MAP_W * TILE_SIZE;
      const H = MAP_H * TILE_SIZE;
      const distLetter = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, W / 2, H / 2
      );
      if (distLetter < INTERACT_RANGE) found = 'lastLetter';
    }

    this.nearbyObject = found;

    if (found && !this.activeUI) {
      const hints: Record<string, string> = {
        donationBox: '[E] 기록물 기증',
        lastLetter:  '[E] 마지막 편지 획득',
      };
      const cam = this.cameras.main;
      const obj = found === 'donationBox' ? this.donationBox : this.centerTable;
      this.interactHint
        .setText(hints[found])
        .setPosition(obj.x - cam.scrollX, obj.y - cam.scrollY - 30)
        .setVisible(true);
    } else {
      this.interactHint.setVisible(false);
    }
  }

  // ── wake ──────────────────────────────────────────────────────

  wake(): void {
    this.closeUI();
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();
  }
}