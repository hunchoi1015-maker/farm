// ================================================================
// RecordSystem — 기록물 수집 및 도서관 시스템
// ================================================================
//
// 기록물 구조:
//   용기(Container) → 책(땅 모양), 병속의 배(낚시)
//   내용(Content)   → 용기 안에 랜덤 배정되는 실제 기록물
//
// 땅 모양 규칙:
//   괭이질 시 1% 확률 생성, 맵 전체 최대 7개
//   플레이어가 캘 때까지 유지
//   모든 기록물 수집 후에도 계속 생성
//
// 도서관:
//   5개 기증 → 1단계 (딸기 씨앗 5개 보상)
//   10개 기증 → 2단계 (마지막 편지 해금)
//
// 발행 이벤트:
//   'groundShapeSpawned'  (tileId, shapeId)
//   'groundShapeRemoved'  (shapeId)
//   'containerObtained'   (container: RecordContainer)
//   'recordObtained'      (recordId, label)
//   'recordDonated'       (recordId)
//   'libraryStageUp'      (stage: 1 | 2, reward)
//   'lastLetterUnlocked'  ()
// ================================================================

import Phaser from 'phaser';
import type {
  GameState, GroundShape, RecordContainer,
  RecordItem, LibraryState, InventoryItem, RecordBookEntry,
} from '../types';
import type { InventorySystem } from './InventorySystem';
import {
  RECORD_CONTENT_DATA, CONTAINER_DATA,
  LIBRARY_REWARDS, NPC_RECORD_MAP,
  type ContainerType,
} from '../data/records';

// ── 상수 ────────────────────────────────────────────────────────

const GROUND_SHAPE_SPAWN_CHANCE = 0.01;  // 괭이질 1%
const FISHING_BOTTLE_CHANCE     = 0.03;  // 낚시 3%
const MAX_GROUND_SHAPES         = 7;     // 맵 전체 최대 개수

let shapeIdCounter     = 0;
let containerIdCounter = 0;

// ── RecordSystem ─────────────────────────────────────────────────

export class RecordSystem extends Phaser.Events.EventEmitter {
  private static instance: RecordSystem | null = null;

  private records:          Record<string, RecordItem>  = {};
  private library:          LibraryState                = { stage: 0, donatedRecordIds: [] };
  private groundShapes:     GroundShape[]               = [];
  private recordContainers: RecordContainer[]           = [];
  private recordBook:       RecordBookEntry[]           = [];  // 기록 도감
  private totalDays = 0;

