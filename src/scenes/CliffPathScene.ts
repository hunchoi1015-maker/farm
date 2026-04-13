// ================================================================
// CliffPathScene — 절벽길 (산 ↔ 갯벌 사이)
// ================================================================

import Phaser from 'phaser';
import { SceneTransition } from '../ui/SceneTransition';
import { portalKey } from '../data/portals';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';

const TILE_SIZE    = 16;
const MAP_W        = 20;
const MAP_H        = 30;
const PLAYER_SPEED = 120;

type FromData = { from?: string; coord?: number; axis?: string };

export class CliffPathScene extends Phaser.Scene {
  private gm!:      GameManagerScene;
  private player!:  Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!:    Record<string, Phaser.Input.Keyboard.Key>;
  private transition!: SceneTransition;
  private _fromData?: FromData;

  constructor() { super({ key: SCENE_KEYS.CLIFF_PATH }); }

  create(data?: FromData): void {
    this.gm        = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
    this._fromData = data;
    this.buildBackground();
    this.createPlayer(data);
    this.setupCamera();
    this.setupInput();
    this.createExitZones();
    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
  }

  private buildBackground(): void {
    const W = MAP_W * TILE_SIZE, H = MAP_H * TILE_SIZE;
    const gfx = this.add.graphics().setDepth(0);

    gfx.fillStyle(0x6b5a3a); gfx.fillRect(0, 0, W, H);
    gfx.fillStyle(0x8b7a5a);
    gfx.fillRect(TILE_SIZE * 4, 0, TILE_SIZE * 12, H);

    gfx.fillStyle(0x4a3a28);
    gfx.fillRect(0, 0, TILE_SIZE * 4, H);
    gfx.fillRect(TILE_SIZE * 16, 0, TILE_SIZE * 4, H);

    this.add.text(W / 2, H / 2, '절벽길', {
      fontSize: '11px', color: '#ffffff88',
    }).setOrigin(0.5).setDepth(1);
  }

  private getSpawnPos(data?: FromData): { x: number; y: number } {
    const cx      = MAP_W / 2 * TILE_SIZE;
    const default_ = { x: cx, y: (MAP_H - 3) * TILE_SIZE };

    if (data?.from && data.coord !== undefined && data.coord >= 0) {
      return SceneTransition.calcSpawn(data, data.from, default_);
    }

    switch (data?.from) {
      case 'tidal_flat': return { x: cx, y: 4 * TILE_SIZE };
      default:           return default_;
    }
  }

  private createPlayer(data?: FromData): void {
    const { x, y } = this.getSpawnPos(data);
    this.player = this.add.rectangle(x, y, 12, 14, 0x00cc66).setDepth(5);
    this.physics.add.existing(this.player);
    (this.player.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
  }

  private setupCamera(): void {
    const W = MAP_W * TILE_SIZE, H = MAP_H * TILE_SIZE;
    this.physics.world.setBounds(0, 0, W, H);
    this.cameras.main.setBounds(0, 0, W, H).startFollow(this.player, true, 0.1, 0.1);
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  private createExitZones(): void {
    const T = TILE_SIZE;
    this.transition = new SceneTransition(this, this.gm);
    this.transition.setPlayer(this.player);

    const portals = [
      { fromKey: 'cliff_path', toKey: 'mountain',   target: SCENE_KEYS.MOUNTAIN,
        x: T*6, y: 0,         w: T*8, h: T*2, dir: 'up'   as const },
      { fromKey: 'cliff_path', toKey: 'tidal_flat', target: SCENE_KEYS.TIDAL_FLAT,
        x: T*6, y: T*30-T*2, w: T*8, h: T*2, dir: 'down' as const },
    ];

    portals.forEach(p => {
      this.transition.addPortal({
        fromKey: p.fromKey, toKey: p.toKey,
        targetScene: p.target,
        zoneX: p.x, zoneY: p.y, zoneW: p.w, zoneH: p.h,
        direction: p.dir,
      });
    });

    const hintGfx = this.add.graphics().setDepth(1);
    portals.forEach(p => SceneTransition.drawPortalHint(hintGfx, portalKey(p.fromKey, p.toKey)));
  }

  update(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  PLAYER_SPEED;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -PLAYER_SPEED;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  PLAYER_SPEED;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    body.setVelocity(vx, vy);
  }

  wake(data?: FromData): void {
    const { x, y } = this.getSpawnPos(data);
    this.player.setPosition(x, y);
    (this.scene.get(SCENE_KEYS.HUD) as any)?.fadeIn?.();
  }
}