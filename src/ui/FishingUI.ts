// ================================================================
// FishingUI — 낚시 UI + 찌 렌더링
// ================================================================
//
// UI 구성:
//   힘 게이지    (charging 상태)
//   텐션 게이지  (fight 상태)
//   포획 게이지  (fight 상태)
//   결과 텍스트  (catch/fail)
//
// 찌 상태:
//   cast   → 포물선 궤적 + 줄
//   splash → 파티클 + 리플 + 진동
//   float  → sin파 미세 흔들림
//   bite   → 패턴 입질 (예비→강함→확정)
//   hook   → 잠수 + 측면 이동
// ================================================================

import Phaser from 'phaser';
import type { FishingSystem, FishAIState, FailReason } from '../systems/FishingSystem';
import { FISHING_CONFIG } from '../data/fishing';
import { FISH_DATA } from '../data/fishing';

// ── 상수 ────────────────────────────────────────────────────────

const GAUGE_W = 200;
const GAUGE_H = 16;

// ── FishingUI ─────────────────────────────────────────────────────

export class FishingUI {
  private scene:   Phaser.Scene;
  private fishing: FishingSystem;
  private waterChecker?: (px: number, py: number) => boolean;  // 씬별 물 타일 판정

  // 찌 오브젝트
  private bobber:   Phaser.GameObjects.Container | null = null;
  private bobberCircle: Phaser.GameObjects.Arc | null = null;
  private line:     Phaser.GameObjects.Graphics | null = null;
  private ripples:  Phaser.GameObjects.Graphics | null = null;

  // 찌 물리 상태
  private bobberX   = 0;
  private bobberY   = 0;
  private velX      = 0;
  private velY      = 0;
  private floatBase = 0;
  private floatT    = 0;
  private isOnWater = false;

  // UI 컨테이너
  private uiContainer: Phaser.GameObjects.Container | null = null;

  // 낚싯대 위치 (플레이어 위치 기반)
  private rodX = 0;
  private rodY = 0;

  constructor(scene: Phaser.Scene, fishing: FishingSystem) {
    this.scene   = scene;
    this.fishing = fishing;

    this.subscribeEvents();
  }

  setRodPosition(x: number, y: number): void {
    this.rodX = x;
    this.rodY = y;
  }

  getRodX(): number { return this.rodX; }
  getRodY(): number { return this.rodY; }

  /** 씬별 물 타일 판정 콜백 등록 */
  setWaterChecker(fn: (px: number, py: number) => boolean): void {
    this.waterChecker = fn;
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    this.fishing.on('chargingStart',  () => this.showPowerGauge());
    this.fishing.on('chargingUpdate', (p: number) => this.updatePowerGauge(p));
    this.fishing.on('chargingCancel', () => this.hideUI());

    this.fishing.on('cast', (power: number, angle: number) => this.startCast(power, angle));
    this.fishing.on('splash', (landed: boolean) => {
      if (landed) this.playSplash();
      else        this.playMisscast();
    });

    this.fishing.on('floatStart',  () => this.startFloat());
    this.fishing.on('biteWarning', () => this.playBiteWarning());
    this.fishing.on('bite',        () => this.playBite());
    this.fishing.on('fightStart',  () => this.showFightUI());
    this.fishing.on('tensionUpdate', (t: number)  => this.updateTension(t));
    this.fishing.on('catchUpdate',   (g: number)  => this.updateCatchGauge(g));
    this.fishing.on('fishAIState',   (s: FishAIState) => this.onFishAI(s));

    this.fishing.on('catch', (fishId: string) => this.showCatchResult(fishId));
    this.fishing.on('fail',  (r: FailReason)  => this.showFailResult(r));
    this.fishing.on('reset', () => this.hideUI());
  }

  // ── 힘 게이지 ─────────────────────────────────────────────────

  private powerBg!:   Phaser.GameObjects.Rectangle;
  private powerBar:   Phaser.GameObjects.Rectangle | null = null;
  private powerLabel!:Phaser.GameObjects.Text;

