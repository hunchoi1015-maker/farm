// ================================================================
// InventorySystem — 인벤토리 관리 시스템
// ================================================================
//
// 구조:
//   일반 슬롯 20칸 — 작물/씨앗/음식/물고기
//   퀵슬롯   3칸  — 도구 전용
//
// 스택 규칙:
//   같은 itemId + 같은 condition → 최대 64개 스택
//   64개 초과 시 다음 빈 칸에 새 스택 생성
//
// 탐색 순서:
//   도구 추가 → 퀵슬롯 → 인벤토리
//   그 외      → 인벤토리만
//
// 자동 정렬 순서:
//   씨앗 → 작물 → 물고기 → 음식 (같은 종류 내 itemId 가나다순)
//
// 발행 이벤트:
//   'inventoryChanged'  (inventory: Inventory)
//   'inventoryFull'     ()
//   'itemUsed'          (itemId: string, effect: UseEffect)
//   'itemDropped'       (item: DroppedItem)
//   'itemBuried'        (holeId: string, item: BuriedItem)
// ================================================================

import Phaser from 'phaser';
import type {
  Inventory, InventoryItem, Tool,
  ItemType, ItemCondition,
  DroppedItem, Hole, BuriedItem,
  GameState,
} from '../types';
import { FOOD_DATA, isSeedId } from '../data/crops';
import type { EnergySystem } from './EnergySystem';

// ── 상수 ────────────────────────────────────────────────────────

const MAX_STACK       = 64;
const SLOT_COUNT      = 20;
const QUICK_SLOT_COUNT = 3;

/** 정렬 우선순위: 낮을수록 앞 */
const SORT_ORDER: Record<ItemType, number> = {
  seed:  0,
  crop:  1,
  fish:  2,
  food:  3,
  tool:  4,
};

let dropIdCounter = 0;

// ── UseEffect ────────────────────────────────────────────────────

export interface UseEffect {
  type: 'energy';
  amount: number;
}

// ── InventorySystem ───────────────────────────────────────────────

export class InventorySystem extends Phaser.Events.EventEmitter {
  private static instance: InventorySystem | null = null;

  private slots:             (InventoryItem | null)[] = Array(SLOT_COUNT).fill(null);
  private quickSlots:        (Tool | null)[]          = Array(QUICK_SLOT_COUNT).fill(null);
  private equippedSlotIndex: number | null            = null;

  private droppedItems: DroppedItem[] = [];
  private holes:        Hole[]        = [];

