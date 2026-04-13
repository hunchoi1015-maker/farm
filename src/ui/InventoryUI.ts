// ================================================================
// InventoryUI — 인벤토리 + 기록 도감 탭 UI
// ================================================================
//
// 구조:
//   I키로 열고 닫기
//   [인벤토리] [기록 도감] 탭 전환
//
// 인벤토리 탭:
//   20개 슬롯 + 퀵슬롯 3개 표시
//   용기 아이템(book-xxx, bottle-xxx) 클릭 → 열기 확인 → 도감 이동
//
// 기록 도감 탭:
//   획득한 기록물 목록 표시
//   내용 + 기증 여부 + 스토리 텍스트
// ================================================================

import Phaser from 'phaser';
import type { GameManagerScene } from '../scenes/GameManagerScene';
import { SCENE_KEYS } from '../scenes/GameManagerScene';
import { RECORD_CONTENT_DATA } from '../data/records';

// ── 상수 ────────────────────────────────────────────────────────

const PANEL_W = 560;
const PANEL_H = 380;
const SLOT_SIZE = 44;
const SLOT_GAP  = 6;
const SLOT_COLS = 5;

type UITab = 'inventory' | 'recordBook';

// ── InventoryUI ──────────────────────────────────────────────────

export class InventoryUI {
  private scene:   Phaser.Scene;
  private gm:      GameManagerScene;
  private iKey!:   Phaser.Input.Keyboard.Key;

  private isOpen   = false;
  private activeTab: UITab = 'inventory';

  // UI 오브젝트
  private container: Phaser.GameObjects.Container | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.gm    = scene.scene.get(SCENE_KEYS.GAME_MANAGER) as GameManagerScene;

