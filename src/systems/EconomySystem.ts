// ================================================================
// EconomySystem — 경제 시스템 (골드 단일 관리자)
// ================================================================
//
// 골드 관리 원칙:
//   모든 골드 증감은 EconomySystem을 통해서만 처리.
//   ToolSystem 등 다른 시스템은 EconomySystem에 요청하는 구조.
//
// 판매가 계산:
//   finalPrice = basePrice × (1 + merchantBuff)
//   merchantBuff: 상인 협동 보상 활성 시 0.2, 아니면 0
//
// 박물관 기증:
//   누적 횟수 기반 보상 (1회, 5회, 10회)
//   각 아이템은 게임당 1번만 기증 가능
//
// 발행 이벤트:
//   'goldChanged'        (amount: number, total: number)
//   'goldInsufficient'   ()
//   'itemSold'           (itemId, price, totalGold)
//   'seedBought'         (seedId, price, totalGold)
//   'museumDonated'      (itemId, donationCount)
//   'museumRewardGiven'  (reward: MuseumReward)
//   'sellBuffActivated'  ()
// ================================================================

import Phaser from 'phaser';
import type { GameState } from '../types';
import type { TimeSystem } from './TimeSystem';
import type { InventorySystem } from './InventorySystem';
import type { NPCSystem } from './NPCSystem';
import {
  SEED_SHOP_ITEMS, SELL_PRICES, MUSEUM_REWARDS,
  type MuseumReward,
} from '../data/economy';
import { CROP_TO_SEED } from '../data/crops';


// ── EconomySystem ─────────────────────────────────────────────────

export class EconomySystem extends Phaser.Events.EventEmitter {
  private static instance: EconomySystem | null = null;

  private gold              = 0;
  private donatedItemIds:   string[] = [];   // 박물관 기증 아이템 id 목록
  private givenRewardCounts: number[] = [];  // 지급 완료된 보상 requiredCount 목록

  /** 상인 협동 보상 활성 여부 (당일 한정) */
  private merchantBuffActive = false;

