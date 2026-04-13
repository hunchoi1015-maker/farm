// ================================================================
// TidalFlatScene — 갯벌 씬 (수평 레이아웃)
// ================================================================
//
// 맵 구조 (50×40 타일, x축 기준):
//   x=0~14:   바다 (항상 진입 불가)
//   x=15~35:  갯벌 (13~20시 활성, 나머지 바다)
//   x=36~50:  모래사장 (항상 이동 가능)
//
// 씬 전환:
//   우측 상단 (x=42~50, y=0) → CliffPathScene
//   우측 (x=50, y=12~28) → VillageScene
//
// 갯벌 전환:
//   13시 → 물결선 우측 이동 + 갯벌 활성
//   19시 → 경고
//   20시 → 물결선 좌측 이동 + 갯벌 비활성
//
// 수영 로직: x좌표 기준
// ================================================================

import Phaser from 'phaser';
import { SceneTransition } from '../ui/SceneTransition';
import { portalKey } from '../data/portals';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import type { HerbObject } from '../types';

const T            = 16;
const MAP_W        = 50;
const MAP_H        = 40;
const PLAYER_SPEED = 120;
const TIDAL_SPEED  = PLAYER_SPEED * 0.7;

const SEA_X_END    = 15;
const TIDAL_X_END  = 36;
const SAND_X_START = 36;

const TIDAL_OPEN_HOUR   = 13;
const TIDAL_CLOSE_HOUR  = 20;
const WARNING_HOUR      = 19;
const SWIM_ENERGY_PER_S = 10;
const RESCUE_ENERGY_PCT = 0.2;
const MAX_GATHERS_DAY   = 7;
const GATHER_RANGE      = T * 2;

const WAVELINE_SEA_X   = SEA_X_END * T;
const WAVELINE_TIDAL_X = TIDAL_X_END * T;

const GATHER_TABLE = [
  { itemId: 'clam',    label: '조개', weight: 20 },
  { itemId: 'crab',    label: '게',   weight: 20 },
  { itemId: 'seaweed', label: '해초', weight: 60 },
] as const;

type FromData = { from?: string; coord?: number; axis?: string };

