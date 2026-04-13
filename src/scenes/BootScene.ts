// ================================================================
// BootScene — 에셋 로딩 + 저장 데이터 확인 후 GameManagerScene으로 전달
// ================================================================
//
// 흐름:
//   1. 에셋 preload
//   2. SaveSystem 초기화 + 저장 데이터 로딩
//   3. GameManagerScene을 launch (Additive) + 데이터 전달
//   4. 손상 데이터 → 복구 UI 표시
//
// BootScene은 GameManagerScene 실행 후 sleep 상태로 대기.
// ================================================================

import Phaser from 'phaser';
import { SaveSystem } from '../systems/SaveSystem';
import type { GameState, SaveData } from '../types';

export class BootScene extends Phaser.Scene {
  private saveSystem!: SaveSystem;

  constructor() {
    super({ key: 'BootScene' });
  }

  // ── 에셋 로딩 ─────────────────────────────────────────────────

  preload(): void {
    // TODO: 로딩 바 표시
    // this.load.image('logo', 'assets/logo.png');
    // this.load.tilemapTiledJSON('village', 'assets/maps/village.json');
  }

  // ── 초기화 ────────────────────────────────────────────────────

  async create(): Promise<void> {
    this.saveSystem = new SaveSystem();
    await this.saveSystem.init();

    const result = await this.saveSystem.load();

    if (result.success) {
      this.launchGame(result.data.state, result.data);
    } else if (result.reason === 'not_found') {
      // 새 게임 → 집 선택 후 GameManagerScene 실행
      // 지금은 기본값(북쪽)으로 바로 시작
      this.launchGame(createInitialGameState());
    } else if (result.reason === 'corrupted') {
      this.showCorruptedUI();
    } else {
      console.error('[BootScene] 알 수 없는 오류, 새 게임 시작');
      this.launchGame(createInitialGameState());
    }
  }

  // ── 게임 실행 ─────────────────────────────────────────────────

  private launchGame(state: GameState, saveData?: SaveData): void {
    // GameManagerScene + HUDScene을 Additive로 실행
    // GameManagerScene이 시스템 초기화와 첫 맵 씬 실행을 담당
    this.scene.launch('GameManagerScene', {
      gameState: state,
      saveSystem: this.saveSystem,
      savedAt: saveData?.savedAt ?? null,
    });

    // BootScene은 sleep (완전 종료 X, 필요시 재활용 가능)
    this.scene.sleep('BootScene');
  }

  // ── 손상 데이터 UI ────────────────────────────────────────────

  private showCorruptedUI(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    this.add.rectangle(cx, cy, width, height, 0x000000, 0.7);
    this.add.rectangle(cx, cy, 480, 260, 0x1a1a2e, 1)
      .setStrokeStyle(2, 0xe74c3c);

    this.add.text(cx, cy - 90, '저장 데이터 손상', {
      fontSize: '22px', color: '#e74c3c', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 40,
      '저장 데이터가 손상되어 불러올 수 없어요.\n손상된 데이터는 안전하게 백업해두었어요.',
      { fontSize: '14px', color: '#cccccc', align: 'center', lineSpacing: 6 }
    ).setOrigin(0.5);

    this.createButton(cx - 110, cy + 50, '새 게임 시작', 0x27ae60, () => {
      this.saveSystem.delete().then(() => {
        this.launchGame(createInitialGameState());
      });
    });

    this.createButton(cx + 110, cy + 50, '백업 내보내기', 0x2980b9, () => {
      this.exportBackup();
    });
  }

  private createButton(x: number, y: number, label: string, color: number, onClick: () => void): void {
    const btn = this.add.rectangle(x, y, 180, 44, color, 1)
      .setInteractive({ useHandCursor: true });
    this.add.text(x, y, label, { fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    btn.on('pointerover',  () => btn.setAlpha(0.8));
    btn.on('pointerout',   () => btn.setAlpha(1.0));
    btn.on('pointerdown',  onClick);
  }

  private async exportBackup(): Promise<void> {
    const json = await this.saveSystem.exportBackup();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `farm_diary_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ── 초기 게임 상태 생성 ──────────────────────────────────────────

export function createInitialGameState(
  houseLocation: GameState['houseLocation'] = 'north'
): GameState {
  return {
    houseLocation,
    time: {
      day: 1, hour: 6, minute: 0,
      season: 'spring', weather: 'sunny', totalDays: 1,
    },
    energy: 500, maxEnergy: 500, gold: 500,
    farmTiles: [],
    farmLevel: { level: 1, exp: 0 },
    tools: [
      { id: 'hoe_default',         type: 'hoe',         durability: 250, maxDurability: 500, isRepairing: false },
      { id: 'wateringCan_default', type: 'wateringCan', durability: 250, maxDurability: 500, isRepairing: false },
      { id: 'sickle_default',      type: 'sickle',      durability: 250, maxDurability: 500, isRepairing: false },
    ],
    inventory: {
      slots: Array(20).fill(null),
      quickSlots: [null, null, null],
      equippedSlotIndex: null,
    },
    npcs: {
      farmer:     { id: 'farmer',     affection: 0, isCoopUnlocked: false, isEventDone: false, giftsGivenThisWeek: 0, lastTalkedDay: 0, coopUsedToday: false },
      merchant:   { id: 'merchant',   affection: 0, isCoopUnlocked: false, isEventDone: false, giftsGivenThisWeek: 0, lastTalkedDay: 0, coopUsedToday: false },
      mayor:      { id: 'mayor',      affection: 0, isCoopUnlocked: false, isEventDone: false, giftsGivenThisWeek: 0, lastTalkedDay: 0, coopUsedToday: false },
      blacksmith: { id: 'blacksmith', affection: 0, isCoopUnlocked: false, isEventDone: false, giftsGivenThisWeek: 0, lastTalkedDay: 0, coopUsedToday: false },
      doctor:     { id: 'doctor',     affection: 0, isCoopUnlocked: false, isEventDone: false, giftsGivenThisWeek: 0, lastTalkedDay: 0, coopUsedToday: false },
    },
    records: {
      old_farming_journal: { id: 'old_farming_journal', isCollected: false, isDonated: false, collectedDay: 0 },
      school_photo:        { id: 'school_photo',        isCollected: false, isDonated: false, collectedDay: 0 },
      rusty_tool:          { id: 'rusty_tool',          isCollected: false, isDonated: false, collectedDay: 0 },
      village_map:         { id: 'village_map',         isCollected: false, isDonated: false, collectedDay: 0 },
      child_drawing:       { id: 'child_drawing',       isCollected: false, isDonated: false, collectedDay: 0 },
      rice_record:         { id: 'rice_record',         isCollected: false, isDonated: false, collectedDay: 0 },
      fishing_notebook:    { id: 'fishing_notebook',    isCollected: false, isDonated: false, collectedDay: 0 },
      mayor_record:        { id: 'mayor_record',        isCollected: false, isDonated: false, collectedDay: 0 },
      merchant_ledger:     { id: 'merchant_ledger',     isCollected: false, isDonated: false, collectedDay: 0 },
      last_letter:         { id: 'last_letter',         isCollected: false, isDonated: false, collectedDay: 0 },
    },
    library:          { stage: 0, donatedRecordIds: [] },
    museum:           { donatedItemIds: [] },
    harvestDrops:     [],
    droppedItems:     [],
    holes:            [],
    groundShapes:     [],
    recordContainers: [],
    furniture:        [],
    washCount:        0,
    recordBook:       [],
    herbObjects:      [],
    receivedStarterTools: false,
    isSleeping:       false,
  };
}