  private inventorySystem!: InventorySystem;

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): EconomySystem {
    if (!EconomySystem.instance) {
      EconomySystem.instance = new EconomySystem();
    }
    return EconomySystem.instance;
  }

  static resetInstance(): void {
    EconomySystem.instance?.destroy();
    EconomySystem.instance = null;
  }

  private constructor() { super(); }

  // ── 초기화 ────────────────────────────────────────────────────

  init(
    state: Pick<GameState, 'gold' | 'museum'>,
    timeSystem: TimeSystem,
    inventorySystem: InventorySystem,
    npcSystem: NPCSystem,
  ): void {
    this.gold               = state.gold;
    this.donatedItemIds     = [...state.museum.donatedItemIds];
    this.givenRewardCounts  = this.calcGivenRewards(state.museum.donatedItemIds.length);
    this.merchantBuffActive = false;
    this.inventorySystem    = inventorySystem;

    this.registerEvents(timeSystem, npcSystem);
    console.log(`[EconomySystem] 초기화 완료 — 골드: ${this.gold}G`);
  }

  /** 이미 지급된 보상 목록 복원 */
  private calcGivenRewards(donatedCount: number): number[] {
    return MUSEUM_REWARDS
      .filter(r => r.requiredCount <= donatedCount)
      .map(r => r.requiredCount);
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private registerEvents(timeSystem: TimeSystem, npcSystem: NPCSystem): void {
    // 날짜 변경 → 판매 버프 초기화
    timeSystem.on('dayChanged', () => {
      this.merchantBuffActive = false;
    });

    // NPC 협동 작업 → 상인 버프 활성화
    npcSystem.on('coopActivated', (npcId: string, coopType: string) => {
      if (coopType === 'sellBonus') {
        this.merchantBuffActive = true;
        this.emit('sellBuffActivated');
        console.log('[EconomySystem] 상인 협동 보상 — 판매가 +20% 활성화');
      }
    });
  }

  // ── 골드 관리 ─────────────────────────────────────────────────

  /**
   * 골드 증가.
   * 판매·보상 등 골드를 얻을 때 호출.
   */
  addGold(amount: number): void {
    this.gold += amount;
    this.emit('goldChanged', amount, this.gold);
  }

  /**
   * 골드 차감 시도.
   * 부족하면 false + 'goldInsufficient' 발행.
   * ToolSystem 등 외부 시스템이 이 메서드를 통해 골드를 차감.
   */
  spendGold(amount: number): boolean {
    if (this.gold < amount) {
      this.emit('goldInsufficient');
      return false;
    }
    this.gold -= amount;
    this.emit('goldChanged', -amount, this.gold);
    return true;
  }

  // ── 작물 판매 ─────────────────────────────────────────────────

  /**
   * 인벤토리 슬롯의 아이템 1개 판매.
   * 최종 가격 = basePrice × (1 + merchantBuff).
   *
   * @param slotIndex 인벤토리 슬롯 인덱스
   * @returns 판매 성공 여부
   */
  sellItem(slotIndex: number): boolean {
    const slots = this.inventorySystem.getSlots();
    const slot  = slots[slotIndex];
    if (!slot) return false;

    const priceData = SELL_PRICES[slot.itemId];
    if (!priceData) return false;

    // 시든 작물은 판매 불가
    if (slot.condition === 'wilted') return false;

    // 판매가 계산
    const finalPrice = this.calcSellPrice(priceData.basePrice);

    // 인벤토리에서 1개 차감
    const removed = this.inventorySystem.removeItem(slotIndex, 1);
    if (removed === 0) return false;

    // 골드 지급
    this.addGold(finalPrice);
    this.emit('itemSold', slot.itemId, finalPrice, this.gold);

    console.log(`[EconomySystem] 판매: ${slot.itemId} → ${finalPrice}G (총 ${this.gold}G)`);
    return true;
  }

  /**
   * 판매가 계산.
   * basePrice × (1 + merchantBuff)
   */
  private calcSellPrice(basePrice: number): number {
    const buff = this.merchantBuffActive ? 0.2 : 0;
    return Math.floor(basePrice * (1 + buff));
  }

  /**
   * 판매 예상가 조회 (UI 표시용).
   */
  getExpectedSellPrice(itemId: string): number {
    const priceData = SELL_PRICES[itemId];
    if (!priceData) return 0;
    return this.calcSellPrice(priceData.basePrice);
  }

  // ── 씨앗 구매 ─────────────────────────────────────────────────

  /**
   * 씨앗 구매. 골드 차감 후 인벤토리에 추가.
   * 씨앗은 무한 재고.
   *
   * @param seedId 구매할 씨앗 id (예: 'seed_strawberry')
   * @returns 성공 여부
   */
  buySeed(seedId: string): boolean {
    const shopItem = SEED_SHOP_ITEMS.find(s => s.seedId === seedId);
    if (!shopItem) return false;

    // 골드 차감
    if (!this.spendGold(shopItem.price)) return false;

    // 인벤토리에 씨앗 추가
    const added = this.inventorySystem.addItem({
      itemId:    seedId,
      itemType:  'seed',
      condition: 'normal',
      quantity:  1,
    });

    // 인벤토리 꽉 참 → 골드 환불
    if (!added) {
      this.addGold(shopItem.price);
      return false;
    }

    this.emit('seedBought', seedId, shopItem.price, this.gold);
    console.log(`[EconomySystem] 씨앗 구매: ${seedId} (${shopItem.price}G) → 잔액 ${this.gold}G`);
    return true;
  }

  /**
   * 현재 계절에 판매 중인 씨앗 목록 반환 (UI용).
   */
  getAvailableSeeds(currentSeason: string): typeof SEED_SHOP_ITEMS {
    return SEED_SHOP_ITEMS.filter(
      s => s.season === currentSeason || s.season === 'all'
    );
  }

  // ── 박물관 기증 ───────────────────────────────────────────────

  /**
   * 박물관에 아이템 1개 기증.
   * 각 아이템은 게임당 1번만 기증 가능.
   * 누적 횟수 달성 시 보상 자동 지급.
   *
   * @param slotIndex 인벤토리 슬롯 인덱스
   * @returns 성공 여부
   */
  donateToMuseum(slotIndex: number): boolean {
    const slots = this.inventorySystem.getSlots();
    const slot  = slots[slotIndex];
    if (!slot) return false;

    // 이미 기증한 아이템
    if (this.donatedItemIds.includes(slot.itemId)) {
      console.warn(`[EconomySystem] 이미 기증한 아이템: ${slot.itemId}`);
      return false;
    }

    // 인벤토리에서 1개 차감
    const removed = this.inventorySystem.removeItem(slotIndex, 1);
    if (removed === 0) return false;

    // 기증 처리
    this.donatedItemIds.push(slot.itemId);
    const donationCount = this.donatedItemIds.length;

    this.emit('museumDonated', slot.itemId, donationCount);
    console.log(`[EconomySystem] 박물관 기증: ${slot.itemId} (누적 ${donationCount}회)`);

    // 누적 보상 체크
    this.checkMuseumRewards(donationCount);
    return true;
  }

  /** 누적 횟수 달성 보상 체크 및 지급 */
  private checkMuseumRewards(donationCount: number): void {
    for (const reward of MUSEUM_REWARDS) {
      if (
        donationCount >= reward.requiredCount &&
        !this.givenRewardCounts.includes(reward.requiredCount)
      ) {
        this.givenRewardCounts.push(reward.requiredCount);
        this.giveMuseumReward(reward);
      }
    }
  }

  private giveMuseumReward(reward: MuseumReward): void {
    this.inventorySystem.addItem({
      itemId:    reward.itemId,
      itemType:  reward.itemType,
      condition: 'normal',
      quantity:  reward.quantity,
    });

    this.emit('museumRewardGiven', reward);
    console.log(`[EconomySystem] 박물관 보상 지급: ${reward.label} (${reward.requiredCount}회 달성)`);
  }

  // ── ToolSystem 연동 ───────────────────────────────────────────

  /**
   * ToolSystem이 수리 비용 차감 요청 시 호출.
   * ToolSystem은 이 메서드를 통해서만 골드를 차감.
   */
  requestRepairPayment(amount: number): boolean {
    return this.spendGold(amount);
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getGold(): number                        { return this.gold; }
  isMerchantBuffActive(): boolean          { return this.merchantBuffActive; }
  getDonatedItemIds(): Readonly<string[]>  { return this.donatedItemIds; }
  getDonationCount(): number               { return this.donatedItemIds.length; }
  isDonated(itemId: string): boolean       { return this.donatedItemIds.includes(itemId); }

  /** SaveSystem용 스냅샷 */
  getSnapshot(): Pick<GameState, 'gold' | 'museum'> {
    return {
      gold:   this.gold,
      museum: { donatedItemIds: [...this.donatedItemIds] },
    };
  }
}