export class TidalFlatScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private playerBlocked = false;
  private isSwimming    = false;
  private _fromData?: FromData;
  private transition!:  SceneTransition;

  private isTidalOpen = false;
  private wavelineX   = WAVELINE_SEA_X;

  private seaGroup!:   Phaser.Physics.Arcade.StaticGroup;
  private tidalGroup!: Phaser.Physics.Arcade.StaticGroup;
  private tidalGfx!:   Phaser.GameObjects.Graphics;
  private wavelineGfx!:Phaser.GameObjects.Graphics;

  private gatherSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private swimTimer?: Phaser.Time.TimerEvent;

  constructor() { super({ key: SCENE_KEYS.TIDAL_FLAT }); }

  create(data?: FromData): void {
    this.gm        = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromData = data;

    const hour = this.gm.timeSystem.getHour();
    this.isTidalOpen = hour >= TIDAL_OPEN_HOUR && hour < TIDAL_CLOSE_HOUR;
    this.wavelineX   = this.isTidalOpen ? WAVELINE_TIDAL_X : WAVELINE_SEA_X;

    this.buildBackground();
    this.buildCollision();
    this.createPlayer(data);
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    this.spawnGatherObjects();
    this.renderAllGatherObjects();
    this.registerFishing();
    this.subscribeEvents();

    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
  }

  private buildBackground(): void {
    const W = MAP_W * T, H = MAP_H * T;
    const gfx = this.add.graphics().setDepth(0);

    // 모래사장
    gfx.fillStyle(0xe8d5a3);
    gfx.fillRect(SAND_X_START * T, 0, (MAP_W - SAND_X_START) * T, H);
    gfx.fillStyle(0xd4c090, 0.3);
    for (let i = 0; i < 20; i++) {
      const dx = Phaser.Math.Between(SAND_X_START * T + T, W - T);
      const dy = Phaser.Math.Between(T, H - T);
      gfx.fillEllipse(dx, dy, Phaser.Math.Between(6, 20), Phaser.Math.Between(3, 8));
    }

    // 바다 (좌측)
    gfx.fillStyle(0x1a4488);
    gfx.fillRect(0, 0, SEA_X_END * T, H);

    // 갯벌/바다 중간 (동적 갱신)
    this.tidalGfx    = this.add.graphics().setDepth(1);
    this.wavelineGfx = this.add.graphics().setDepth(2);
    this.redrawTidal();
    this.redrawWaveline();

    // 라벨
    this.add.text(SAND_X_START * T + (MAP_W - SAND_X_START) * T / 2, H / 2,
      '모래사장', { fontSize: '12px', color: '#8b6914' }
    ).setOrigin(0.5).setDepth(3);
    this.add.text(SEA_X_END * T / 2, H / 2,
      '바다', { fontSize: '11px', color: '#88bbff' }
    ).setOrigin(0.5).setDepth(3);
  }

  private redrawTidal(): void {
    this.tidalGfx.clear();
    const H = MAP_H * T;
    if (this.isTidalOpen) {
      this.tidalGfx.fillStyle(0xa09070);
      this.tidalGfx.fillRect(SEA_X_END * T, 0, (TIDAL_X_END - SEA_X_END) * T, H);
      this.tidalGfx.fillStyle(0x888060, 0.3);
      for (let i = 0; i < 40; i++) {
        const dx = Phaser.Math.Between(SEA_X_END * T + T, TIDAL_X_END * T - T);
        const dy = Phaser.Math.Between(T, H - T);
        this.tidalGfx.fillCircle(dx, dy, 2);
      }
    } else {
      this.tidalGfx.fillStyle(0x2255aa);
      this.tidalGfx.fillRect(SEA_X_END * T, 0, (TIDAL_X_END - SEA_X_END) * T, H);
    }
  }

  private redrawWaveline(): void {
    this.wavelineGfx.clear();
    const H = MAP_H * T;

    this.wavelineGfx.lineStyle(2, 0x88bbff, 0.8);
    this.wavelineGfx.beginPath();
    this.wavelineGfx.moveTo(this.wavelineX, 0);
    for (let y = 0; y <= H; y += 8) {
      const wx = this.wavelineX + Math.sin(y * 0.05) * T * 0.5;
      this.wavelineGfx.lineTo(wx, y);
    }
    this.wavelineGfx.strokePath();

    this.wavelineGfx.lineStyle(1.5, 0x4488cc, 0.5);
    this.wavelineGfx.beginPath();
    this.wavelineGfx.moveTo(this.wavelineX - T, 0);
    for (let y = 0; y <= H; y += 8) {
      const wx = this.wavelineX - T + Math.sin(y * 0.05 + 1) * T * 0.4;
      this.wavelineGfx.lineTo(wx, y);
    }
    this.wavelineGfx.strokePath();
  }

  private buildCollision(): void {
    const H = MAP_H * T;
    this.seaGroup   = this.physics.add.staticGroup();
    this.tidalGroup = this.physics.add.staticGroup();

    const seaBlock = this.add.rectangle(SEA_X_END * T / 2, H / 2, SEA_X_END * T, H, 0x000000, 0);
    this.physics.add.existing(seaBlock, true);
    this.seaGroup.add(seaBlock);

    const tidalBlock = this.add.rectangle(
      SEA_X_END * T + (TIDAL_X_END - SEA_X_END) * T / 2, H / 2,
      (TIDAL_X_END - SEA_X_END) * T, H, 0x000000, 0
    );
    this.physics.add.existing(tidalBlock, true);
    this.tidalGroup.add(tidalBlock);
    this.setTidalCollision(!this.isTidalOpen);
  }

  private setTidalCollision(blocked: boolean): void {
    this.tidalGroup.getChildren().forEach(child => {
      const body = (child as Phaser.GameObjects.GameObject & {
        body: Phaser.Physics.Arcade.StaticBody
      }).body;
      if (body) body.enable = blocked;
    });
  }

  private getSpawnPos(data?: FromData): { x: number; y: number } {
    const default_ = { x: (SAND_X_START + 5) * T, y: MAP_H / 2 * T };
    if (data?.from && data.coord !== undefined && data.coord >= 0) {
      return SceneTransition.calcSpawn(data, data.from, default_);
    }
    switch (data?.from) {
      case 'cliff_path': return { x: (SAND_X_START + 5) * T, y: 4 * T };
      default:           return default_;
    }
  }

  private createPlayer(data?: FromData): void {
    const { x, y } = this.getSpawnPos(data);
    this.player = this.add.rectangle(x, y, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.seaGroup);
    this.physics.add.collider(this.player, this.tidalGroup);
  }

  private setupCamera(): void {
    this.physics.world.setBounds(0, 0, MAP_W * T, MAP_H * T);
    this.cameras.main.setBounds(0, 0, MAP_W * T, MAP_H * T).startFollow(this.player, true, 0.1, 0.1);
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 2) return;
      if (this.playerBlocked || this.isSwimming) return;

      const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
      const quickSlots  = this.gm.inventorySystem.getQuickSlots();
      const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;

      if (tool?.type === 'fishingRod') { this.handleFishing(); return; }
      if (this.isTidalOpen) this.tryGatherNearby();
    });

    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  private createExitZones(): void {
    this.transition = new SceneTransition(this, this.gm);
    this.transition.setPlayer(this.player);
    const blocked = () => this.playerBlocked || this.isSwimming;

    const portals = [
      { fromKey: 'tidal_flat', toKey: 'village',    target: SCENE_KEYS.VILLAGE,
        x: MAP_W * T - T*2, y: T*12, w: T*2, h: T*16, dir: 'right' as const },
      { fromKey: 'tidal_flat', toKey: 'cliff_path', target: SCENE_KEYS.CLIFF_PATH,
        x: MAP_W * T - T*10, y: 0,  w: T*10, h: T*2,  dir: 'up'    as const },
    ];

    portals.forEach(p => {
      this.transition.addPortal({
        fromKey: p.fromKey, toKey: p.toKey, targetScene: p.target,
        zoneX: p.x, zoneY: p.y, zoneW: p.w, zoneH: p.h,
        direction: p.dir, isBlocked: blocked,
      });
    });

    const hintGfx = this.add.graphics().setDepth(1);
    portals.forEach(p => SceneTransition.drawPortalHint(hintGfx, portalKey(p.fromKey, p.toKey)));
  }

  private registerFishing(): void {
    this.gm.setWaterChecker((px, _py) => {
      const tx = Math.floor(px / T);
      return this.isTidalOpen ? tx < SEA_X_END : tx < TIDAL_X_END;
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
      this.gm.recordSystem.tryFishingDrop();
      this.playerBlocked = false;
    });
    fs.on('fail',  () => { this.playerBlocked = false; });
    fs.on('reset', () => { this.playerBlocked = false; });
  }

  private handleFishing(): void {
    const fs = this.gm.fishingSystem;
    if (!fs.isIdle()) return;
    const hud = this.scene.get(SCENE_KEYS.HUD) as any;
    const equippedIdx = this.gm.inventorySystem.getEquippedSlot();
    const quickSlots  = this.gm.inventorySystem.getQuickSlots();
    const tool        = equippedIdx !== null ? quickSlots[equippedIdx] : null;
    if (!tool || tool.type !== 'fishingRod') { hud?.showToast?.('낚싯대가 필요해요.', 'warn'); return; }
    if (!this.gm.energySystem.consume(6))    { hud?.showToast?.('기력이 부족해요.', 'warn'); return; }
    this.gm.toolSystem.useTool(tool.id);
    hud?.getFishingUI?.()?.setRodPosition(this.player.x, this.player.y - 8);
    this.playerBlocked = true;
    fs.startCharging();
  }

  private getGatherObjects(): HerbObject[] {
    return this.gm.gameState.herbObjects.filter(h => h.id.startsWith('tidal_'));
  }

  private spawnGatherObjects(): void {
    const existing = this.getGatherObjects();
    const toSpawn  = MAX_GATHERS_DAY - existing.length;
    for (let i = 0; i < toSpawn; i++) {
      const pos = this.randomGatherPos(existing);
      if (!pos) break;
      const obj: HerbObject = {
        id: `tidal_${Date.now()}_${i}`,
        tileX: pos.tx, tileY: pos.ty,
        spawnedDay: this.gm.timeSystem.getTotalDays(),
      };
      this.gm.gameState.herbObjects.push(obj);
      existing.push(obj);
    }
  }

  private randomGatherPos(existing: HerbObject[]): { tx: number; ty: number } | null {
    const occupied = new Set(existing.map(h => `${h.tileX}:${h.tileY}`));
    for (let i = 0; i < 50; i++) {
      const tx = Phaser.Math.Between(SEA_X_END, TIDAL_X_END - 1);
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
    const x = obj.tileX * T + T / 2, y = obj.tileY * T + T / 2;
    const drop   = this.rollDrop();
    const colors: Record<string, number> = { clam: 0xeeeecc, crab: 0xff8844, seaweed: 0x44aa44 };
    const emojis: Record<string, string> = { clam: '🐚', crab: '🦀', seaweed: '🌿' };
    const circle    = this.add.circle(0, 0, 5, colors[drop] ?? 0xcccccc).setDepth(3);
    const label     = this.add.text(0, -10, emojis[drop] ?? '?', { fontSize: '10px' }).setOrigin(0.5).setDepth(4);
    const container = this.add.container(x, y, [circle, label]).setDepth(3).setData('drop', drop);
    container.setVisible(this.isTidalOpen);
    this.gatherSprites.set(obj.id, container);
  }

  private rollDrop(): string {
    const rand = Math.random() * 100;
    let acc = 0;
    for (const entry of GATHER_TABLE) { acc += entry.weight; if (rand < acc) return entry.itemId; }
    return 'seaweed';
  }

  private tryGatherNearby(): void {
    let nearest: HerbObject | null = null;
    let minDist = Infinity;
    this.getGatherObjects().forEach(obj => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.tileX * T + T/2, obj.tileY * T + T/2);
      if (dist < GATHER_RANGE && dist < minDist) { minDist = dist; nearest = obj; }
    });
    if (!nearest) return;

    const hud  = this.scene.get(SCENE_KEYS.HUD) as any;
    const obj  = nearest as HerbObject;
    const drop = this.gatherSprites.get(obj.id)?.getData('drop') ?? this.rollDrop();
    const entry = GATHER_TABLE.find(d => d.itemId === drop);

    if (!this.gm.energySystem.consume(2)) { hud?.showToast?.('기력이 부족해요.', 'warn'); return; }
    if (!this.gm.inventorySystem.addItem({ itemId: drop, itemType: 'crop', condition: 'normal', quantity: 1 })) {
      hud?.showToast?.('인벤토리가 꽉 찼어요.', 'warn'); return;
    }
    hud?.showToast?.(`${entry?.label ?? drop} 획득!`, 'ok');

    this.gm.gameState.herbObjects = this.gm.gameState.herbObjects.filter(h => h.id !== obj.id);
    const sprite = this.gatherSprites.get(obj.id);
    if (sprite) {
      this.tweens.add({ targets: sprite, alpha: 0, y: sprite.y - 16, duration: 250,
        onComplete: () => { sprite.destroy(); this.gatherSprites.delete(obj.id); } });
    }
  }

  private openTidal(): void {
    this.isTidalOpen = true;
    this.setTidalCollision(false);
    this.tweens.add({
      targets: this, wavelineX: WAVELINE_TIDAL_X, duration: 2000, ease: 'Linear',
      onUpdate: () => this.redrawWaveline(),
      onComplete: () => { this.redrawTidal(); this.gatherSprites.forEach(s => s.setVisible(true)); },
    });
  }

  private closeTidal(): void {
    this.isTidalOpen = false;
    this.gatherSprites.forEach(s => s.setVisible(false));
    this.tweens.add({
      targets: this, wavelineX: WAVELINE_SEA_X, duration: 3000, ease: 'Linear',
      onUpdate: () => { this.redrawWaveline(); this.redrawTidal(); },
      onComplete: () => { this.setTidalCollision(true); if (this.isPlayerInTidal()) this.startSwimming(); },
    });
  }

  private isPlayerInTidal(): boolean {
    const tx = Math.floor(this.player.x / T);
    return tx >= SEA_X_END && tx < TIDAL_X_END;
  }

  private startSwimming(): void {
    if (this.isSwimming) return;
    this.isSwimming = true;
    (this.scene.get(SCENE_KEYS.HUD) as any)?.showToast?.('물이 차올랐어요! 빨리 나가세요!', 'warn');
    this.tweens.add({ targets: this.player, x: this.player.x + 5, duration: 80, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
    this.swimTimer = this.time.addEvent({
      delay: 1000, repeat: -1,
      callback: () => {
        if (!this.gm.energySystem.consume(SWIM_ENERGY_PER_S)) { this.triggerRescue(); }
        else if (!this.isPlayerInTidal()) { this.stopSwimming(); (this.scene.get(SCENE_KEYS.HUD) as any)?.showToast?.('겨우 빠져나왔어요!', 'ok'); }
      },
    });
  }

  private stopSwimming(): void {
    this.isSwimming = false;
    this.swimTimer?.remove();
    this.swimTimer = undefined;
    this.tweens.killTweensOf(this.player);
    this.player.setAlpha(1);
  }

  private triggerRescue(): void {
    this.stopSwimming();
    this.playerBlocked = true;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeOut?.(() => {
      this.player.setPosition(SAND_X_START * T + T * 2, MAP_H / 2 * T);
      const recover = Math.floor(this.gm.energySystem.getMax() * RESCUE_ENERGY_PCT);
      this.gm.energySystem.restore(recover);
      this.playerBlocked = false;
      (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
      (this.scene.get(SCENE_KEYS.HUD) as any)?.showToast?.(`한의사에게 구조됐어요. 기력 +${recover}`, 'info');
    });
  }

  private subscribeEvents(): void {
    this.gm.timeSystem.on('hourChanged', (hour: number) => {
      if (hour === TIDAL_OPEN_HOUR)  this.openTidal();
      if (hour === WARNING_HOUR)     (this.scene.get(SCENE_KEYS.HUD) as any)?.showToast?.('곧 물이 들어와요!', 'warn');
      if (hour === TIDAL_CLOSE_HOUR) this.closeTidal();
    });
    this.gm.timeSystem.on('dayChanged', () => {
      this.spawnGatherObjects();
      if (this.isTidalOpen) this.renderAllGatherObjects();
    });
  }

  update(): void {
    if (this.playerBlocked) return;
    const onTidal = this.isPlayerInTidal() && this.isTidalOpen;
    const speed   = onTidal ? TIDAL_SPEED : PLAYER_SPEED;
    const body    = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -speed;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  speed;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -speed;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  speed;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    body.setVelocity(vx, vy);
  }

  wake(data?: FromData): void {
    const hour = this.gm.timeSystem.getHour();
    this.isTidalOpen = hour >= TIDAL_OPEN_HOUR && hour < TIDAL_CLOSE_HOUR;
    this.wavelineX   = this.isTidalOpen ? WAVELINE_TIDAL_X : WAVELINE_SEA_X;
    this.redrawTidal();
    this.redrawWaveline();
    this.gatherSprites.forEach(s => s.setVisible(this.isTidalOpen));
    this.registerFishing();
    const { x, y } = this.getSpawnPos(data);
    this.player.setPosition(x, y);
    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
  }
}