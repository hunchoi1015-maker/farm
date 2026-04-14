// ================================================================
// HUDScene — 영구 오버레이 씬 (Additive Scene Loading)
// ================================================================
//
// 레이아웃:
//   상단: [날씨] [계절·날짜] [시각] [골드]
//   하단: [기력 바] [퀵슬롯 3칸]
//   우측 하단: 알림 토스트 (스택)
//
// 페이드인/아웃:
//   GameManagerScene.switchMap() 호출 시 fadeOut/fadeIn 제공
//
// 이벤트 구독:
//   TimeSystem  'hourChanged'    → 시각 업데이트
//   TimeSystem  'dayChanged'     → 날짜·계절 업데이트
//   TimeSystem  'weatherChanged' → 날씨 아이콘 업데이트
//   EnergySystem 'energyChanged' → 기력 바 업데이트
//   EnergySystem 'energyInsufficient' → 알림 표시
//   EconomySystem 'goldChanged'  → 골드 업데이트
//   ToolSystem  'toolBroken'     → 도구 파손 알림
//   ToolSystem  'toolUsed'       → 내구도 바 업데이트
//   GameManagerScene 'saveDone'  → 저장 완료 알림
//   GameManagerScene 'saveFailed'→ 저장 실패 알림
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from './GameManagerScene';
import { SCENE_KEYS } from './GameManagerScene';
import type { Tool } from '../types';
import { InventoryUI } from '../ui/InventoryUI';
import { FishingUI } from '../ui/FishingUI';

// ── 상수 ────────────────────────────────────────────────────────

const W = 960;
const H = 540;

const COLOR = {
  BG_DARK:      0x1a1a2e,
  BG_PANEL:     0x16213e,
  ENERGY_HIGH:  0x4caf50,
  ENERGY_MID:   0xff9800,
  ENERGY_LOW:   0xf44336,
  DURABILITY_H: 0x4caf50,
  DURABILITY_M: 0xff9800,
  DURABILITY_L: 0xf44336,
  GOLD:         0xf9c74f,
  WHITE:        0xffffff,
  SLOT_ACTIVE:  0xf9c74f,
  TOAST_BG:     0x1a1a2e,
  TOAST_OK:     0x27ae60,
  TOAST_WARN:   0xe74c3c,
  TOAST_INFO:   0x2980b9,
} as const;

const TOAST_DURATION = 2500; // ms
const TOAST_MAX      = 4;    // 최대 동시 표시 개수
const FADE_MS        = 300;

// ── Toast 타입 ───────────────────────────────────────────────────

type ToastType = 'ok' | 'warn' | 'info';

interface Toast {
  container: Phaser.GameObjects.Container;
  timer: Phaser.Time.TimerEvent;
}

// ── HUDScene ─────────────────────────────────────────────────────

export class HUDScene extends Phaser.Scene {
  private gm!: GameManagerScene;

  // ── 상단 UI ──────────────────────────────────────────────────
  private txtWeather!:  Phaser.GameObjects.Text;
  private txtDate!:     Phaser.GameObjects.Text;
  private txtTime!:     Phaser.GameObjects.Text;
  private txtGold!:     Phaser.GameObjects.Text;

  // ── 기력 바 ──────────────────────────────────────────────────
  private energyBar!:   Phaser.GameObjects.Rectangle;
  private energyBg!:    Phaser.GameObjects.Rectangle;
  private txtEnergy!:   Phaser.GameObjects.Text;

  // ── 퀵슬롯 ───────────────────────────────────────────────────
  private quickSlotContainers: Phaser.GameObjects.Container[] = [];
  private quickSlotFrames:     Phaser.GameObjects.Rectangle[]  = [];
  private quickSlotLabels:     Phaser.GameObjects.Text[]       = [];
  private quickSlotDurBars:    Phaser.GameObjects.Rectangle[]  = [];
  private quickSlotDurBgs:     Phaser.GameObjects.Rectangle[]  = [];

  // ── 토스트 ───────────────────────────────────────────────────
  private toasts: Toast[] = [];