  private showPowerGauge(): void {
    this.hideUI();
    const W  = this.scene.cameras.main.width;
    const H  = this.scene.cameras.main.height;
    const cx = W / 2;
    const y  = H - 80;

    const bg    = this.scene.add.rectangle(cx, y, GAUGE_W + 4, GAUGE_H + 4, 0x1a1a2e, 0.9)
      .setScrollFactor(0).setDepth(20);
    this.powerBg  = this.scene.add.rectangle(cx, y, GAUGE_W, GAUGE_H, 0x333333)
      .setScrollFactor(0).setDepth(21);
    this.powerBar = this.scene.add.rectangle(cx - GAUGE_W/2, y, 0, GAUGE_H, 0x44dd44)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(22);
    this.powerLabel = this.scene.add.text(cx, y - 20, '힘 충전 중... (손 떼면 던지기)', {
      fontSize: '11px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(22);

    this.uiContainer = this.scene.add.container(0, 0, [bg, this.powerBg, this.powerBar, this.powerLabel])
      .setDepth(20);
  }

  private updatePowerGauge(power: number): void {
    if (!this.powerBar) return;
    this.powerBar.setSize(GAUGE_W * power, GAUGE_H);

    // 색상: 초반 초록 → 후반 빨강
    // 색상 직접 보간 (0~0.7: 초록→주황, 0.7~1: 주황→빨강)
    let barColor: number;
    if (power < 0.7) {
      const t   = power / 0.7;
      const r   = Math.round(68  + (255 - 68)  * t);
      const g   = Math.round(221 + (153 - 221) * t);
      barColor  = Phaser.Display.Color.GetColor(r, g, 68);
    } else {
      const t   = (power - 0.7) / 0.3;
      const r   = 255;
      const g   = Math.round(153 + (50 - 153) * t);
      barColor  = Phaser.Display.Color.GetColor(r, g, 50);
    }
    this.powerBar.setFillStyle(barColor);
  }

  // ── 찌 던지기 ─────────────────────────────────────────────────

  private startCast(power: number, angle: number): void {
    this.hideUI();
    this.destroyBobber();

    // 속도 축소 (200+power*400 → 100+power*180)
    const speed  = 100 + power * 180;
    this.velX    = Math.cos(angle) * speed;
    this.velY    = Math.sin(angle) * speed;

    // 찌 시작 위치 (화면 좌표 — rodX/Y는 이미 화면 좌표)
    this.bobberX = this.rodX;
    this.bobberY = this.rodY;
    this.isOnWater = false;

    // 찌 생성 (HUDScene이라 setScrollFactor(0) 필요 없음 — 화면 좌표로 직접 렌더링)
    this.bobberCircle = this.scene.add.circle(this.bobberX, this.bobberY, 5, 0xff4444)
      .setDepth(8).setScrollFactor(0);
    this.line    = this.scene.add.graphics().setDepth(7).setScrollFactor(0);
    this.ripples = this.scene.add.graphics().setDepth(6).setScrollFactor(0);
    this.bobber  = this.scene.add.container(0, 0, [this.bobberCircle]).setDepth(8);
  }

  private destroyBobber(): void {
    this.bobber?.destroy();
    this.line?.destroy();
    this.ripples?.destroy();
    this.bobber       = null;
    this.bobberCircle = null;
    this.line         = null;
    this.ripples      = null;
  }

  // ── 착수 연출 ─────────────────────────────────────────────────

  private playSplash(): void {
    this.isOnWater = true;
    this.floatBase = this.bobberY;
    this.floatT    = 0;

    // 파티클 (물 튀김)
    for (let i = 0; i < 8; i++) {
      const angle    = (i / 8) * Math.PI * 2;
      const dist     = Phaser.Math.Between(10, 25);
      const particle = this.scene.add.circle(
        this.bobberX, this.bobberY, 3, 0x88ccff, 0.8
      ).setDepth(9);
      this.scene.tweens.add({
        targets:  particle,
        x:        this.bobberX + Math.cos(angle) * dist,
        y:        this.bobberY + Math.sin(angle) * dist - 10,
        alpha:    0,
        duration: 400,
        onComplete: () => particle.destroy(),
      });
    }

    // 찌 진동 (부력)
    this.velY = 0;
    this.scene.tweens.add({
      targets:   this,
      bobberY:   this.floatBase - 15,
      duration:  150,
      ease:      'Power2',
      yoyo:      true,
      onComplete: () => { this.velX = 0; this.velY = 0; },
    });
  }

  private playMisscast(): void {
    // 모래 파티클
    for (let i = 0; i < 4; i++) {
      const particle = this.scene.add.circle(
        this.bobberX, this.bobberY, 3, 0xd4b483, 0.8
      ).setDepth(9);
      this.scene.tweens.add({
        targets:  particle,
        y:        this.bobberY - 20,
        alpha:    0,
        duration: 300,
        onComplete: () => particle.destroy(),
      });
    }
    this.scene.time.delayedCall(400, () => this.destroyBobber());
  }

  // ── 부유 ──────────────────────────────────────────────────────

  private startFloat(): void {
    this.floatBase = this.bobberY;
    this.floatT    = 0;
  }

  // ── 입질 연출 ─────────────────────────────────────────────────

  private playBiteWarning(): void {
    if (!this.bobberCircle) return;
    // 예비 입질: 작은 좌우 흔들림
    this.scene.tweens.add({
      targets:  this.bobberCircle,
      x:        3,
      duration: 80,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   2,
    });
  }

  private playBite(): void {
    if (!this.bobberCircle) return;
    // 확정 입질: 찌 잠수
    this.scene.tweens.add({
      targets:  this.bobberCircle,
      y:        this.bobberCircle.y + 12,
      duration: 200,
      ease:     'Power3',
    });
    // 리플 강하게
    this.drawRipple(this.bobberX, this.bobberY, 0xff8800, 20);
  }

  // ── 줄다리기 UI ───────────────────────────────────────────────

  private tensionBg!:   Phaser.GameObjects.Rectangle;
  private tensionBar:   Phaser.GameObjects.Rectangle | null = null;
  private tensionSafe!: Phaser.GameObjects.Rectangle;
  private catchBg!:     Phaser.GameObjects.Rectangle;
  private catchBar:     Phaser.GameObjects.Rectangle | null = null;
  private holdHint!:    Phaser.GameObjects.Text;

  private showFightUI(): void {
    this.hideUI();
    const W  = this.scene.cameras.main.width;
    const H  = this.scene.cameras.main.height;
    const cx = W / 2;

    // 텐션 게이지
    const tensionY = H - 100;
    const tLabel   = this.scene.add.text(cx, tensionY - 20, '텐션', {
      fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.tensionBg = this.scene.add.rectangle(cx, tensionY, GAUGE_W + 4, GAUGE_H + 4, 0x1a1a2e, 0.9)
      .setScrollFactor(0).setDepth(20);

    // 안전 구간 표시
    const safeX = cx - GAUGE_W/2 + GAUGE_W * (FISHING_CONFIG.TENSION_SAFE_LOW / 100);
    const safeW = GAUGE_W * ((FISHING_CONFIG.TENSION_SAFE_HIGH - FISHING_CONFIG.TENSION_SAFE_LOW) / 100);
    this.tensionSafe = this.scene.add.rectangle(safeX + safeW/2, tensionY, safeW, GAUGE_H, 0x44aa44, 0.3)
      .setScrollFactor(0).setDepth(21);

    this.tensionBar = this.scene.add.rectangle(cx - GAUGE_W/2, tensionY, GAUGE_W/2, GAUGE_H, 0x4488ff)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(22);

    // 안전 구간 라벨
    const safeLabel = this.scene.add.text(cx, tensionY, '안전', {
      fontSize: '9px', color: '#44ff44',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(23);

    // 포획 게이지
    const catchY = H - 65;
    const cLabel = this.scene.add.text(cx, catchY - 18, '포획 게이지', {
      fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.catchBg = this.scene.add.rectangle(cx, catchY, GAUGE_W + 4, GAUGE_H + 4, 0x1a1a2e, 0.9)
      .setScrollFactor(0).setDepth(20);
    this.catchBar = this.scene.add.rectangle(cx - GAUGE_W/2, catchY, GAUGE_W, GAUGE_H, 0xf9c74f)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(22);

    this.holdHint = this.scene.add.text(cx, H - 30, '[홀드] 키를 눌러 텐션 유지', {
      fontSize: '10px', color: '#888888',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.uiContainer = this.scene.add.container(0, 0, [
      tLabel, this.tensionBg, this.tensionSafe, this.tensionBar, safeLabel,
      cLabel, this.catchBg, this.catchBar, this.holdHint,
    ]).setDepth(20);
  }

  private updateTension(tension: number): void {
    if (!this.tensionBar) return;
    const w     = GAUGE_W * (tension / 100);
    this.tensionBar.setSize(w, GAUGE_H);

    const inSafe = tension >= FISHING_CONFIG.TENSION_SAFE_LOW
                && tension <= FISHING_CONFIG.TENSION_SAFE_HIGH;
    const color  = inSafe   ? 0x44dd44
                 : tension > FISHING_CONFIG.TENSION_SAFE_HIGH ? 0xff4444
                 : 0x4488ff;
    this.tensionBar.setFillStyle(color);

    // 위험 구간 카메라 흔들림
    if (tension > 85) {
      this.scene.cameras.main.shake(50, 0.003);
    }
  }

  private updateCatchGauge(gauge: number): void {
    if (!this.catchBar) return;
    const ratio = gauge / FISHING_CONFIG.CATCH_GAUGE_MAX;
    this.catchBar.setSize(GAUGE_W * ratio, GAUGE_H);
  }

  private onFishAI(state: FishAIState): void {
    // DASH → 물 튀김 파티클
    if (state === 'dash' && this.bobberCircle) {
      this.drawRipple(this.bobberX, this.bobberY, 0xff4444, 15);
    }
  }

  // ── 결과 ──────────────────────────────────────────────────────

  private showCatchResult(fishId: string): void {
    this.hideUI();
    const W  = this.scene.cameras.main.width;
    const H  = this.scene.cameras.main.height;
    const fish = FISH_DATA[fishId];

    const bg = this.scene.add.rectangle(W/2, H/2, 240, 80, 0x1a1a2e, 0.95)
      .setStrokeStyle(2, 0xf9c74f).setScrollFactor(0).setDepth(25);
    const txt = this.scene.add.text(W/2, H/2, `🎣 ${fish?.label ?? fishId} 낚음!`, {
      fontSize: '16px', color: '#f9c74f', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26);

    this.uiContainer = this.scene.add.container(0, 0, [bg, txt]).setDepth(25);

    // 1.5초 후 자동 닫기
    this.scene.time.delayedCall(1500, () => this.hideUI());
  }

  private showFailResult(reason: FailReason): void {
    this.hideUI();
    const W  = this.scene.cameras.main.width;
    const H  = this.scene.cameras.main.height;
    const msgs: Record<FailReason, string> = {
      line_break:   '줄이 끊어졌어요!',
      fish_escape:  '물고기가 도망갔어요!',
      misscast:     '헛손질...다시 시도해보세요.',
      overcharge:   '힘이 풀렸어요!',
    };

    const bg = this.scene.add.rectangle(W/2, H/2, 240, 60, 0x1a1a2e, 0.95)
      .setStrokeStyle(2, 0xff4444).setScrollFactor(0).setDepth(25);
    const txt = this.scene.add.text(W/2, H/2, msgs[reason], {
      fontSize: '13px', color: '#ff8888',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26);

    this.uiContainer = this.scene.add.container(0, 0, [bg, txt]).setDepth(25);
    this.scene.time.delayedCall(1000, () => this.hideUI());
    this.destroyBobber();
  }

  // ── 유틸 ──────────────────────────────────────────────────────

  private drawRipple(x: number, y: number, color: number, r: number): void {
    if (!this.ripples) return;
    const circle = this.scene.add.circle(x, y, r, color, 0.4).setDepth(7);
    this.scene.tweens.add({
      targets:  circle,
      scaleX:   2, scaleY: 2,
      alpha:    0,
      duration: 500,
      onComplete: () => circle.destroy(),
    });
  }

  private hideUI(): void {
    this.uiContainer?.destroy();
    this.uiContainer = null;
    this.powerBar    = null;
    this.tensionBar  = null;
    this.catchBar    = null;
  }

  // ── 매 프레임 업데이트 ────────────────────────────────────────

  update(delta: number): void {
    const dt    = delta / 1000;
    const state = this.fishing.getState();
    const camW  = this.scene.cameras.main.width;
    const camH  = this.scene.cameras.main.height;

    // 찌 포물선 이동 (cast 중)
    if (state === 'cast' && this.bobberCircle) {
      this.velY    += FISHING_CONFIG.BOBBER_GRAVITY * dt;
      this.bobberX += this.velX * dt;
      this.bobberY += this.velY * dt;
      this.bobberCircle.setPosition(this.bobberX, this.bobberY);

      // 착지 판정:
      // 1. 화면 밖으로 나간 경우
      // 2. 상승했다가 다시 하강 후 일정 속도 이하로 느려진 경우
      const outOfBounds = this.bobberX < -50 || this.bobberX > camW + 50
                       || this.bobberY > camH + 50;
      const hasLanded   = this.velY > 50 && Math.abs(this.velX) < 80;

      if (outOfBounds || hasLanded) {
        // 화면 좌표 → 월드 좌표 변환
        const gm        = this.scene.scene.get('GameManagerScene') as any;
        const mapKey    = gm?.currentMapKey;
        const mapScene  = mapKey ? this.scene.scene.get(mapKey) : null;
        const scrollX   = (mapScene as any)?.cameras?.main?.scrollX ?? 0;
        const scrollY   = (mapScene as any)?.cameras?.main?.scrollY ?? 0;

        const worldX = this.bobberX + scrollX;
        const worldY = this.bobberY + scrollY;

        const isWater = this.waterChecker
          ? this.waterChecker(worldX, worldY)
          : false;

        this.fishing.onLand(isWater);
        return;
      }
    }

    // 찌 부유 (float/bite 중)
    if ((state === 'float' || state === 'bite') && this.bobberCircle) {
      this.floatT += dt;
      const dy    = Math.sin(this.floatT * FISHING_CONFIG.BOBBER_FLOAT_FREQ) * FISHING_CONFIG.BOBBER_FLOAT_AMP;
      this.bobberCircle.setPosition(this.bobberX, this.floatBase + dy);

      // 리플 (주기적)
      if (Math.floor(this.floatT * 2) !== Math.floor((this.floatT - dt) * 2)) {
        this.drawRipple(this.bobberX, this.floatBase, 0x4488cc, 8);
      }
    }

    // 낚싯줄 그리기
    if (this.line && this.bobberCircle) {
      this.line.clear();
      const tension  = this.fishing.getTension();
      const sag      = state === 'fight' ? (100 - tension) * 0.3 : 20;
      const midX     = (this.rodX + this.bobberX) / 2;
      const midY     = (this.rodY + this.bobberY) / 2 + sag;

      this.line.lineStyle(1, 0xccaa88, 0.8);
      this.line.beginPath();
      // 베지어 곡선 근사 (10 세그먼트)
      this.line.moveTo(this.rodX, this.rodY);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t  = i / steps;
        const bx = (1-t)*(1-t)*this.rodX + 2*(1-t)*t*midX + t*t*this.bobberX;
        const by = (1-t)*(1-t)*this.rodY + 2*(1-t)*t*midY + t*t*this.bobberY;
        this.line.lineTo(bx, by);
      }
      this.line.strokePath();
    }
  }

  destroy(): void {
    this.hideUI();
    this.destroyBobber();
    this.fishing.removeAllListeners();
  }
}