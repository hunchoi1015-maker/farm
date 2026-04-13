// ================================================================
// ShopScene — 상점 씬
// ================================================================
//
// NPC:
//   상인 → 씨앗 구매 / 작물·물고기 판매
//   한의사 → 산삼·더덕 판매
//
// UI:
//   상인 NPC E키 → 좌: 씨앗 구매 목록 / 우: 인벤토리 판매 목록
//   한의사 NPC E키 → 산삼·더덕만 필터된 판매 목록
//   씨앗 목록은 현재 계절 씨앗만 표시
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import { SEED_SHOP_ITEMS, SELL_PRICES } from '../data/economy';
import type { InventoryItem } from '../types';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE    = 16;
const MAP_W        = 24;
const MAP_H        = 20;
const PLAYER_SPEED = 120;
const INTERACT_RANGE = TILE_SIZE * 2.5;

// 한의사가 구매하는 아이템
const DOCTOR_ITEMS = ['ginseng', 'deodeok'];

// ── ShopScene ────────────────────────────────────────────────────

export class ShopScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // 플레이어
  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private _fromScene?: string;
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;

  // NPC
  private merchantSprite!: Phaser.GameObjects.Rectangle;
  private doctorSprite!:   Phaser.GameObjects.Rectangle;

  // 상호작용
  private interactKey!:    Phaser.Input.Keyboard.Key;
  private nearbyNpcId:     string | null = null;
  private interactHint!:   Phaser.GameObjects.Text;

  // UI
  private shopUI: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: SCENE_KEYS.SHOP });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(data?: { from?: string }): void {
    this.gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromScene = data?.from;

    this.buildBackground();
    this.buildWallCollision();
    this.createPlayer(this._fromScene);
    this.setupCamera();
    this.setupInput();
    this.createExitZone();
    this.createNPCs();
    this.createInteractHint();

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();

    console.log('[ShopScene] 생성 완료');
  }

  // ── 배경 ──────────────────────────────────────────────────────

  private buildBackground(): void {
    const W   = MAP_W * TILE_SIZE;
    const H   = MAP_H * TILE_SIZE;
    const gfx = this.add.graphics().setDepth(0);

    // 바닥
    gfx.fillStyle(0xc8a878); gfx.fillRect(0, 0, W, H);

    // 벽
    gfx.fillStyle(0x7a5c30);
    gfx.fillRect(0, 0, W, TILE_SIZE);
    gfx.fillRect(0, 0, TILE_SIZE, H);
    gfx.fillRect(W - TILE_SIZE, 0, TILE_SIZE, H);
    gfx.fillRect(0, H - TILE_SIZE, W, TILE_SIZE);

    // 출구 (하단 중앙)
    gfx.fillStyle(0x3d2000);
    gfx.fillRect(W / 2 - TILE_SIZE, H - TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);

    // 진열대 (상단)
    gfx.fillStyle(0x9b7040);
    gfx.fillRect(TILE_SIZE * 2, TILE_SIZE * 2, W - TILE_SIZE * 4, TILE_SIZE * 3);

    // 라벨
    this.add.text(W / 2, TILE_SIZE * 3 + 4, '씨앗 상점', {
      fontSize: '11px', color: '#fff8dc', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(2);

    this.add.text(W / 2, TILE_SIZE + 4, '상점', {
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

  private getSpawnPos(from?: string): { x: number; y: number } {
    return { x: MAP_W / 2 * TILE_SIZE, y: (MAP_H - 3) * TILE_SIZE };
  }

  private createPlayer(from?: string): void {
    const { x: spawnX, y: spawnY } = this.getSpawnPos(from);

    this.player = this.add.rectangle(spawnX, spawnY, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);
    (this.player.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(false);
    this.physics.add.collider(this.player, this.wallGroup);
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

  private createExitZone(): void {
    const W = MAP_W * TILE_SIZE;
    const H = MAP_H * TILE_SIZE;
    const zone = this.add.zone(W / 2, H - TILE_SIZE / 2, TILE_SIZE * 2, TILE_SIZE);
    this.physics.add.existing(zone, true);
    this.physics.add.overlap(this.player, zone, () => {
      if (this.playerBlocked) return;
      this.closeShopUI();
      this.gm.switchMap(SCENE_KEYS.VILLAGE);
    });
  }

  // ── NPC 배치 ──────────────────────────────────────────────────

  private createNPCs(): void {
    const W = MAP_W * TILE_SIZE;
    const T = TILE_SIZE;

    // 상인 (좌측)
    this.merchantSprite = this.add.rectangle(W / 3, T * 6, 12, 14, 0xa0c8e8).setDepth(5);
    this.add.text(W / 3, T * 6 - 14, '상인', {
      fontSize: '9px', color: '#fff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1).setDepth(6);

    // 한의사 (우측)
    this.doctorSprite = this.add.rectangle(W * 2 / 3, T * 6, 12, 14, 0xe8a0c8).setDepth(5);
    this.add.text(W * 2 / 3, T * 6 - 14, '한의사', {
      fontSize: '9px', color: '#fff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1).setDepth(6);
  }

  // ── 상호작용 ──────────────────────────────────────────────────

  private createInteractHint(): void {
    this.interactHint = this.add.text(0, 0, '', {
      fontSize: '10px', color: '#ffffff',
      backgroundColor: '#00000099', padding: { x: 3, y: 2 },
    }).setOrigin(0.5, 1).setDepth(10).setVisible(false).setScrollFactor(0);
  }

  private handleInteract(): void {
    // UI 열려있으면 E키로 닫기
    if (this.shopUI) {
      this.closeShopUI();
      return;
    }
    if (this.playerBlocked) return;
    if (!this.nearbyNpcId) return;

    if (this.nearbyNpcId === 'merchant') this.openMerchantUI();
    if (this.nearbyNpcId === 'doctor')   this.openDoctorUI();
  }

  // ── 상인 UI ───────────────────────────────────────────────────

  private openMerchantUI(): void {
    this.playerBlocked = true;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

    const season  = this.gm.timeSystem.getSeason();
    const seeds   = SEED_SHOP_ITEMS.filter(s => s.season === season || s.season === 'all');
    const gold    = this.gm.economySystem.getGold();

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    // ── 배경 패널 ──────────────────────────────────────────────
    const bg = this.add.rectangle(W / 2, H / 2, W - 40, H - 60, 0x1a1a2e, 0.96)
      .setStrokeStyle(1.5, 0x888888).setDepth(20).setScrollFactor(0);

    const title = this.add.text(W / 2, 40, '상점', {
      fontSize: '16px', color: '#f9c74f', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    const goldTxt = this.add.text(W - 30, 40, `골드: ${gold}G`, {
      fontSize: '12px', color: '#f9c74f',
    }).setOrigin(1, 0.5).setDepth(21).setScrollFactor(0);

    const closeTxt = this.add.text(W - 30, H - 30, '[E] 닫기', {
      fontSize: '10px', color: '#888888',
    }).setOrigin(1, 1).setDepth(21).setScrollFactor(0);

    // ── 씨앗 구매 (좌측) ───────────────────────────────────────
    const seedTitle = this.add.text(W / 4, 70, `씨앗 구매 (${this.seasonKo(season)})`, {
      fontSize: '12px', color: '#a8d8a8',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    const seedBtns: Phaser.GameObjects.Text[] = [];
    seeds.forEach((seed, i) => {
      const y   = 100 + i * 36;
      const canAfford = this.gm.economySystem.getGold() >= seed.price;

      const row = this.add.text(W / 4, y,
        `${seed.label}  ${seed.price}G  [구매]`,
        {
          fontSize: '12px',
          color: canAfford ? '#ffffff' : '#666666',
          backgroundColor: '#2a2a4a',
          padding: { x: 8, y: 6 },
        }
      ).setOrigin(0.5).setDepth(21).setScrollFactor(0);

      if (canAfford) {
        row.setInteractive({ useHandCursor: true });
        row.on('pointerover',  () => row.setColor('#ffff88'));
        row.on('pointerout',   () => row.setColor('#ffffff'));
        row.on('pointerdown',  () => {
          const ok = this.gm.economySystem.buySeed(seed.seedId);
          if (ok) {
            const hud = this.scene.get(SCENE_KEYS.HUD) as any;
            hud?.showToast?.(`${seed.label} 구매! (-${seed.price}G)`, 'ok');
            this.closeShopUI();
            this.openMerchantUI(); // UI 갱신
          }
        });
      }
      seedBtns.push(row);
    });

    // ── 인벤토리 판매 (우측) ───────────────────────────────────
    const sellTitle = this.add.text(W * 3 / 4, 70, '판매', {
      fontSize: '12px', color: '#f4a261',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    const sellable = this.gm.inventorySystem.getSlots()
      .map((slot, idx) => ({ slot, idx }))
      .filter(({ slot }) => slot && (slot.itemType === 'crop' || slot.itemType === 'fish')
        && slot.condition === 'normal'
        && SELL_PRICES[slot.itemId] !== undefined
      );

    const sellBtns: Phaser.GameObjects.Text[] = [];
    if (sellable.length === 0) {
      sellBtns.push(
        this.add.text(W * 3 / 4, 100, '판매할 아이템 없음', {
          fontSize: '11px', color: '#666666',
        }).setOrigin(0.5).setDepth(21).setScrollFactor(0)
      );
    } else {
      sellable.slice(0, 8).forEach(({ slot, idx }, i) => {
        const y        = 100 + i * 36;
        const price    = this.gm.economySystem.getExpectedSellPrice(slot!.itemId);
        const buffMark = this.gm.economySystem.isMerchantBuffActive() ? '★' : '';

        const row = this.add.text(W * 3 / 4, y,
          `${SELL_PRICES[slot!.itemId]?.itemId ?? slot!.itemId}  ${price}G${buffMark}  [판매]`,
          {
            fontSize: '12px', color: '#ffffff',
            backgroundColor: '#2a2a4a',
            padding: { x: 8, y: 6 },
          }
        ).setOrigin(0.5).setDepth(21).setScrollFactor(0)
          .setInteractive({ useHandCursor: true });

        row.on('pointerover',  () => row.setColor('#ffdd88'));
        row.on('pointerout',   () => row.setColor('#ffffff'));
        row.on('pointerdown',  () => {
          const ok = this.gm.economySystem.sellItem(idx);
          if (ok) {
            const hud = this.scene.get(SCENE_KEYS.HUD) as any;
            hud?.showToast?.(`판매 완료! +${price}G`, 'ok');
            this.closeShopUI();
            this.openMerchantUI();
          }
        });
        sellBtns.push(row);
      });
    }

    // ── 구분선 ─────────────────────────────────────────────────
    const divider = this.add.rectangle(W / 2, H / 2, 2, H - 100, 0x444444)
      .setDepth(21).setScrollFactor(0);

    // ── 컨테이너로 묶기 ────────────────────────────────────────
    this.shopUI = this.add.container(0, 0, [
      bg, title, goldTxt, closeTxt, divider,
      seedTitle, sellTitle,
      ...seedBtns, ...sellBtns,
    ]).setDepth(20);
  }

  // ── 한의사 UI ─────────────────────────────────────────────────

  private openDoctorUI(): void {
    this.playerBlocked = true;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    const bg = this.add.rectangle(W / 2, H / 2, 300, 260, 0x1a1a2e, 0.96)
      .setStrokeStyle(1.5, 0xe8a0c8).setDepth(20).setScrollFactor(0);

    const title = this.add.text(W / 2, H / 2 - 100, '한의사 — 약초 판매', {
      fontSize: '13px', color: '#e8a0c8', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    const doctorItems = this.gm.inventorySystem.getSlots()
      .map((slot, idx) => ({ slot, idx }))
      .filter(({ slot }) => slot && DOCTOR_ITEMS.includes(slot.itemId));

    const rows: Phaser.GameObjects.Text[] = [];
    if (doctorItems.length === 0) {
      rows.push(
        this.add.text(W / 2, H / 2, '판매할 약초가 없어요.', {
          fontSize: '11px', color: '#888888',
        }).setOrigin(0.5).setDepth(21).setScrollFactor(0)
      );
    } else {
      doctorItems.forEach(({ slot, idx }, i) => {
        const y     = H / 2 - 50 + i * 40;
        const price = this.gm.economySystem.getExpectedSellPrice(slot!.itemId);

        const row = this.add.text(W / 2, y,
          `${slot!.itemId}  ${price}G  [판매]`,
          {
            fontSize: '12px', color: '#ffffff',
            backgroundColor: '#2a2a4a',
            padding: { x: 8, y: 6 },
          }
        ).setOrigin(0.5).setDepth(21).setScrollFactor(0)
          .setInteractive({ useHandCursor: true });

        row.on('pointerdown', () => {
          const ok = this.gm.economySystem.sellItem(idx);
          if (ok) {
            const hud = this.scene.get(SCENE_KEYS.HUD) as any;
            hud?.showToast?.(`판매 완료! +${price}G`, 'ok');
            this.closeShopUI();
            this.openDoctorUI();
          }
        });
        rows.push(row);
      });
    }

    const closeTxt = this.add.text(W / 2, H / 2 + 110, '[E] 닫기', {
      fontSize: '10px', color: '#888888',
    }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    this.shopUI = this.add.container(0, 0, [bg, title, closeTxt, ...rows]).setDepth(20);
  }

  // ── UI 닫기 ───────────────────────────────────────────────────

  private closeShopUI(): void {
    this.shopUI?.destroy();
    this.shopUI       = null;
    this.playerBlocked = false;
  }

  // ── 유틸 ──────────────────────────────────────────────────────

  private seasonKo(season: string): string {
    return { spring: '봄', summer: '여름', autumn: '가을' }[season] ?? season;
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(): void {
    this.handleMovement();
    this.checkNearbyNPC();
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

  private checkNearbyNPC(): void {
    const distMerchant = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.merchantSprite.x, this.merchantSprite.y
    );
    const distDoctor = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.doctorSprite.x, this.doctorSprite.y
    );

    if (distMerchant < INTERACT_RANGE)      this.nearbyNpcId = 'merchant';
    else if (distDoctor < INTERACT_RANGE)   this.nearbyNpcId = 'doctor';
    else                                    this.nearbyNpcId = null;

    if (this.nearbyNpcId && !this.shopUI) {
      const sprite = this.nearbyNpcId === 'merchant'
        ? this.merchantSprite : this.doctorSprite;
      const cam = this.cameras.main;
      this.interactHint
        .setText('[E] 상점 열기')
        .setPosition(sprite.x - cam.scrollX, sprite.y - cam.scrollY - 20)
        .setVisible(true);
    } else {
      this.interactHint.setVisible(false);
    }
  }

  // ── wake ──────────────────────────────────────────────────────

  wake(): void {
    this.closeShopUI();
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();
  }
}