  private energySystem?: EnergySystem;

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): InventorySystem {
    if (!InventorySystem.instance) {
      InventorySystem.instance = new InventorySystem();
    }
    return InventorySystem.instance;
  }

  static resetInstance(): void {
    InventorySystem.instance?.destroy();
    InventorySystem.instance = null;
  }

  private constructor() { super(); }

  // ── 초기화 ────────────────────────────────────────────────────

  init(state: Pick<GameState, 'inventory' | 'tools' | 'droppedItems' | 'holes'>,
       energySystem: EnergySystem): void {
    this.slots             = state.inventory.slots.map(s => s ? { ...s } : null);
    this.quickSlots        = state.inventory.quickSlots.map(q => q ? { ...q } : null);
    this.equippedSlotIndex = state.inventory.equippedSlotIndex;
    this.droppedItems      = state.droppedItems.map(d => ({ ...d }));
    this.holes             = state.holes.map(h => ({ ...h }));
    this.energySystem      = energySystem;

    console.log('[InventorySystem] 초기화 완료');
  }

  // ── 아이템 추가 ───────────────────────────────────────────────

  /**
   * 아이템 추가. 스택 가능하면 기존 슬롯에 합산, 꽉 차면 새 슬롯 생성.
   * 도구는 퀵슬롯 → 인벤토리 순으로 탐색.
   * 그 외는 인벤토리만 탐색.
   * @returns 추가 성공 여부
   */
  addItem(item: Omit<InventoryItem, 'quantity'> & { quantity?: number }): boolean {
    const qty = item.quantity ?? 1;

    if (item.itemType === 'tool') {
      return false; // 도구는 별도 equipTool()로 처리
    }

    let remaining = qty;

    // 1. 기존 스택에 합산 시도
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (remaining <= 0) break;
      const slot = this.slots[i];
      if (!slot) continue;
      if (!this.canStack(slot, item)) continue;

      const space = MAX_STACK - slot.quantity;
      const add   = Math.min(space, remaining);
      this.slots[i] = { ...slot, quantity: slot.quantity + add };
      remaining -= add;
    }

    // 2. 남은 수량 → 새 빈 슬롯에 생성
    while (remaining > 0) {
      const emptyIdx = this.slots.findIndex(s => s === null);
      if (emptyIdx === -1) {
        this.emit('inventoryFull');
        return false;
      }
      const add = Math.min(MAX_STACK, remaining);
      this.slots[emptyIdx] = {
        itemId:    item.itemId,
        itemType:  item.itemType,
        condition: item.condition,
        quantity:  add,
      };
      remaining -= add;
    }

    this.emitChanged();
    return true;
  }

  private canStack(slot: InventoryItem, item: Omit<InventoryItem, 'quantity'>): boolean {
    return slot.itemId    === item.itemId
        && slot.itemType  === item.itemType
        && slot.condition === item.condition
        && slot.quantity  < MAX_STACK;
  }

  // ── 아이템 제거 ───────────────────────────────────────────────

  /**
   * 특정 슬롯에서 수량 차감. 0이 되면 슬롯 비움.
   * @returns 실제 제거된 수량
   */
  removeItem(slotIndex: number, qty = 1): number {
    const slot = this.slots[slotIndex];
    if (!slot) return 0;

    const removed = Math.min(qty, slot.quantity);
    if (slot.quantity - removed <= 0) {
      this.slots[slotIndex] = null;
    } else {
      this.slots[slotIndex] = { ...slot, quantity: slot.quantity - removed };
    }

    this.emitChanged();
    return removed;
  }

  // ── 아이템 보유 확인 ──────────────────────────────────────────

  /**
   * 특정 아이템을 qty개 이상 보유하고 있는지 확인.
   */
  hasItem(itemId: string, qty = 1): boolean {
    const total = this.slots.reduce((sum, slot) => {
      if (slot?.itemId === itemId) return sum + slot.quantity;
      return sum;
    }, 0);
    return total >= qty;
  }

  /**
   * 아이템 소비 (씨앗 심기 등). 전체 슬롯에서 qty개 차감.
   * @returns 성공 여부
   */
  consumeItem(itemId: string, qty = 1): boolean {
    if (!this.hasItem(itemId, qty)) return false;

    let remaining = qty;
    for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.itemId !== itemId) continue;
      const removed = Math.min(slot.quantity, remaining);
      this.removeItem(i, removed);
      remaining -= removed;
    }
    return true;
  }

  // ── 슬롯 이동 (드래그 앤 드롭용) ─────────────────────────────

  /**
   * 두 슬롯의 내용을 교환.
   * fromQuick/toQuick: 퀵슬롯 여부
   */
  moveItem(
    fromIndex: number, toIndex: number,
    fromQuick = false, toQuick = false
  ): boolean {
    if (fromIndex === toIndex && fromQuick === toQuick) return false;

    const fromSlot = fromQuick ? this.quickSlots[fromIndex] : this.slots[fromIndex];
    const toSlot   = toQuick   ? this.quickSlots[toIndex]   : this.slots[toIndex];

    // 퀵슬롯엔 Tool만 허용
    if (toQuick && fromSlot && !('type' in fromSlot)) return false;

    if (fromQuick) {
      this.quickSlots[fromIndex] = (toSlot as Tool | null);
    } else {
      this.slots[fromIndex] = (toSlot as InventoryItem | null);
    }

    if (toQuick) {
      this.quickSlots[toIndex] = (fromSlot as Tool | null);
    } else {
      this.slots[toIndex] = (fromSlot as InventoryItem | null);
    }

    this.emitChanged();
    return true;
  }

  // ── 자동 정렬 ─────────────────────────────────────────────────

  /**
   * 씨앗 → 작물 → 물고기 → 음식 순으로 정렬.
   * 같은 종류 내에서는 itemId 가나다순.
   * null(빈 칸)은 뒤로.
   */
  sortInventory(): void {
    const items = this.slots.filter((s): s is InventoryItem => s !== null);

    items.sort((a, b) => {
      const orderDiff = SORT_ORDER[a.itemType] - SORT_ORDER[b.itemType];
      if (orderDiff !== 0) return orderDiff;
      return a.itemId.localeCompare(b.itemId);
    });

    this.slots = [
      ...items,
      ...Array(SLOT_COUNT - items.length).fill(null),
    ];

    this.emitChanged();
  }

  // ── 아이템 버리기 ─────────────────────────────────────────────

  /**
   * 슬롯의 아이템을 바닥에 버리기.
   * DroppedItem으로 변환 후 worldX/Y 위치에 생성.
   */
  dropItem(slotIndex: number, qty: number, worldX: number, worldY: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot) return false;

    const actualQty = Math.min(qty, slot.quantity);
    this.removeItem(slotIndex, actualQty);

    const dropped: DroppedItem = {
      id:        `drop_inv_${Date.now()}_${dropIdCounter++}`,
      itemId:    slot.itemId,
      itemType:  slot.itemType,
      condition: slot.condition,
      quantity:  actualQty,
      worldX,
      worldY,
      droppedDay: 0, // 씬에서 totalDays 주입
    };

    this.droppedItems.push(dropped);
    this.emit('itemDropped', { ...dropped });
    return true;
  }

  /**
   * 바닥 아이템 줍기.
   */
  pickUpDropped(dropId: string): boolean {
    const item = this.droppedItems.find(d => d.id === dropId);
    if (!item) return false;

    const added = this.addItem({
      itemId:    item.itemId,
      itemType:  item.itemType,
      condition: item.condition,
      quantity:  item.quantity,
    });
    if (!added) return false;

    this.droppedItems = this.droppedItems.filter(d => d.id !== dropId);
    return true;
  }

  // ── 아이템 사용 (음식) ────────────────────────────────────────

  /**
   * 음식 아이템 사용. 기력 회복.
   * E키 입력은 씬에서 처리, 이 메서드는 로직만 담당.
   */
  useItem(slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot || slot.itemType !== 'food') return false;

    const foodData = FOOD_DATA[slot.itemId];
    if (!foodData) return false;

    this.removeItem(slotIndex, 1);

    const effect: UseEffect = { type: 'energy', amount: foodData.energyRestore };
    this.energySystem?.restore(foodData.energyRestore);
    this.emit('itemUsed', slot.itemId, effect);

    console.log(`[InventorySystem] ${foodData.label} 사용 — 기력 +${foodData.energyRestore}`);
    return true;
  }

  // ── 구덩이에 묻기 ─────────────────────────────────────────────

  /**
   * 구덩이에 아이템 묻기. 단순 저장, 성장 없음.
   * 씨앗이면 FarmSystem.plantSeed() 대신 이 메서드로 처리 (밭 외부 묻기).
   */
  buryItem(slotIndex: number, holeId: string, totalDays: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot) return false;

    const hole = this.holes.find(h => h.id === holeId);
    if (!hole) return false;
    if (hole.buriedItem !== null) return false; // 이미 묻혀있음

    const buried: BuriedItem = {
      itemId:    slot.itemId,
      itemType:  slot.itemType,
      condition: slot.condition,
      quantity:  1,
      buriedDay: totalDays,
    };

    hole.buriedItem = buried;
    this.removeItem(slotIndex, 1);
    this.emit('itemBuried', holeId, { ...buried });

    console.log(`[InventorySystem] 구덩이 ${holeId}에 ${slot.itemId} 묻음`);
    return true;
  }

  /**
   * 구덩이에서 아이템 꺼내기.
   */
  digUpItem(holeId: string): boolean {
    const hole = this.holes.find(h => h.id === holeId);
    if (!hole || !hole.buriedItem) return false;

    const added = this.addItem({
      itemId:    hole.buriedItem.itemId,
      itemType:  hole.buriedItem.itemType,
      condition: hole.buriedItem.condition,
      quantity:  hole.buriedItem.quantity,
    });
    if (!added) return false;

    hole.buriedItem = null;
    return true;
  }

  // ── 구덩이 관리 ───────────────────────────────────────────────

  addHole(hole: Hole): void {
    this.holes.push({ ...hole });
  }

  removeHole(holeId: string): void {
    this.holes = this.holes.filter(h => h.id !== holeId);
  }

  // ── 퀵슬롯 (도구) ─────────────────────────────────────────────

  /**
   * 인벤토리 슬롯의 도구를 퀵슬롯에 장착.
   * 수리 중인 도구는 장착 불가.
   */
  equipTool(invSlotIndex: number, quickSlotIndex: number): boolean {
    const slot = this.slots[invSlotIndex];
    if (!slot || slot.itemType !== 'tool') return false;

    // 인벤토리엔 InventoryItem만 있으므로 실제 Tool 객체는
    // GameState.tools 배열에서 가져와야 함 (씬에서 처리)
    // 여기선 슬롯 교환만 담당
    return this.moveItem(invSlotIndex, quickSlotIndex, false, true);
  }

  setEquippedSlot(index: number | null): void {
    this.equippedSlotIndex = index;
    this.emitChanged();
  }

  getEquippedSlot(): number | null {
    return this.equippedSlotIndex;
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getSlots(): Readonly<(InventoryItem | null)[]>  { return this.slots; }
  getQuickSlots(): Readonly<(Tool | null)[]>       { return this.quickSlots; }
  getDroppedItems(): Readonly<DroppedItem[]>       { return this.droppedItems; }
  getHoles(): Readonly<Hole[]>                     { return this.holes; }

  getInventory(): Readonly<Inventory> {
    return {
      slots:             this.slots,
      quickSlots:        this.quickSlots,
      equippedSlotIndex: this.equippedSlotIndex,
    };
  }

  /** SaveSystem용 스냅샷 */
  getSnapshot(): Pick<GameState, 'inventory' | 'droppedItems' | 'holes'> {
    return {
      inventory: {
        slots:             this.slots.map(s => s ? { ...s } : null),
        quickSlots:        this.quickSlots.map(q => q ? { ...q } : null),
        equippedSlotIndex: this.equippedSlotIndex,
      },
      droppedItems: this.droppedItems.map(d => ({ ...d })),
      holes:        this.holes.map(h => ({ ...h })),
    };
  }

  // ── 유틸리티 ──────────────────────────────────────────────────

  private emitChanged(): void {
    this.emit('inventoryChanged', this.getInventory());
  }
}