  private inventorySystem!: InventorySystem;

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): RecordSystem {
    if (!RecordSystem.instance) {
      RecordSystem.instance = new RecordSystem();
    }
    return RecordSystem.instance;
  }

  static resetInstance(): void {
    RecordSystem.instance?.destroy();
    RecordSystem.instance = null;
  }

  private constructor() { super(); }

  // ── 초기화 ────────────────────────────────────────────────────

  init(
    state: Pick<GameState, 'records' | 'library' | 'groundShapes' | 'recordContainers' | 'recordBook' | 'time'>,
    inventorySystem: InventorySystem,
  ): void {
    this.records          = Object.fromEntries(
      Object.entries(state.records).map(([k, v]) => [k, { ...v }])
    );
    this.library          = { ...state.library, donatedRecordIds: [...state.library.donatedRecordIds] };
    this.groundShapes     = state.groundShapes.map(s => ({ ...s }));
    this.recordContainers = state.recordContainers.map(c => ({ ...c }));
    this.recordBook       = state.recordBook.map(e => ({ ...e }));
    this.totalDays        = state.time.totalDays;
    this.inventorySystem  = inventorySystem;

    console.log('[RecordSystem] 초기화 완료');
  }

  // ── 땅 모양 ───────────────────────────────────────────────────

  /**
   * 괭이질 시 호출. 1% 확률로 타일에 땅 모양 생성.
   * 이미 모양이 있거나 최대 개수(7개) 초과 시 생성 안 함.
   *
   * @param tileId 괭이질한 FarmTile id
   * @returns 생성된 GroundShape | null
   */
  trySpawnGroundShape(tileId: string): GroundShape | null {
    // 이미 해당 타일에 모양 있음
    if (this.groundShapes.some(s => s.tileId === tileId)) return null;

    // 최대 개수 초과
    if (this.groundShapes.length >= MAX_GROUND_SHAPES) return null;

    // 1% 확률 체크
    if (Math.random() >= GROUND_SHAPE_SPAWN_CHANCE) return null;

    const shape: GroundShape = {
      id:         `shape_${Date.now()}_${shapeIdCounter++}`,
      tileId,
      spawnedDay: this.totalDays,
    };

    this.groundShapes.push(shape);
    this.emit('groundShapeSpawned', tileId, shape.id);
    console.log(`[RecordSystem] 땅 모양 생성 — tileId: ${tileId}, 총 ${this.groundShapes.length}개`);
    return shape;
  }

  /**
   * 플레이어가 땅 모양을 캘 때 호출.
   * 용기(책)을 생성해 인벤토리에 추가.
   *
   * @param shapeId 캘 GroundShape id
   * @returns 획득한 RecordContainer | null
   */
  digGroundShape(shapeId: string): RecordContainer | null {
    const shape = this.groundShapes.find(s => s.id === shapeId);
    if (!shape) return null;

    // 땅 모양 제거
    this.groundShapes = this.groundShapes.filter(s => s.id !== shapeId);
    this.emit('groundShapeRemoved', shapeId);

    // 용기(책) 생성
    const container = this.createContainer('book');

    // 인벤토리에 '책-[containerId]' 형태로 추가
    this.inventorySystem.addItem({
      itemId:    `book-${container.id}`,
      itemType:  'container' as any,
      condition: 'normal',
      quantity:  1,
    });

    this.emit('containerObtained', { ...container });
    console.log(`[RecordSystem] 땅 모양 채굴 → 책 획득 (${container.id})`);
    return container;
  }

  // ── 낚시 드롭 ─────────────────────────────────────────────────

  /**
   * 낚시 완료 시 호출. 3% 확률로 병속의 배 획득.
   * @returns 획득한 RecordContainer | null
   */
  tryFishingDrop(): RecordContainer | null {
    if (Math.random() >= FISHING_BOTTLE_CHANCE) return null;

    const container = this.createContainer('bottle');

    this.inventorySystem.addItem({
      itemId:    `bottle-${container.id}`,
      itemType:  'container' as any,
      condition: 'normal',
      quantity:  1,
    });

    this.emit('containerObtained', { ...container });
    console.log(`[RecordSystem] 낚시 → 병속의 배 획득 (${container.id})`);
    return container;
  }

  // ── 용기 열기 ─────────────────────────────────────────────────

  /**
   * 인벤토리 아이템 id로 용기 열기.
   * itemId 형식: 'book-{containerId}' or 'bottle-{containerId}'
   * 열리면 도감에 추가, 인벤토리에서 제거.
   *
   * @param itemId 인벤토리 아이템 id
   * @param slotIndex 인벤토리 슬롯 인덱스
   * @returns 도감에 추가된 RecordBookEntry | null
   */
  openContainerByItemId(itemId: string, slotIndex: number): RecordBookEntry | null {
    // itemId에서 containerType과 containerId 파싱
    const [typeStr, ...rest] = itemId.split('-');
    const containerId = rest.join('-');

    if (typeStr !== 'book' && typeStr !== 'bottle') return null;
    const containerType = typeStr as 'book' | 'bottle';

    const container = this.recordContainers.find(c => c.id === containerId);
    if (!container || container.isOpened) return null;

    const containerData = CONTAINER_DATA[containerType];

    // 미수집 기록물 중 이 용기에 담길 수 있는 것 목록
    const available = containerData.availableContents.filter(
      recordId => !this.records[recordId]?.isCollected
    );

    let contentId: string | null = null;

    if (available.length > 0) {
      const randomIdx = Math.floor(Math.random() * available.length);
      contentId = available[randomIdx];
      this.collectRecord(contentId);
      container.contentRecordId = contentId;
    }

    container.isOpened = true;

    // 인벤토리에서 용기 제거
    this.inventorySystem.removeItem(slotIndex, 1);

    // 내용이 있을 때만 도감에 추가
    if (!contentId) {
      console.log(`[RecordSystem] 용기 열기 (${containerType}) → 이미 모든 기록 수집됨`);
      return null;
    }

    const entry: RecordBookEntry = {
      id:            `entry_${Date.now()}`,
      containerType,
      contentId,
      isDonated:     false,
      obtainedDay:   this.totalDays,
    };

    this.recordBook.push(entry);

    const data = RECORD_CONTENT_DATA[contentId];
    this.emit('recordBookAdded', entry, data?.label ?? contentId);
    console.log(`[RecordSystem] 용기 열기 (${containerType}) → 도감 추가: ${data?.label}`);
    return entry;
  }

  // ── 구버전 호환 (슬롯 인덱스 없이 containerId로 직접 호출) ──────
  openContainer(containerId: string): string | null {
    const container = this.recordContainers.find(c => c.id === containerId);
    if (!container || container.isOpened) return null;

    const containerData = CONTAINER_DATA[container.containerType];
    const available = containerData.availableContents.filter(
      recordId => !this.records[recordId]?.isCollected
    );

    let obtainedRecordId: string | null = null;

    if (available.length > 0) {
      const randomIdx      = Math.floor(Math.random() * available.length);
      obtainedRecordId     = available[randomIdx];
      this.collectRecord(obtainedRecordId);
      container.contentRecordId = obtainedRecordId;
    }

    container.isOpened = true;
    console.log(`[RecordSystem] openContainer → ${obtainedRecordId ?? '내용 없음'}`);
    return obtainedRecordId;
  }

  // ── 기록물 수집 ───────────────────────────────────────────────

  /** 기록물 수집 처리 (내부 공통 로직) */
  private collectRecord(recordId: string): void {
    if (!this.records[recordId]) {
      this.records[recordId] = {
        id:           recordId,
        isCollected:  false,
        isDonated:    false,
        collectedDay: 0,
      };
    }

    if (this.records[recordId].isCollected) return;

    this.records[recordId].isCollected  = true;
    this.records[recordId].collectedDay = this.totalDays;

    const data = RECORD_CONTENT_DATA[recordId];
    this.emit('recordObtained', recordId, data?.label ?? recordId);
    console.log(`[RecordSystem] 기록물 획득: ${data?.label ?? recordId}`);
  }

  /**
   * NPC 호감도 100 달성 시 호출.
   * 해당 NPC의 기록물 지급.
   */
  checkNpcRecord(npcId: string): void {
    const recordId = NPC_RECORD_MAP[npcId];
    if (!recordId) return;
    if (this.records[recordId]?.isCollected) return;

    this.collectRecord(recordId);
  }

  /**
   * 도서관 2단계 내부 상호작용 시 호출.
   * 마지막 편지 획득.
   */
  unlockLastLetter(): boolean {
    if (this.library.stage < 2) return false;
    if (this.records['last_letter']?.isCollected) return false;

    this.collectRecord('last_letter');
    this.emit('lastLetterUnlocked');
    return true;
  }

  // ── 도서관 기증 ───────────────────────────────────────────────

  /**
   * 기록물을 도서관에 기증.
   * 수집 완료 + 미기증 상태여야 함.
   * 5개/10개 기증 시 단계 성장 및 보상 지급.
   */
  donateRecord(recordId: string): boolean {
    const record = this.records[recordId];
    if (!record?.isCollected) return false;
    if (record.isDonated) return false;
    if (this.library.donatedRecordIds.includes(recordId)) return false;

    record.isDonated = true;
    this.library.donatedRecordIds.push(recordId);

    this.emit('recordDonated', recordId);

    const donatedCount = this.library.donatedRecordIds.length;
    console.log(`[RecordSystem] 기록물 기증: ${recordId} (총 ${donatedCount}개)`);

    // 단계 성장 체크
    this.checkLibraryStageUp(donatedCount);
    return true;
  }

  private checkLibraryStageUp(donatedCount: number): void {
    if (donatedCount === 5 && this.library.stage < 1) {
      this.library.stage = 1;
      const reward = LIBRARY_REWARDS[1];

      // 보상 지급: 딸기 씨앗 5개
      this.inventorySystem.addItem({
        itemId:    reward.itemId,
        itemType:  'seed',
        condition: 'normal',
        quantity:  reward.quantity,
      });

      this.emit('libraryStageUp', 1, reward);
      console.log('[RecordSystem] 도서관 1단계 달성 → 딸기 씨앗 5개 지급');
    }

    if (donatedCount === 10 && this.library.stage < 2) {
      this.library.stage = 2;
      const reward = LIBRARY_REWARDS[2];
      this.emit('libraryStageUp', 2, reward);
      console.log('[RecordSystem] 도서관 2단계 달성 → 마지막 편지 해금');
    }
  }

  // ── 유틸리티 ──────────────────────────────────────────────────

  private createContainer(type: ContainerType): RecordContainer {
    const container: RecordContainer = {
      id:              `container_${Date.now()}_${containerIdCounter++}`,
      containerType:   type,
      isOpened:        false,
      contentRecordId: null,
      obtainedDay:     this.totalDays,
    };
    this.recordContainers.push(container);
    return container;
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getRecords(): Readonly<Record<string, RecordItem>>  { return this.records; }
  getLibrary(): Readonly<LibraryState>                { return this.library; }
  getGroundShapes(): Readonly<GroundShape[]>          { return this.groundShapes; }
  getRecordContainers(): Readonly<RecordContainer[]>  { return this.recordContainers; }
  getRecordBook(): Readonly<RecordBookEntry[]>        { return this.recordBook; }

  getCollectedCount(): number {
    return Object.values(this.records).filter(r => r.isCollected).length;
  }

  getDonatedCount(): number {
    return this.library.donatedRecordIds.length;
  }

  /** 도감에서 미기증 항목 목록 */
  getUndонatedEntries(): RecordBookEntry[] {
    return this.recordBook.filter(e => !e.isDonated);
  }

  isLastLetterAvailable(): boolean {
    return this.library.stage >= 2 && !this.records['last_letter']?.isCollected;
  }

  /** SaveSystem용 스냅샷 */
  getSnapshot(): Pick<GameState, 'records' | 'library' | 'groundShapes' | 'recordContainers' | 'recordBook'> {
    return {
      records: Object.fromEntries(
        Object.entries(this.records).map(([k, v]) => [k, { ...v }])
      ),
      library: {
        ...this.library,
        donatedRecordIds: [...this.library.donatedRecordIds],
      },
      groundShapes:     this.groundShapes.map(s => ({ ...s })),
      recordContainers: this.recordContainers.map(c => ({ ...c })),
      recordBook:       this.recordBook.map(e => ({ ...e })),
    };
  }
}