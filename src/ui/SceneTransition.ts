// ================================================================
// ui/SceneTransition.ts — 씬 전환 헬퍼
// ================================================================
//
// 역할:
//   - 방향 체크 기반 전환 존 생성
//   - 포털 좌표 변환
//   - 통로 시각 표시 (임시 맵용)
//
// 사용법:
//   const transition = new SceneTransition(scene, gm);
//   transition.addPortal({
//     fromKey: 'village',
//     toKey:   'mountain',
//     targetScene: SCENE_KEYS.MOUNTAIN,
//     zoneX, zoneY, zoneW, zoneH,
//   });
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene, SceneKey } from '../scenes/GameManagerScene';
import { PORTALS, mapPortalCoord, isMovingToward, portalKey } from '../data/portals';
import type { PortalDirection } from '../data/portals';

// ── 포털 설정 ────────────────────────────────────────────────────

export interface PortalConfig {
  fromKey:     string;
  toKey:       string;
  targetScene: SceneKey;
  // 존 위치 (픽셀)
  zoneX: number;
  zoneY: number;
  zoneW: number;
  zoneH: number;
  direction:   PortalDirection;
  // 플레이어 차단 여부를 외부에서 주입
  isBlocked?: () => boolean;
}

// ── SceneTransition ──────────────────────────────────────────────

export class SceneTransition {
  private scene:  Phaser.Scene;
  private gm:     GameManagerScene;
  private player!: Phaser.GameObjects.GameObject;

  constructor(scene: Phaser.Scene, gm: GameManagerScene) {
    this.scene = scene;
    this.gm    = gm;
  }

  setPlayer(player: Phaser.GameObjects.GameObject): void {
    this.player = player;
  }

  // ── 포털 추가 ─────────────────────────────────────────────────

  addPortal(cfg: PortalConfig): void {
    const zone = this.scene.add.zone(
      cfg.zoneX + cfg.zoneW / 2,
      cfg.zoneY + cfg.zoneH / 2,
      cfg.zoneW, cfg.zoneH
    );
    this.scene.physics.add.existing(zone, true);

    this.scene.physics.add.overlap(this.player, zone, () => {
      if (cfg.isBlocked?.()) return;

      const body = (this.player as any).body as Phaser.Physics.Arcade.Body;
      if (!isMovingToward(body.velocity.x, body.velocity.y, cfg.direction)) return;

      // 좌표 변환
      const fromPortal = PORTALS[portalKey(cfg.fromKey, cfg.toKey)];
      const toPortal   = PORTALS[portalKey(cfg.toKey, cfg.fromKey)];

      let coord = -1;
      if (fromPortal && toPortal) {
        const playerCoord = fromPortal.axis === 'y'
          ? (this.player as any).x
          : (this.player as any).y;
        coord = mapPortalCoord(
          playerCoord,
          portalKey(cfg.fromKey, cfg.toKey),
          portalKey(cfg.toKey, cfg.fromKey),
        );
      }

      this.gm.switchMap(cfg.targetScene, {
        from:  cfg.fromKey,
        coord,
        axis:  fromPortal?.axis ?? 'y',
      });
    });
  }

  // ── 스폰 위치 계산 ────────────────────────────────────────────

  /**
   * wake/create 시 data에서 스폰 위치 계산.
   * @param data    씬 전환 시 전달된 data
   * @param defaultPos 기본 스폰 위치
   */
  static calcSpawn(
    data: { from?: string; coord?: number; axis?: string } | undefined,
    toSceneKey: string,
    defaultPos: { x: number; y: number }
  ): { x: number; y: number } {
    if (!data?.from || data.coord === undefined || data.coord < 0) {
      return defaultPos;
    }

    const toPortal = PORTALS[portalKey(data.from, toSceneKey)];
    if (!toPortal) return defaultPos;

    // axis에 따라 좌표 배치
    if (toPortal.axis === 'y') {
      // 수직 이동 → x 좌표 변환, y는 포털 고정 좌표 근처
      const spawnY = toPortal.direction === 'down'
        ? toPortal.fixedCoord + 24   // 하단 포털 → 조금 아래
        : toPortal.fixedCoord - 24;  // 상단 포털 → 조금 위
      return { x: data.coord, y: Math.max(20, spawnY) };
    } else {
      // 수평 이동 → y 좌표 변환, x는 포털 고정 좌표 근처
      const spawnX = toPortal.direction === 'right'
        ? toPortal.fixedCoord - 24
        : toPortal.fixedCoord + 24;
      return { x: Math.max(20, spawnX), y: data.coord };
    }
  }

  // ── 통로 시각 표시 (임시 맵용) ───────────────────────────────

  /**
   * 임시 맵에서 통로 위치를 밝은 색으로 표시.
   * Tiled 맵 교체 시 제거.
   */
  static drawPortalHint(
    gfx: Phaser.GameObjects.Graphics,
    portalKey: string,
    color = 0xc8b87a,
    alpha = 0.6
  ): void {
    const portal = PORTALS[portalKey];
    if (!portal) return;

    gfx.fillStyle(color, alpha);

    if (portal.axis === 'y') {
      // 수직 이동 (남/북 경계)
      gfx.fillRect(
        portal.rangeStart,
        portal.fixedCoord === 0 ? 0 : portal.fixedCoord - 8,
        portal.rangeEnd - portal.rangeStart,
        16
      );
    } else {
      // 수평 이동 (동/서 경계)
      gfx.fillRect(
        portal.fixedCoord === 0 ? 0 : portal.fixedCoord - 8,
        portal.rangeStart,
        16,
        portal.rangeEnd - portal.rangeStart
      );
    }
  }
}