    this.iKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.iKey.on('down', () => this.toggle());
  }

  // ── 열기/닫기 ─────────────────────────────────────────────────

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  open(tab: UITab = this.activeTab): void {
    this.isOpen    = true;
    this.activeTab = tab;
    this.render();
  }

  close(): void {
    this.isOpen = false;
    this.container?.destroy();
    this.container = null;
  }

  isVisible(): boolean { return this.isOpen; }

  // ── 렌더링 ────────────────────────────────────────────────────

  private render(): void {
    this.container?.destroy();

    const W   = this.scene.cameras.main.width;
    const H   = this.scene.cameras.main.height;
    const cx  = W / 2;
    const cy  = H / 2;

    const objs: Phaser.GameObjects.GameObject[] = [];

    // 배경 오버레이
    const overlay = this.scene.add.rectangle(cx, cy, W, H, 0x000000, 0.5)
      .setScrollFactor(0).setDepth(30);
    overlay.setInteractive(); // 클릭 흡수

    // 패널 배경
    const panel = this.scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, 0x1a1a2e, 0.97)
      .setStrokeStyle(1.5, 0x888888).setScrollFactor(0).setDepth(31);

    // 닫기 버튼
    const closeBtn = this.scene.add.text(cx + PANEL_W / 2 - 8, cy - PANEL_H / 2 + 8, '✕', {
      fontSize: '14px', color: '#aaaaaa',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(32)
      .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => this.close());

    // 탭 버튼
    const tabY = cy - PANEL_H / 2 + 20;
    const invTabBtn = this.scene.add.text(cx - 60, tabY, '인벤토리', {
      fontSize: '13px',
      color: this.activeTab === 'inventory' ? '#f9c74f' : '#888888',
      fontStyle: this.activeTab === 'inventory' ? 'bold' : 'normal',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(32)
      .setInteractive({ useHandCursor: true });

    const recTabBtn = this.scene.add.text(cx + 60, tabY, '기록 도감', {
      fontSize: '13px',
      color: this.activeTab === 'recordBook' ? '#f9c74f' : '#888888',
      fontStyle: this.activeTab === 'recordBook' ? 'bold' : 'normal',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(32)
      .setInteractive({ useHandCursor: true });

    invTabBtn.on('pointerdown', () => { this.activeTab = 'inventory'; this.render(); });
    recTabBtn.on('pointerdown', () => { this.activeTab = 'recordBook'; this.render(); });

    // 구분선
    const divider = this.scene.add.rectangle(cx, tabY + 14, PANEL_W - 20, 1, 0x444444)
      .setScrollFactor(0).setDepth(32);

    objs.push(overlay, panel, closeBtn, invTabBtn, recTabBtn, divider);

    // 탭별 내용
    const contentObjs = this.activeTab === 'inventory'
      ? this.renderInventoryTab(cx, cy)
      : this.renderRecordBookTab(cx, cy);

    objs.push(...contentObjs);

    this.container = this.scene.add.container(0, 0, objs).setDepth(30);
  }

  // ── 인벤토리 탭 ───────────────────────────────────────────────

  private renderInventoryTab(cx: number, cy: number): Phaser.GameObjects.GameObject[] {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const slots     = this.gm.inventorySystem.getSlots();
    const quickSlots = this.gm.inventorySystem.getQuickSlots();
    const equipped  = this.gm.inventorySystem.getEquippedSlot();

    const startX = cx - PANEL_W / 2 + 30;
    const startY = cy - PANEL_H / 2 + 50;

    // 일반 슬롯 (20개, 5×4)
    slots.forEach((slot, idx) => {
      const col = idx % SLOT_COLS;
      const row = Math.floor(idx / SLOT_COLS);
      const x   = startX + col * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;
      const y   = startY + row * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;

      const bg = this.scene.add.rectangle(x, y, SLOT_SIZE, SLOT_SIZE, 0x2a2a4a)
        .setStrokeStyle(1, slot ? 0x888888 : 0x444444)
        .setScrollFactor(0).setDepth(32);

      objs.push(bg);

      if (slot) {
        const isContainer = slot.itemId.startsWith('book-') || slot.itemId.startsWith('bottle-');
        const label = isContainer
          ? (slot.itemId.startsWith('book-') ? '📖' : '🍶')
          : slot.itemId.slice(0, 4);

        const txt = this.scene.add.text(x, y - 4, label, {
          fontSize: isContainer ? '16px' : '9px',
          color: isContainer ? '#f9c74f' : '#ffffff',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(33);

        const qtyTxt = this.scene.add.text(x + SLOT_SIZE / 2 - 2, y + SLOT_SIZE / 2 - 2,
          slot.quantity > 1 ? String(slot.quantity) : '',
          { fontSize: '8px', color: '#aaaaaa' }
        ).setOrigin(1, 1).setScrollFactor(0).setDepth(33);

        objs.push(txt, qtyTxt);

        // 용기 아이템 클릭 → 열기 확인
        if (isContainer) {
          bg.setInteractive({ useHandCursor: true });
          bg.on('pointerover', () => bg.setStrokeStyle(2, 0xf9c74f));
          bg.on('pointerout',  () => bg.setStrokeStyle(1, 0x888888));
          bg.on('pointerdown', () => this.showOpenContainerConfirm(slot.itemId, idx));
        }
      }
    });

    // 퀵슬롯 라벨
    const qsLabel = this.scene.add.text(startX, startY + 4 * (SLOT_SIZE + SLOT_GAP) + 16, '퀵슬롯', {
      fontSize: '10px', color: '#888888',
    }).setScrollFactor(0).setDepth(32);
    objs.push(qsLabel);

    // 퀵슬롯 (3개)
    quickSlots.forEach((slot, idx) => {
      const x = startX + idx * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;
      const y = startY + 4 * (SLOT_SIZE + SLOT_GAP) + 36;

      const isEquipped = idx === equipped;
      const bg = this.scene.add.rectangle(x, y, SLOT_SIZE, SLOT_SIZE, 0x2a2a4a)
        .setStrokeStyle(isEquipped ? 2.5 : 1, isEquipped ? 0xf9c74f : 0x666666)
        .setScrollFactor(0).setDepth(32);

      objs.push(bg);

      if (slot) {
        const txt = this.scene.add.text(x, y, slot.type?.slice(0, 4) ?? '?', {
          fontSize: '9px', color: '#ffffff',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(33);
        objs.push(txt);
      }
    });

    // 도움말
    const help = this.scene.add.text(cx, cy + PANEL_H / 2 - 14, '용기 아이템을 클릭하면 열 수 있어요', {
      fontSize: '10px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(32);
    objs.push(help);

    return objs;
  }

  // ── 기록 도감 탭 ──────────────────────────────────────────────

  private renderRecordBookTab(cx: number, cy: number): Phaser.GameObjects.GameObject[] {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const entries = this.gm.recordSystem.getRecordBook();

    const startX = cx - PANEL_W / 2 + 24;
    const startY = cy - PANEL_H / 2 + 54;

    if (entries.length === 0) {
      const empty = this.scene.add.text(cx, cy, '아직 수집한 기록물이 없어요.\n용기를 열어 기록을 수집해보세요!', {
        fontSize: '12px', color: '#666666', align: 'center', lineSpacing: 6,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(32);
      objs.push(empty);
      return objs;
    }

    // 선택된 항목 상태
    let selectedIdx = 0;

    const renderEntries = () => {
      // 목록 (좌측)
      entries.forEach((entry, idx) => {
        const y   = startY + idx * 36;
        const data = RECORD_CONTENT_DATA[entry.contentId];
        const isDonated = entry.isDonated;

        const rowBg = this.scene.add.rectangle(
          startX + 120, y, 240, 32,
          idx === selectedIdx ? 0x2a3a5a : 0x222236, 0.9
        ).setStrokeStyle(1, idx === selectedIdx ? 0x4a6a9a : 0x333344)
          .setScrollFactor(0).setDepth(32)
          .setInteractive({ useHandCursor: true });

        const icon = entry.containerType === 'book' ? '📖' : '🍶';
        const rowTxt = this.scene.add.text(startX + 16, y, `${icon} ${data?.label ?? entry.contentId}`, {
          fontSize: '11px',
          color: isDonated ? '#888888' : '#ffffff',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(33);

        const donatedBadge = isDonated
          ? this.scene.add.text(startX + 234, y, '기증완료', {
              fontSize: '9px', color: '#4caf50',
            }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(33)
          : null;

        rowBg.on('pointerdown', () => {
          selectedIdx = idx;
          renderDetail(entry.contentId, entry.isDonated);
        });

        objs.push(rowBg, rowTxt);
        if (donatedBadge) objs.push(donatedBadge);
      });
    };

    const renderDetail = (contentId: string, isDonated: boolean) => {
      // 상세 (우측) — 기존 상세 영역 오브젝트 제거 후 재생성
      const data = RECORD_CONTENT_DATA[contentId];
      const detailX = startX + 270;

      const titleTxt = this.scene.add.text(detailX, startY, data?.label ?? contentId, {
        fontSize: '13px', color: '#f9c74f', fontStyle: 'bold',
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(33);

      const storyTxt = this.scene.add.text(detailX, startY + 28, data?.story ?? '', {
        fontSize: '11px', color: '#cccccc',
        wordWrap: { width: 220 }, lineSpacing: 4,
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(33);

      objs.push(titleTxt, storyTxt);

      if (!isDonated) {
        // 기증 안내 (LibraryScene에서 기증 가능)
        const donateHint = this.scene.add.text(detailX, startY + 120,
          '도서관에서 기증할 수 있어요.', {
            fontSize: '10px', color: '#888888',
          }).setScrollFactor(0).setDepth(33);
        objs.push(donateHint);
      }
    };

    renderEntries();
    if (entries.length > 0) {
      renderDetail(entries[0].contentId, entries[0].isDonated);
    }

    return objs;
  }

  // ── 용기 열기 확인 UI ─────────────────────────────────────────

  private showOpenContainerConfirm(itemId: string, slotIndex: number): void {
    const W  = this.scene.cameras.main.width;
    const H  = this.scene.cameras.main.height;
    const cx = W / 2;
    const cy = H / 2;

    const isBook   = itemId.startsWith('book-');
    const typeName = isBook ? '낡은 책' : '병속의 배';

    const bg = this.scene.add.rectangle(cx, cy, 280, 120, 0x1a1a2e, 0.98)
      .setStrokeStyle(1.5, 0xf9c74f).setScrollFactor(0).setDepth(40);

    const txt = this.scene.add.text(cx, cy - 28, `${typeName}을 열까요?`, {
      fontSize: '13px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(41);

    const subTxt = this.scene.add.text(cx, cy - 8, '기록물이 기록 도감에 추가돼요', {
      fontSize: '10px', color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(41);

    const yesBtn = this.scene.add.text(cx - 50, cy + 28, '[열기]', {
      fontSize: '13px', color: '#aaffaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(41)
      .setInteractive({ useHandCursor: true });

    const noBtn = this.scene.add.text(cx + 50, cy + 28, '[취소]', {
      fontSize: '13px', color: '#ff9999',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(41)
      .setInteractive({ useHandCursor: true });

    const confirmContainer = this.scene.add.container(0, 0, [bg, txt, subTxt, yesBtn, noBtn])
      .setDepth(40);

    const cleanup = () => confirmContainer.destroy();

    yesBtn.on('pointerdown', () => {
      cleanup();
      const entry = this.gm.recordSystem.openContainerByItemId(itemId, slotIndex);
      const hud   = this.scene.scene.get(SCENE_KEYS.HUD) as any;

      if (entry) {
        const data = RECORD_CONTENT_DATA[entry.contentId];
        hud?.showToast?.(`기록 도감에 추가됐어요: ${data?.label}`, 'ok');
      } else {
        hud?.showToast?.('이미 모든 기록을 수집했어요.', 'info');
      }

      // UI 갱신
      this.render();
    });

    noBtn.on('pointerdown', cleanup);
  }
}