  // ── 페이드 오버레이 ──────────────────────────────────────────
  private fadeRect!: Phaser.GameObjects.Rectangle;
  private inventoryUI!: InventoryUI;
  private fishingUI!: FishingUI;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: 'HUDScene' });
  }

  // ── 생성 ──────────────────────────────────────────────────────

  create(): void {
    this.gm = this.scene.get('GameManagerScene') as GameManagerScene;

    // HUD 카메라는 절대 움직이지 않도록 고정
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);

    // 다른 씬 위에 렌더링되도록 depth 설정
    this.scene.bringToTop();

    this.buildTopBar();
    this.buildEnergyBar();
    this.buildQuickSlots();
    this.buildFadeOverlay();

    this.subscribeEvents();

    // 시스템이 준비된 후 refreshAll + UI 초기화
    this.time.delayedCall(100, () => {
      this.refreshAll();
      this.inventoryUI = new InventoryUI(this);

      // FishingSystem 연결 (GameManagerScene에서 전역 관리)
      const gm = this.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;
      gm.fishingSystem.init(this);
      this.fishingUI = new FishingUI(this, gm.fishingSystem);
      this.spaceKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.setupFishingInput();

      // catch/fail 게임 로직은 HUDScene에서 전역 처리
      gm.fishingSystem.on('catch', (fishId: string) => {
        const added = gm.inventorySystem.addItem({
          itemId: fishId, itemType: 'fish' as any,
          condition: 'normal', quantity: 1,
        });
        if (!added) this.showToast('인벤토리가 꽉 찼어요.', 'warn');
        gm.recordSystem.tryFishingDrop();
      });
    });

    console.log('[HUDScene] 초기화 완료');
  }

  // ── 상단 바 ───────────────────────────────────────────────────

  private buildTopBar(): void {
    this.add.rectangle(W / 2, 20, W, 40, COLOR.BG_PANEL, 0.85)
      .setDepth(10).setScrollFactor(0);

    this.txtWeather = this.add.text(16, 20, '', {
      fontSize: '14px', color: '#ffffff',
    }).setOrigin(0, 0.5).setDepth(11).setScrollFactor(0);

    this.txtDate = this.add.text(90, 20, '', {
      fontSize: '14px', color: '#a8d8a8',
    }).setOrigin(0, 0.5).setDepth(11).setScrollFactor(0);

    this.txtTime = this.add.text(W / 2, 20, '', {
      fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5, 0.5).setDepth(11).setScrollFactor(0);

    this.txtGold = this.add.text(W - 16, 20, '', {
      fontSize: '14px', color: '#f9c74f',
    }).setOrigin(1, 0.5).setDepth(11).setScrollFactor(0);
  }

  // ── 기력 바 ───────────────────────────────────────────────────

  private buildEnergyBar(): void {
    const y      = H - 36;
    const barX   = 16;
    const barW   = 200;
    const barH   = 14;

    this.add.rectangle(W / 2, H - 20, W, 44, COLOR.BG_PANEL, 0.85)
      .setDepth(10).setScrollFactor(0);

    this.energyBg = this.add.rectangle(barX + barW / 2, y, barW, barH, 0x333333)
      .setDepth(11).setScrollFactor(0);

    this.energyBar = this.add.rectangle(barX, y, barW, barH, COLOR.ENERGY_HIGH)
      .setOrigin(0, 0.5).setDepth(12).setScrollFactor(0);

    this.txtEnergy = this.add.text(barX + barW + 8, y, '', {
      fontSize: '12px', color: '#ffffff',
    }).setOrigin(0, 0.5).setDepth(11).setScrollFactor(0);
  }

  // ── 퀵슬롯 ───────────────────────────────────────────────────

  private buildQuickSlots(): void {
    const slotSize = 48;
    const gap      = 8;
    const startX   = W / 2 - (slotSize * 3 + gap * 2) / 2;
    const y        = H - 24;

    for (let i = 0; i < 3; i++) {
      const x = startX + i * (slotSize + gap);

      const container = this.add.container(x, y).setDepth(11).setScrollFactor(0);

      // 슬롯 배경
      const bg = this.add.rectangle(0, 0, slotSize, slotSize, COLOR.BG_DARK)
        .setStrokeStyle(1.5, 0x444444);

      // 강조 테두리 (장착 시 표시)
      const frame = this.add.rectangle(0, 0, slotSize, slotSize, 0x000000, 0)
        .setStrokeStyle(2.5, COLOR.SLOT_ACTIVE);
      frame.setVisible(false);

      // 도구 이름 라벨
      const label = this.add.text(0, -4, '', {
        fontSize: '11px', color: '#ffffff',
      }).setOrigin(0.5, 0.5);

      // 내구도 바 배경
      const durBg = this.add.rectangle(0, slotSize / 2 - 5, slotSize - 6, 4, 0x333333);

      // 내구도 바
      const durBar = this.add.rectangle(-(slotSize / 2 - 3), slotSize / 2 - 5, slotSize - 6, 4, COLOR.DURABILITY_H)
        .setOrigin(0, 0.5);

      // 슬롯 번호 표시 (빈 슬롯)
      const numLabel = this.add.text(0, 0, `${i + 1}`, {
        fontSize: '16px', color: '#555555',
      }).setOrigin(0.5, 0.5);

      container.add([bg, frame, durBg, durBar, label, numLabel]);

      // 클릭으로 슬롯 선택
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        this.gm.inventorySystem.setEquippedSlot(i);
        this.refreshQuickSlots();
      });

      this.quickSlotContainers.push(container);
      this.quickSlotFrames.push(frame);
      this.quickSlotLabels.push(label);
      this.quickSlotDurBars.push(durBar);
      this.quickSlotDurBgs.push(durBg);
    }
  }

  setFishingWaterChecker(fn: (px: number, py: number) => boolean): void {
    this.fishingUI?.setWaterChecker(fn);
  }

  getFishingUI(): FishingUI { return this.fishingUI; }

  update(_time: number, delta: number): void {
    if (!this.fishingUI || !this.gm?.fishingSystem) return;
    this.fishingUI.update(delta);
    const fs = this.gm.fishingSystem;
    fs.updateCharging();
    if (fs.getState() === 'fight') {
      fs.setHolding(this.spaceKey?.isDown ?? false);
      fs.updateFight(delta);
    }
  }

  // ── 낚시 pointerup 전역 처리 ──────────────────────────────────

  private setupFishingInput(): void {
    // canvas에 직접 mouseup 이벤트 등록 (모든 씬에서 동작)
    const canvas = this.game.canvas;

    canvas.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button !== 2) return;
      const fs = this.gm?.fishingSystem;
      if (!fs || fs.getState() !== 'charging') return;

      // 캔버스 내 마우스 좌표 계산
      const rect   = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top)  * scaleY;

      const rodX = this.fishingUI?.getRodX?.() ?? mouseX;
      const rodY = this.fishingUI?.getRodY?.() ?? mouseY;
      const dx   = mouseX - rodX;
      const dy   = mouseY - rodY;

      fs.release('sea', { dx, dy });
    });
  }

  // ── 페이드 오버레이 ───────────────────────────────────────────

  private buildFadeOverlay(): void {
    this.fadeRect = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0)
      .setDepth(100).setScrollFactor(0);
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private subscribeEvents(): void {
    const { timeSystem, energySystem, economySystem, toolSystem } = this.gm;

    timeSystem.on('hourChanged',     () => this.refreshTime());
    timeSystem.on('dayChanged',      () => this.refreshDate());
    timeSystem.on('weatherChanged',  () => this.refreshWeather());

    energySystem.on('energyChanged', () => this.refreshEnergy());
    energySystem.on('energyInsufficient', () => {
      this.showToast('기력이 부족해요!', 'warn');
    });
    energySystem.on('energyDepleted', () => {
      this.showToast('기력이 모두 소진됐어요. 쉬어가세요.', 'warn');
    });

    economySystem.on('goldChanged', () => this.refreshGold());

    toolSystem.on('toolBroken', (toolId: string) => {
      this.showToast(`도구가 파손됐어요! 수리가 필요해요.`, 'warn');
      this.refreshQuickSlots();
    });
    toolSystem.on('toolUsed', () => this.refreshQuickSlots());
    toolSystem.on('repairComplete', () => {
      this.showToast('수리가 완료됐어요! 대장간에서 찾아가세요.', 'info');
    });

    this.gm.inventorySystem.on('inventoryChanged', () => this.refreshQuickSlots());

    // GameManagerScene 이벤트
    this.gm.events.on('saveDone',   () => this.showToast('저장 완료', 'ok'));
    this.gm.events.on('saveFailed', (reason: string) => {
      this.showToast(`저장 실패: ${reason}`, 'warn');
    });
  }

  // ── 전체 새로고침 ─────────────────────────────────────────────

  private refreshAll(): void {
    this.refreshWeather();
    this.refreshDate();
    this.refreshTime();
    this.refreshGold();
    this.refreshEnergy();
    this.refreshQuickSlots();
  }

  // ── 개별 새로고침 ─────────────────────────────────────────────

  private refreshWeather(): void {
    const w = this.gm.timeSystem.getTime().weather;
    this.txtWeather.setText(w === 'rainy' ? '비' : '맑음');
    this.txtWeather.setColor(w === 'rainy' ? '#78b4fa' : '#ffd166');
  }

  private refreshDate(): void {
    const t = this.gm.timeSystem.getTime();
    const seasonKo = { spring: '봄', summer: '여름', autumn: '가을' }[t.season];
    this.txtDate.setText(`${seasonKo} ${t.day}일`);
  }

  private refreshTime(): void {
    const { hour } = this.gm.timeSystem.getTime();
    const ampm     = hour < 12 ? '오전' : '오후';
    const h        = hour % 12 === 0 ? 12 : hour % 12;
    this.txtTime.setText(`${ampm} ${String(h).padStart(2, '0')}:00`);

    // 야간 패널티 구간(0~2시) → 시각 빨간색
    const isNight = this.gm.energySystem.isNightPenaltyActive();
    this.txtTime.setColor(isNight ? '#f44336' : '#ffffff');
  }

  private refreshGold(): void {
    const gold = this.gm.economySystem.getGold();
    this.txtGold.setText(`${gold.toLocaleString()}G`);
  }

  private refreshEnergy(): void {
    const cur = this.gm.energySystem.getCurrent();
    const max = this.gm.energySystem.getMax();
    const ratio = cur / max;
    const barW  = 200;

    this.energyBar.setSize(Math.max(0, barW * ratio), 14);

    const color = ratio > 0.6
      ? COLOR.ENERGY_HIGH
      : ratio > 0.3
        ? COLOR.ENERGY_MID
        : COLOR.ENERGY_LOW;
    this.energyBar.setFillStyle(color);

    this.txtEnergy.setText(`${cur} / ${max}`);
  }

  private refreshQuickSlots(): void {
    const quickSlots = this.gm.inventorySystem.getQuickSlots();
    const equipped   = this.gm.inventorySystem.getEquippedSlot();

    quickSlots.forEach((tool: Tool | null, i: number) => {
      const frame  = this.quickSlotFrames[i];
      const label  = this.quickSlotLabels[i];
      const durBar = this.quickSlotDurBars[i];

      // 장착 강조
      frame.setVisible(i === equipped);

      if (!tool) {
        label.setText('');
        durBar.setSize(0, 4);
        return;
      }

      // 도구 이름 약칭
      const nameMap: Record<string, string> = {
        hoe:         '괭이',
        wateringCan: '물뿌리개',
        sickle:      '낫',
        fishingRod:  '낚싯대',
      };
      label.setText(tool.isRepairing ? '수리중' : (nameMap[tool.type] ?? tool.type));
      label.setColor(tool.isRepairing ? '#aaaaaa' : '#ffffff');

      // 내구도 바
      const ratio   = tool.durability / tool.maxDurability;
      const maxBarW = 42;
      durBar.setSize(Math.max(0, maxBarW * ratio), 4);

      const durColor = ratio > 0.6
        ? COLOR.DURABILITY_H
        : ratio > 0.3
          ? COLOR.DURABILITY_M
          : COLOR.DURABILITY_L;
      durBar.setFillStyle(durColor);
    });
  }

  // ── 토스트 알림 ───────────────────────────────────────────────

  /**
   * 우측 하단에 토스트 메시지 표시.
   * 최대 TOAST_MAX개까지 스택으로 쌓임.
   */
  showToast(message: string, type: ToastType = 'info'): void {
    // 최대 개수 초과 시 가장 오래된 것 제거
    if (this.toasts.length >= TOAST_MAX) {
      this.removeToast(this.toasts[0]);
    }

    const toastH  = 36;
    const toastW  = 280;
    const padding = 8;
    const baseY   = H - 80;

    const idx = this.toasts.length;
    const y   = baseY - idx * (toastH + padding);

    // 배경
    const bgColor = type === 'ok'   ? COLOR.TOAST_OK
                  : type === 'warn' ? COLOR.TOAST_WARN
                  : COLOR.TOAST_INFO;

    const bg = this.add.rectangle(W - toastW / 2 - 16, y, toastW, toastH, COLOR.TOAST_BG, 0.92)
      .setStrokeStyle(1.5, bgColor)
      .setDepth(50);

    const txt = this.add.text(W - toastW - 8, y, message, {
      fontSize: '12px', color: '#ffffff',
      wordWrap: { width: toastW - 24 },
    }).setOrigin(0, 0.5).setDepth(51);

    const container = this.add.container(0, 0, [bg, txt]).setDepth(50);
    container.setAlpha(0);

    // 페이드인
    this.tweens.add({
      targets:  container,
      alpha:    1,
      duration: 200,
      ease:     'Power2',
    });

    // 자동 제거 타이머
    const timer = this.time.delayedCall(TOAST_DURATION, () => {
      this.removeToast(toast);
    });

    const toast: Toast = { container, timer };
    this.toasts.push(toast);
  }

  private removeToast(toast: Toast): void {
    const idx = this.toasts.indexOf(toast);
    if (idx === -1) return;

    toast.timer.remove();
    this.tweens.add({
      targets:  toast.container,
      alpha:    0,
      duration: 200,
      ease:     'Power2',
      onComplete: () => toast.container.destroy(),
    });

    this.toasts.splice(idx, 1);

    // 남은 토스트 위치 재정렬
    this.repositionToasts();
  }

  private repositionToasts(): void {
    const toastH  = 36;
    const padding = 8;
    const baseY   = H - 80;

    this.toasts.forEach((t, i) => {
      const targetY = baseY - i * (toastH + padding);
      this.tweens.add({
        targets:  t.container,
        y:        0, // container 자체는 고정, 내부 요소 y 조정
        duration: 150,
        ease:     'Power2',
      });
      // bg와 txt는 container 내 자식이므로 container y로 제어
      const [bg, txt] = t.container.list as [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text];
      this.tweens.add({ targets: bg,  y: targetY, duration: 150, ease: 'Power2' });
      this.tweens.add({ targets: txt, y: targetY, duration: 150, ease: 'Power2' });
    });
  }

  // ── 페이드인/아웃 ─────────────────────────────────────────────

  /**
   * GameManagerScene.switchMap()에서 호출.
   * 페이드 아웃 후 콜백 실행.
   */
  fadeOut(onComplete: () => void): void {
    this.tweens.add({
      targets:   this.fadeRect,
      alpha:     1,
      duration:  FADE_MS,
      ease:      'Power2',
      onComplete,
    });
  }

  /**
   * 씬 전환 완료 후 GameManagerScene에서 호출.
   */
  fadeIn(): void {
    this.tweens.add({
      targets:  this.fadeRect,
      alpha:    0,
      duration: FADE_MS,
      ease:     'Power2',
    });
  }
}