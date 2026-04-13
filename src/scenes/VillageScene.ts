// ================================================================
// VillageScene — 마을 씬 (임시 타일맵 버전)
// ================================================================
//
// 임시 타일맵: createBlankTilemap() + 색상 구역으로 구현
// 나중에 Tiled JSON 맵으로 교체 시 타일맵 로딩 부분만 수정하면 됨
//
// 구역:
//   초록(0x4a7c59) = 땅
//   파랑(0x2255aa) = 강 (충돌)
//   회색(0x888888) = 다리/건물
//   진초록(0x2d5a27) = 나무 (충돌)
//
// 씬 전환 포인트: 경계 Zone으로 감지
// NPC: 고정 위치 + 상호작용 키(E)
// 이장: 시간대별 웨이포인트 이동
// 돌다리: 비 오는 날 40% 확률 빠짐 → 도리도리 연출 → 기력 소모
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import { getMayorLocation } from '../data/npcs';
import type { NpcId } from '../data/npcs';
import { SceneTransition } from '../ui/SceneTransition';
import { portalKey } from '../data/portals';

// ── 상수 ────────────────────────────────────────────────────────

const TILE_SIZE   = 16;
const MAP_W       = 80;   // 타일 수
const MAP_H       = 60;
const PLAYER_SPEED = 120;

// 돌다리 관련
const STONE_BRIDGE_FALL_CHANCE  = 0.4;
const FALL_ENERGY_COST_PER_SEC  = 5;
const FALL_DURATION_MS          = 1200;

// 씬 전환 존 정의
interface ExitZone {
  name: string;
  x: number; y: number;
  w: number; h: number;
  targetScene: string;
}

// NPC 정의
interface NpcConfig {
  id: string;
  label: string;
  tileX: number;
  tileY: number;
  color: number;
}

// ── VillageScene ──────────────────────────────────────────────────

