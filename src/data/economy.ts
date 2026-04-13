// ================================================================
// data/economy.ts — 경제 정적 데이터
// ================================================================

import type { ItemType } from '../types';

// ── 씨앗 상점 데이터 ─────────────────────────────────────────────

export interface SeedShopItem {
  seedId: string;
  label: string;
  price: number;      // 구매가 (골드)
  season: string;     // 판매 계절 (모든 계절에 판매 시 'all')
}

export const SEED_SHOP_ITEMS: SeedShopItem[] = [
  { seedId: 'seed_strawberry', label: '딸기 씨앗',  price: 100, season: 'spring' },
  { seedId: 'seed_spinach',    label: '시금치 씨앗', price: 50,  season: 'spring' },
  { seedId: 'seed_cucumber',   label: '오이 씨앗',   price: 80,  season: 'summer' },
  { seedId: 'seed_pepper',     label: '고추 씨앗',   price: 150, season: 'summer' },
  { seedId: 'seed_rice',       label: '벼 씨앗',     price: 150, season: 'autumn' },
];

// ── 작물 판매가 ──────────────────────────────────────────────────

export interface SellPriceData {
  itemId: string;
  itemType: ItemType;
  basePrice: number;
}

export const SELL_PRICES: Record<string, SellPriceData> = {
  // 작물
  strawberry: { itemId: 'strawberry', itemType: 'crop', basePrice: 120 },
  spinach:    { itemId: 'spinach',    itemType: 'crop', basePrice: 60  },
  cucumber:   { itemId: 'cucumber',   itemType: 'crop', basePrice: 96  },
  pepper:     { itemId: 'pepper',     itemType: 'crop', basePrice: 180 },
  rice:       { itemId: 'rice',       itemType: 'crop', basePrice: 300 },
  // 물고기 (추후 확장)
  crucian:    { itemId: 'crucian',    itemType: 'fish', basePrice: 50  },
  mackerel:   { itemId: 'mackerel',   itemType: 'fish', basePrice: 80  },
  sea_bream:  { itemId: 'sea_bream',  itemType: 'fish', basePrice: 150 },
};

// ── 박물관 기증 누적 보상 ─────────────────────────────────────────

export interface MuseumReward {
  requiredCount: number;  // 누적 기증 횟수
  itemId: string;
  itemType: ItemType;
  quantity: number;
  label: string;
}

export const MUSEUM_REWARDS: MuseumReward[] = [
  { requiredCount: 1,  itemId: 'seed_strawberry', itemType: 'seed', quantity: 1, label: '딸기 씨앗' },
  { requiredCount: 5,  itemId: 'seed_spinach',    itemType: 'seed', quantity: 1, label: '시금치 씨앗' },
  { requiredCount: 10, itemId: 'sea_bream',        itemType: 'fish', quantity: 1, label: '도미' },
];