export class VillageScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // 충돌 그룹 (타일맵 대신 StaticGroup 사용)
  private waterGroup!:    Phaser.Physics.Arcade.StaticGroup;
  private buildingGroup!: Phaser.Physics.Arcade.StaticGroup;

  // 플레이어
  private player!:       Phaser.GameObjects.Rectangle;
  private cursors!:      Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:         Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked  = false;  // 빠짐 연출 중 이동 차단

  // NPC
  private npcSprites:    Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private npcLabels:     Map<string, Phaser.GameObjects.Text>      = new Map();
  private mayorSprite!:  Phaser.GameObjects.Rectangle;
  private mayorLabel!:   Phaser.GameObjects.Text;
  private mayorWaypoints: Phaser.Math.Vector2[] = [];
  private mayorTween?:   Phaser.Tweens.Tween;

  // 상호작용
  private interactKey!:  Phaser.Input.Keyboard.Key;
  private nearbyNpcId:   string | null = null;
  private interactHint!: Phaser.GameObjects.Text;

  // 돌다리
  private stoneBridgeZones: Phaser.GameObjects.Zone[] = [];
  private isFalling          = false;
  private _fromScene?: string;
  private _fromData?: { from?: string; coord?: number; axis?: string };
  private fallEnergyTimer?:  Phaser.Time.TimerEvent;

  // 씬 전환
  private exitZones: Phaser.GameObjects.Zone[] = [];
  private transition!: SceneTransition;

  constructor() {
    super({ key: SCENE_KEYS.VILLAGE });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(data?: { from?: string; coord?: number; axis?: string }): void {
    this.gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromScene = data?.from;
    this._fromData  = data;

    this.buildTilemap();
    this.createPlayer(this._fromData);
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    this.createNPCs();
    this.createStoneBridgeZones();
    this.createInteractHint();
    this.subscribeEvents();
    this.registerFishing();


    // 페이드인
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();

    console.log('[VillageScene] 생성 완료');
  }

  // ── 임시 맵 (Graphics + StaticGroup) ────────────────────────────

  private buildTilemap(): void {
    const T    = TILE_SIZE;
    const pw   = MAP_W * T;
    const ph   = MAP_H * T;
    const gfx  = this.add.graphics().setDepth(0);

    // ── 배경 (땅) ───────────────────────────────────────────────
    gfx.fillStyle(0x4a7c59); gfx.fillRect(0, 0, pw, ph);

    // ── 강 (y=28~32) ────────────────────────────────────────────
    gfx.fillStyle(0x2255aa);
    gfx.fillRect(0, 28 * T, pw, 4 * T);

    // ── 다리 ────────────────────────────────────────────────────
    gfx.fillStyle(0x888888);  // 콘크리트
    gfx.fillRect(20 * T, 28 * T, 6 * T, 4 * T);
    gfx.fillStyle(0x778899);  // 돌다리
    gfx.fillRect(50 * T, 28 * T, 6 * T, 4 * T);
    this.add.text(50 * T + 4, 28 * T + 4, '돌다리', { fontSize: '10px', color: '#fff' }).setDepth(1);

    // ── 건물 ────────────────────────────────────────────────────
    gfx.fillStyle(0xb8a090);
    [[60,15,6,5],[10,40,8,8],[30,40,8,8],[55,40,6,6],[10,15,6,5]].forEach(([x,y,w,h]) => {
      gfx.fillRect(x*T, y*T, w*T, h*T);
    });

    const labels = [[60,15,'상점'],[10,40,'도서관'],[30,40,'박물관'],[55,40,'대장간'],[10,15,'한의원']];
    labels.forEach(([x,y,name]) => {
      this.add.text(Number(x)*T+4, Number(y)*T+4, String(name), { fontSize:'10px', color:'#3d2b1f' }).setDepth(1);
    });

    // ── 북쪽 마당 입구 표시 ─────────────────────────────────────
    gfx.fillStyle(0x8b7355);  // 갈색 통로
    gfx.fillRect(30*T, 4*T, 6*T, 2*T);
    this.add.text(33*T, 4*T+4, '북쪽\n마당', {
      fontSize: '8px', color: '#fff8dc', align: 'center',
    }).setOrigin(0.5, 0).setDepth(1);

    // ── 충돌 그룹 생성 ──────────────────────────────────────────
    this.waterGroup    = this.physics.add.staticGroup();
    this.buildingGroup = this.physics.add.staticGroup();

    // 강 충돌 (다리 구간 제외)
    // 서쪽 (x=0~20)
    this.addStaticBlock(this.waterGroup, 0, 28*T, 20*T, 4*T);
    // 두 다리 사이 (x=26~50)
    this.addStaticBlock(this.waterGroup, 26*T, 28*T, 24*T, 4*T);
    // 동쪽 (x=56~80)
    this.addStaticBlock(this.waterGroup, 56*T, 28*T, (MAP_W-56)*T, 4*T);

    // 건물 충돌
    [[60,15,6,5],[10,40,8,8],[30,40,8,8],[55,40,6,6],[10,15,6,5]].forEach(([x,y,w,h]) => {
      this.addStaticBlock(this.buildingGroup, x*T, y*T, w*T, h*T);
    });
  }

  /**
   * 충돌용 투명 StaticBody 블록 추가.
   * Tiled 맵으로 교체 시 이 메서드 제거.
   */
  private addStaticBlock(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number, y: number, w: number, h: number
  ): void {
    const obj = this.add.rectangle(x + w/2, y + h/2, w, h, 0x000000, 0).setDepth(0);
    this.physics.add.existing(obj, true);
    group.add(obj);
  }

  // ── 플레이어 ──────────────────────────────────────────────────

  private getSpawnPos(data?: { from?: string; coord?: number; axis?: string }): { x: number; y: number } {
    const W = 80 * TILE_SIZE;
    const H = 60 * TILE_SIZE;

    // SceneTransition이 계산한 좌표 우선 사용
    if (data?.from && data.coord !== undefined && data.coord >= 0) {
      return SceneTransition.calcSpawn(data, data.from, { x: W/2, y: H/2 });
    }

    switch (data?.from) {
      case 'mountain':    return { x: W / 2,           y: 4 * TILE_SIZE };
      case 'tidal_flat':  return { x: 4 * TILE_SIZE,   y: H / 2 };
      case 'beach':       return { x: W - 4*TILE_SIZE,  y: H / 2 };
      case 'north_yard':  return { x: 34 * TILE_SIZE,  y: 6 * TILE_SIZE };
      case 'south_yard':  return { x: 34 * TILE_SIZE,  y: H - 8*TILE_SIZE };
      case 'shop':        return { x: 65 * TILE_SIZE,  y: 16 * TILE_SIZE };
      case 'library':     return { x: 15 * TILE_SIZE,  y: 38 * TILE_SIZE };
      default:            return { x: 40 * TILE_SIZE,  y: 20 * TILE_SIZE };
    }
  }

  private createPlayer(data?: { from?: string; coord?: number; axis?: string }): void {
    const { x: spawnX, y: spawnY } = this.getSpawnPos(data);

    // 임시: 초록 사각형으로 표시
    this.player = this.add.rectangle(spawnX, spawnY, 12, 14, 0x00cc66)
      .setDepth(5);

    // 물리 바디 추가
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);

    // StaticGroup 충돌
    this.physics.add.collider(this.player, this.waterGroup);
    this.physics.add.collider(this.player, this.buildingGroup);
  }

  // ── 카메라 ────────────────────────────────────────────────────

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
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.interactKey.on('down', () => this.handleInteract());

    // 우클릭 → 낚시 시도
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 2) return;
      if (this.playerBlocked || this.isFalling) return;
      const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
      const quickSlots  = this.gm.inventorySystem.getQuickSlots();
      const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;
      if (tool?.type === 'fishingRod') this.handleFishing();
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
    hud?.getFishingUI?.()?.setRodPosition(this.player.x, this.player.y - 8);
    this.playerBlocked = true;
    fs.startCharging();
  }

  // ── 씬 전환 존 ────────────────────────────────────────────────

  private createExitZones(): void {
    const T = TILE_SIZE;
    this.transition = new SceneTransition(this, this.gm);
    this.transition.setPlayer(this.player);

    const blocked = () => this.playerBlocked || this.isFalling;

    // 포털 정의에 맞춘 통로 크기
    const portals = [
      // 북쪽 경계 → 산 (x=42~52, 마을 중앙에서 동쪽)
      { fromKey: 'village', toKey: 'mountain',    target: SCENE_KEYS.MOUNTAIN,
        x: T*42, y: 0,          w: T*10, h: T*2, dir: 'up'    as const },
      // 서쪽 경계 → 갯벌
      { fromKey: 'village', toKey: 'tidal_flat',  target: SCENE_KEYS.TIDAL_FLAT,
        x: 0,    y: T*25,       w: T*2,  h: T*10, dir: 'left'  as const },
      // 동쪽 경계 → 바다
      { fromKey: 'village', toKey: 'beach',       target: SCENE_KEYS.BEACH,
        x: T*80-T*2, y: T*25,  w: T*2,  h: T*10, dir: 'right' as const },
      // 북쪽 마당 입구 (마을 북서쪽, y=5 라인에 별도 입구)
      { fromKey: 'village', toKey: 'north_yard',  target: SCENE_KEYS.NORTH_YARD,
        x: T*30, y: T*5,        w: T*6,  h: T*2, dir: 'up'    as const },
      // 남쪽 마당 입구 (마을 남쪽 경계)
      { fromKey: 'village', toKey: 'south_yard',  target: SCENE_KEYS.SOUTH_YARD,
        x: T*30, y: T*60-T*2,  w: T*6,  h: T*2, dir: 'down'  as const },
      // 상점 입구
      { fromKey: 'village', toKey: 'shop',        target: SCENE_KEYS.SHOP,
        x: T*63, y: T*14,       w: T*4,  h: T*2, dir: 'up'    as const },
      // 도서관 입구
      { fromKey: 'village', toKey: 'library',     target: SCENE_KEYS.LIBRARY,
        x: T*13, y: T*39,       w: T*4,  h: T*2, dir: 'down'  as const },
    ];

    portals.forEach(p => {
      this.transition.addPortal({
        fromKey: p.fromKey, toKey: p.toKey,
        targetScene: p.target,
        zoneX: p.x, zoneY: p.y, zoneW: p.w, zoneH: p.h,
        direction: p.dir,
        isBlocked: blocked,
      });
    });

    // 통로 시각 표시
    const hintGfx = this.add.graphics().setDepth(1);
    portals.forEach(p => {
      SceneTransition.drawPortalHint(hintGfx, portalKey(p.fromKey, p.toKey));
    });
  }

  // ── NPC ───────────────────────────────────────────────────────

  private createNPCs(): void {
    const T = TILE_SIZE;

    const npcs: NpcConfig[] = [
      { id: 'farmer',     label: '농부',    tileX: 35, tileY: 15, color: 0xc8a96e },
      { id: 'merchant',   label: '상인',    tileX: 62, tileY: 17, color: 0xa0c8e8 },
      { id: 'blacksmith', label: '대장장이', tileX: 57, tileY: 42, color: 0x888888 },
      { id: 'doctor',     label: '한의사',  tileX: 12, tileY: 17, color: 0xe8a0c8 },
    ];

    npcs.forEach(cfg => {
      const x = cfg.tileX * T + T / 2;
      const y = cfg.tileY * T + T / 2;

      const sprite = this.add.rectangle(x, y, 12, 14, cfg.color).setDepth(5);
      const label  = this.add.text(x, y - 14, cfg.label, {
        fontSize: '9px', color: '#ffffff',
        backgroundColor: '#00000088', padding: { x: 2, y: 1 },
      }).setOrigin(0.5, 1).setDepth(6);

      this.physics.add.existing(sprite, true);
      this.npcSprites.set(cfg.id, sprite);
      this.npcLabels.set(cfg.id, label);
    });

    // 이장 (이동 NPC)
    this.createMayor();
  }

  private createMayor(): void {
    const T = TILE_SIZE;
    const spawnX = 40 * T;
    const spawnY = 25 * T;

    this.mayorSprite = this.add.rectangle(spawnX, spawnY, 12, 14, 0xe8c880).setDepth(5);
    this.mayorLabel  = this.add.text(spawnX, spawnY - 14, '이장', {
      fontSize: '9px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1).setDepth(6);

    // 물리 바디 추가 → 충돌 처리됨
    this.physics.add.existing(this.mayorSprite);
    const body = this.mayorSprite.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);

    // 강·건물 충돌
    this.physics.add.collider(this.mayorSprite, this.waterGroup);
    this.physics.add.collider(this.mayorSprite, this.buildingGroup);

    // 강에 막히면 다음 웨이포인트로 (충돌 시 재탐색)
    this.physics.add.collider(this.mayorSprite, this.waterGroup, () => {
      this.pickNextWaypoint();
    });

    // 마을 내 웨이포인트 — 강 북쪽(y<28*T)과 남쪽(y>32*T) 구역으로 분리
    const northWaypoints = [
      new Phaser.Math.Vector2(35 * T, 22 * T),
      new Phaser.Math.Vector2(45 * T, 25 * T),
      new Phaser.Math.Vector2(42 * T, 20 * T),
      new Phaser.Math.Vector2(30 * T, 18 * T),
    ];
    const southWaypoints = [
      new Phaser.Math.Vector2(38 * T, 36 * T),
      new Phaser.Math.Vector2(25 * T, 38 * T),
      new Phaser.Math.Vector2(42 * T, 34 * T),
    ];

    // 스폰 위치가 북쪽이므로 북쪽 웨이포인트만 초기 사용
    this.mayorWaypoints = northWaypoints;

    this.startMayorPatrol();
  }

  private mayorCurrentWp: Phaser.Math.Vector2 | null = null;
  private mayorPatrolTimer?: Phaser.Time.TimerEvent;
  private readonly MAYOR_SPEED = 40;
  private readonly MAYOR_REACH_DIST = 8; // 웨이포인트 도달 판정 거리

  private startMayorPatrol(): void {
    if (this.mayorTween) { this.mayorTween.stop(); this.mayorTween = undefined; }

    const location = getMayorLocation(
      this.gm.timeSystem.getHour(),
      this.gm.timeSystem.getTotalDays()
    );

    const isInVillage = location === 'village' || location === 'mayor_home';
    this.mayorSprite.setVisible(isInVillage);
    this.mayorLabel.setVisible(isInVillage);

    const body = this.mayorSprite.body as Phaser.Physics.Arcade.Body;
    if (!isInVillage) {
      body.setVelocity(0, 0);
      return;
    }

    this.pickNextWaypoint();
  }

  private pickNextWaypoint(): void {
    this.mayorCurrentWp = Phaser.Utils.Array.GetRandom(this.mayorWaypoints);
    const body = this.mayorSprite.body as Phaser.Physics.Arcade.Body;

    // 현재 위치 → 목표 웨이포인트 방향으로 velocity 설정
    const angle = Phaser.Math.Angle.Between(
      this.mayorSprite.x, this.mayorSprite.y,
      this.mayorCurrentWp.x, this.mayorCurrentWp.y
    );
    body.setVelocity(
      Math.cos(angle) * this.MAYOR_SPEED,
      Math.sin(angle) * this.MAYOR_SPEED
    );
  }

  // ── 돌다리 빠짐 ───────────────────────────────────────────────

  private createStoneBridgeZones(): void {
    const T  = TILE_SIZE;
    // 돌다리 영역 (x=50~56, y=28~32)
    for (let tx = 50; tx < 56; tx++) {
      for (let ty = 28; ty < 32; ty++) {
        const zone = this.add.zone(
          tx * T + T / 2,
          ty * T + T / 2,
          T, T
        );
        this.physics.add.existing(zone, true);
        this.physics.add.overlap(this.player, zone, () => {
          this.checkStoneBridgeFall();
        });
        this.stoneBridgeZones.push(zone);
      }
    }
  }

  private checkStoneBridgeFall(): void {
    if (this.isFalling) return;
    if (this.playerBlocked) return;
    if (!this.gm.weatherSystem.isRaining()) return;

    if (Math.random() < STONE_BRIDGE_FALL_CHANCE) {
      this.triggerFall();
    }
  }

  private triggerFall(): void {
    if (this.isFalling) return;
    this.isFalling      = true;
    this.playerBlocked  = true;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);

    // 1. 물에 빠지는 연출 (플레이어 파란색 + 크기 축소)
    this.tweens.add({
      targets:  this.player,
      scaleY:   0.3,
      fillColor: 0x2255aa,
      duration: 300,
      ease:     'Power2',
      onComplete: () => {
        // 기력 소모 시작 (빠진 동안)
        this.fallEnergyTimer = this.time.addEvent({
          delay:    200,
          callback: () => {
            this.gm.energySystem.consume(
              Math.ceil(FALL_ENERGY_COST_PER_SEC * 0.2)
            );
          },
          repeat: Math.floor(FALL_DURATION_MS / 200),
        });

        // 2. 도리도리 연출
        this.time.delayedCall(400, () => {
          this.tweens.add({
            targets:  this.player,
            x:        this.player.x + 6,
            duration: 80,
            ease:     'Sine.easeInOut',
            yoyo:     true,
            repeat:   4,
            onComplete: () => this.recoverFromFall(),
          });
        });
      },
    });
  }

  private recoverFromFall(): void {
    // 3. 복귀 연출
    this.tweens.add({
      targets:  this.player,
      scaleY:   1,
      fillColor: 0x00cc66,
      duration: 300,
      ease:     'Power2',
      onComplete: () => {
        this.isFalling     = false;
        this.playerBlocked = false;
        this.fallEnergyTimer?.remove();
        console.log('[VillageScene] 돌다리 빠짐 복귀');
      },
    });
  }

  // ── 상호작용 ──────────────────────────────────────────────────

  private createInteractHint(): void {
    this.interactHint = this.add.text(0, 0, '[E] 대화', {
      fontSize: '10px', color: '#ffffff',
      backgroundColor: '#00000099', padding: { x: 3, y: 2 },
    }).setOrigin(0.5, 1).setDepth(10).setVisible(false);

    // 카메라에 고정
    this.interactHint.setScrollFactor(0);
  }

  // 대화 UI
  private dialogueBox: Phaser.GameObjects.Container | null = null;

  private handleInteract(): void {
    // 대화 중이면 E키로 대화 종료 (playerBlocked 체크보다 먼저)
    if (this.gm.npcSystem.isTalkingNow()) {
      this.closeDialogue();
      return;
    }

    if (this.playerBlocked || this.isFalling) return;
    if (!this.nearbyNpcId) return;

    const npcId = this.nearbyNpcId as NpcId;

    const equippedSlot = this.gm.inventorySystem.getEquippedSlot();
    const quickSlots   = this.gm.inventorySystem.getQuickSlots();
    const equipped     = equippedSlot !== null ? quickSlots[equippedSlot] : null;

    if (equipped) {
      this.showGiftConfirm(npcId, equipped.id, equipped.type);
    } else {
      this.gm.npcSystem.startTalk(npcId);
    }
  }

  private showDialogue(npcId: string, lines: string[]): void {
    // 기존 대화창 제거
    this.dialogueBox?.destroy();

    const cam  = this.cameras.main;
    const cx   = cam.scrollX + cam.width / 2;
    const cy   = cam.scrollY + cam.height - 80;
    const w    = cam.width - 40;

    const bg = this.add.rectangle(cx, cy, w, 80, 0x1a1a2e, 0.92)
      .setStrokeStyle(1.5, 0xaaaaaa).setDepth(30);

    const npcLabel = this.add.text(cx - w/2 + 12, cy - 28, npcId, {
      fontSize: '12px', color: '#ffdd88', fontStyle: 'bold',
    }).setDepth(31);

    const txt = this.add.text(cx - w/2 + 12, cy - 8, lines.join('\n'), {
      fontSize: '13px', color: '#ffffff',
      wordWrap: { width: w - 24 },
    }).setDepth(31);

    const hint = this.add.text(cx + w/2 - 12, cy + 28, '[E] 닫기', {
      fontSize: '10px', color: '#888888',
    }).setOrigin(1, 1).setDepth(31);

    this.dialogueBox = this.add.container(0, 0, [bg, npcLabel, txt, hint])
      .setDepth(30);
  }

  private closeDialogue(): void {
    this.dialogueBox?.destroy();
    this.dialogueBox = null;
    this.gm.npcSystem.endTalk();
  }

  private showGiftConfirm(npcId: NpcId, itemId: string, itemType: string): void {
    // 간단한 선물/대화 선택 UI
    const cam    = this.cameras.main;
    const cx     = cam.scrollX + cam.width / 2;
    const cy     = cam.scrollY + cam.height / 2;

    const bg = this.add.rectangle(cx, cy + 60, 200, 60, 0x1a1a2e, 0.95)
      .setStrokeStyle(1, 0xffffff).setDepth(20);

    const talkBtn = this.add.text(cx - 50, cy + 60, '[대화]', {
      fontSize: '12px', color: '#aaffaa',
    }).setOrigin(0.5).setDepth(21).setInteractive({ useHandCursor: true });

    const giftBtn = this.add.text(cx + 50, cy + 60, '[선물]', {
      fontSize: '12px', color: '#ffdd88',
    }).setOrigin(0.5).setDepth(21).setInteractive({ useHandCursor: true });

    const cleanup = () => { bg.destroy(); talkBtn.destroy(); giftBtn.destroy(); };

    talkBtn.on('pointerdown', () => {
      cleanup();
      this.gm.npcSystem.startTalk(npcId);
    });

    giftBtn.on('pointerdown', () => {
      cleanup();
      this.gm.npcSystem.giveGift(npcId, itemId, itemType);
    });

    // 2초 후 자동 닫기
    this.time.delayedCall(3000, cleanup);
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    this.gm.timeSystem.on('hourChanged', () => {
      this.startMayorPatrol();
    });

    this.gm.timeSystem.on('weatherChanged', () => {
      this.updateStoneBridgeVisual();
    });

    // 대화 시작 → 대화창 표시 + 이장 첫 대화 도구 지급
    this.gm.npcSystem.on('dialogueLines', (npcId: string, lines: string[]) => {
      this.showDialogue(npcId, lines);

      // 이장 첫 대화 → 스타터 도구 지급 (1회)
      if (npcId === 'mayor' && !this.gm.gameState.receivedStarterTools) {
        this.gm.gameState.receivedStarterTools = true;
        this.time.delayedCall(800, () => this.giveStarterTools());
      }
    });

    // 대화 종료 → 차단 해제
    this.gm.npcSystem.on('talkEnded', () => {
      this.playerBlocked = false;
      this.dialogueBox?.destroy();
      this.dialogueBox = null;
    });

    this.gm.npcSystem.on('talkStarted', () => {
      this.playerBlocked = true;
      // 이동 중 대화 시작 시 관성 제거
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
    });
  }

  // ── 스타터 도구 지급 ──────────────────────────────────────────

  private giveStarterTools(): void {
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;

    const halfDur = 250;
    const maxDur  = 500;

    const starterTools = [
      { id: 'hoe_starter',        type: 'hoe'       as const },
      { id: 'sickle_starter',     type: 'sickle'    as const },
      { id: 'fishingRod_starter', type: 'fishingRod' as const },
    ];

    // GameState tools에 추가 (중복 방지)
    starterTools.forEach(({ id, type }) => {
      if (!this.gm.gameState.tools.some(t => t.id === id)) {
        this.gm.gameState.tools.push({
          id, type,
          durability:    halfDur,
          maxDurability: maxDur,
          isRepairing:   false,
        });
      }
    });

    // ToolSystem 동기화
    this.gm.toolSystem.syncTools(this.gm.gameState.tools);

    // 퀵슬롯에 직접 배치
    const quickSlots = this.gm.inventorySystem.getQuickSlots() as any[];
    starterTools.forEach(({ id, type }, i) => {
      quickSlots[i] = {
        id, type,
        durability:    halfDur,
        maxDurability: maxDur,
        isRepairing:   false,
      };
    });

    hud?.showToast?.('이장님께 도구를 받았어요! (괭이·낫·낚싯대)', 'ok');
    console.log('[VillageScene] 스타터 도구 지급 완료');
  }

  // ── 낚시 등록 ─────────────────────────────────────────────────

  private registerFishing(): void {
    const T = TILE_SIZE;
    // 강 구역 (y=28~32타일)
    this.gm.setWaterChecker((_px, py) => {
      const ty = Math.floor(py / T);
      return ty >= 28 && ty < 32;
    });

    const fs = this.gm.fishingSystem;
    fs.removeAllListeners('catch');
    fs.removeAllListeners('fail');
    fs.removeAllListeners('reset');

    fs.on('catch', (fishId: string) => {
      const added = this.gm.inventorySystem.addItem({
        itemId: fishId, itemType: 'fish' as any, condition: 'normal', quantity: 1,
      });
      const hud = this.scene.get(SCENE_KEYS.HUD) as any;
      if (!added) hud?.showToast?.('인벤토리가 꽉 찼어요.', 'warn');
      else hud?.showToast?.('물고기를 잡았어요!', 'ok');
      this.playerBlocked = false;
    });
    fs.on('fail',  () => { this.playerBlocked = false; });
    fs.on('reset', () => { this.playerBlocked = false; });
  }

  private updateStoneBridgeVisual(): void {
    const isRaining = this.gm.weatherSystem.isRaining();
    // 비 올 때 돌다리를 더 어둡게 표시
    // 실제 타일셋 교체 시 타일 인덱스로 처리
    const color = isRaining ? 0x445566 : 0x778899;
    // 임시: 텍스트로 상태 표시
    console.log(`[VillageScene] 돌다리 상태: ${isRaining ? '위험' : '안전'}`);
  }

  // ── 매 프레임 ─────────────────────────────────────────────────

  update(): void {
    this.handleMovement();
    this.checkNearbyNPC();
    this.updateMayorLabel();
    this.checkMayorWaypoint();
  }

  private checkMayorWaypoint(): void {
    if (!this.mayorCurrentWp || !this.mayorSprite.visible) return;

    const dist = Phaser.Math.Distance.Between(
      this.mayorSprite.x, this.mayorSprite.y,
      this.mayorCurrentWp.x, this.mayorCurrentWp.y
    );

    if (dist < this.MAYOR_REACH_DIST) {
      // 웨이포인트 도달 → 잠시 정지 후 다음 목적지
      const body = this.mayorSprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      this.mayorCurrentWp = null;
      this.time.delayedCall(Phaser.Math.Between(1500, 3000), () => {
        this.pickNextWaypoint();
      });
    }
  }

  private handleMovement(): void {
    if (this.playerBlocked) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  PLAYER_SPEED;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -PLAYER_SPEED;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  PLAYER_SPEED;

    // 대각선 속도 보정
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }

    body.setVelocity(vx, vy);
  }

  private checkNearbyNPC(): void {
    const interactRange = TILE_SIZE * 2;
    let found: string | null = null;

    // 고정 NPC 거리 체크
    this.npcSprites.forEach((sprite, id) => {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        sprite.x, sprite.y
      );
      if (dist < interactRange) found = id;
    });

    // 이장 거리 체크
    if (this.mayorSprite.visible) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        this.mayorSprite.x, this.mayorSprite.y
      );
      if (dist < interactRange) found = 'mayor';
    }

    this.nearbyNpcId = found;

    // 상호작용 힌트 표시
    if (found) {
      const sprite = found === 'mayor'
        ? this.mayorSprite
        : this.npcSprites.get(found)!;

      this.interactHint
        .setVisible(true)
        .setPosition(
          sprite.x - this.cameras.main.scrollX,
          sprite.y - this.cameras.main.scrollY - 20
        );
    } else {
      this.interactHint.setVisible(false);
    }
  }

  private updateMayorLabel(): void {
    if (this.mayorSprite.visible) {
      this.mayorLabel.setPosition(
        this.mayorSprite.x,
        this.mayorSprite.y - 14
      );
    }
  }

  // ── wake (sleep에서 깨어날 때) ────────────────────────────────

  wake(data?: { from?: string; coord?: number; axis?: string }): void {
    const { x, y } = this.getSpawnPos(data);
    this.player.setPosition(x, y);
    this.updateStoneBridgeVisual();
    this.startMayorPatrol();
    this.registerFishing();

    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    hud?.fadeIn?.();
  }
}