// ================================================================
// NPCSystem — NPC 상호작용 시스템
// ================================================================
//
// 담당:
//   - 대화 (시간 일시정지, 호감도 +1/일)
//   - 선물 (퀵슬롯 아이템 장착 후 NPC 상호작용)
//   - 협동 작업 (같은 씬에서 요청, 하루 1회)
//   - 이장 시간대별 이동
//
// 선물 방식:
//   퀵슬롯에 아이템 장착 → NPC와 상호작용 → 선물 여부 선택
//   대화 중에는 선물 불가
//
// 발행 이벤트:
//   'talkStarted'       (npcId)
//   'talkEnded'         (npcId)
//   'dialogueLines'     (npcId, lines: string[])
//   'affectionChanged'  (npcId, delta, total)
//   'affectionMilestone'(npcId, level: number)   ← 10단위 도달
//   'giftResult'        (npcId, reaction, delta)
//   'coopActivated'     (npcId, coopType)
//   'coopDenied'        (npcId, reason: string)
//   'mayorMoved'        (location: MayorLocation)
// ================================================================

import Phaser from 'phaser';
import type { NPC, GameState } from '../types';
import type { TimeSystem } from './TimeSystem';
import type { EnergySystem } from './EnergySystem';
import type { FarmSystem } from './FarmSystem';
import type { InventorySystem } from './InventorySystem';
import {
  NPC_META, GIFT_REACTIONS, GIFT_TYPE_FALLBACK,
  GIFT_AFFECTION_DELTA, getMayorLocation,
  getDayOfWeek, isWeekend,
  type NpcId, type GiftReaction, type MayorLocation,
} from '../data/npcs';
import { FOOD_DATA } from '../data/crops';

// ── 상수 ────────────────────────────────────────────────────────

const MAX_AFFECTION       = 100;
const MIN_AFFECTION       = 0;
const TALK_AFFECTION      = 1;    // 하루 첫 대화 호감도
const MAX_GIFTS_PER_WEEK  = 3;    // NPC별 주간 선물 횟수
const COOP_ENERGY_RESTORE = 50;   // 이장 협동 보상 기력량

// ── NPCSystem ────────────────────────────────────────────────────

export class NPCSystem extends Phaser.Events.EventEmitter {
  private static instance: NPCSystem | null = null;

  private npcs: Record<string, NPC> = {};
  private isTalking         = false;
  private currentTalkNpcId: NpcId | null = null;
  private mayorLocation: MayorLocation = 'mayor_home';

  private timeSystem!:      TimeSystem;
  private energySystem!:    EnergySystem;
  private farmSystem!:      FarmSystem;
  private inventorySystem!: InventorySystem;

  // 대사 캐시 (JSON 파일 로딩 결과)
  private dialogueCache: Record<string, Record<string, string[]>> = {};

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): NPCSystem {
    if (!NPCSystem.instance) {
      NPCSystem.instance = new NPCSystem();
    }
    return NPCSystem.instance;
  }

  static resetInstance(): void {
    NPCSystem.instance?.destroy();
    NPCSystem.instance = null;
  }

  private constructor() { super(); }

  // ── 초기화 ────────────────────────────────────────────────────

  async init(
    state: Pick<GameState, 'npcs' | 'time'>,
    timeSystem: TimeSystem,
    energySystem: EnergySystem,
    farmSystem: FarmSystem,
    inventorySystem: InventorySystem,
  ): Promise<void> {
    this.npcs             = Object.fromEntries(
      Object.entries(state.npcs).map(([k, v]) => [k, { ...v }])
    );
    this.timeSystem      = timeSystem;
    this.energySystem    = energySystem;
    this.farmSystem      = farmSystem;
    this.inventorySystem = inventorySystem;

    // 이장 초기 위치 설정
    this.mayorLocation = getMayorLocation(
      state.time.hour,
      state.time.totalDays
    );

    // 대사 JSON 로딩
    await this.loadDialogues();

    this.registerEvents();
    console.log('[NPCSystem] 초기화 완료');
  }

  // ── 대사 로딩 ─────────────────────────────────────────────────

  private async loadDialogues(): Promise<void> {
    const npcIds: NpcId[] = ['farmer', 'merchant', 'mayor', 'blacksmith', 'doctor'];
    await Promise.all(npcIds.map(async id => {
      try {
        const res  = await fetch(`/src/data/dialogues/${id}.json`);
        this.dialogueCache[id] = await res.json();
      } catch (e) {
        console.warn(`[NPCSystem] 대사 로딩 실패: ${id}`, e);
        this.dialogueCache[id] = { '0': [`${id}와 대화했습니다.`] };
      }
    }));
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private registerEvents(): void {
    // 시간 변경 → 이장 위치 업데이트
    this.timeSystem.on('hourChanged', (hour: number) => {
      const newLocation = getMayorLocation(
        hour,
        this.timeSystem.getTotalDays()
      );
      if (newLocation !== this.mayorLocation) {
        this.mayorLocation = newLocation;
        this.emit('mayorMoved', newLocation);
        console.log(`[NPCSystem] 이장 이동 → ${newLocation}`);
      }
    });

    // 날짜 변경 → coopUsedToday 초기화
    this.timeSystem.on('dayChanged', () => {
      Object.values(this.npcs).forEach(npc => {
        npc.coopUsedToday = false;
      });
    });

    // 주 변경 → 주간 선물 횟수 초기화
    // totalDays가 7의 배수+1일 때 (새 주 시작)
    this.timeSystem.on('dayChanged', () => {
      const dow = getDayOfWeek(this.timeSystem.getTotalDays());
      if (dow === 0) { // 월요일 = 새 주 시작
        Object.values(this.npcs).forEach(npc => {
          npc.giftsGivenThisWeek = 0;
        });
        console.log('[NPCSystem] 주간 선물 횟수 초기화');
      }
    });
  }

  // ── 대화 ──────────────────────────────────────────────────────

  /**
   * NPC와 대화 시작.
   * TimeSystem 일시정지, 호감도 +1 (하루 첫 대화만).
   * 퀵슬롯에 아이템 장착 시 선물 여부는 씬에서 UI로 처리.
   */
  startTalk(npcId: NpcId): boolean {
    if (this.isTalking) return false;

    const npc = this.npcs[npcId];
    if (!npc) return false;

    this.isTalking         = true;
    this.currentTalkNpcId  = npcId;

    // 시간 일시정지
    this.timeSystem.pause();

    // 하루 첫 대화 → 호감도 +1
    const totalDays = this.timeSystem.getTotalDays();
    if (npc.lastTalkedDay !== totalDays) {
      npc.lastTalkedDay = totalDays;
      this.changeAffection(npcId, TALK_AFFECTION);
    }

    // 현재 호감도 구간 대사 가져오기
    const lines = this.getDialogueLines(npcId, npc.affection);
    this.emit('talkStarted', npcId);
    this.emit('dialogueLines', npcId, lines);

    return true;
  }

  /** 대화 종료. TimeSystem 재개. */
  endTalk(): void {
    if (!this.isTalking) return;
    this.isTalking        = false;
    this.currentTalkNpcId = null;
    this.timeSystem.resume();
    this.emit('talkEnded', this.currentTalkNpcId);
  }

  /** 호감도 구간에 맞는 대사 반환 */
  private getDialogueLines(npcId: NpcId, affection: number): string[] {
    const cache = this.dialogueCache[npcId];
    if (!cache) return ['...'];

    // 호감도 구간: 10단위 내림 (예: 35 → '30')
    const levels = Object.keys(cache)
      .map(Number)
      .sort((a, b) => a - b);

    let key = 0;
    for (const level of levels) {
      if (affection >= level) key = level;
    }

    const lines = cache[String(key)] ?? ['...'];
    // 대사 배열 중 랜덤 1개 선택
    return [lines[Math.floor(Math.random() * lines.length)]];
  }

  // ── 선물 ──────────────────────────────────────────────────────

  /**
   * 선물 증정.
   * 대화 중엔 불가. 퀵슬롯 장착 아이템을 NPC에게 줌.
   * 씬에서 "선물할까요?" UI 확인 후 이 메서드 호출.
   *
   * @param npcId    선물 받는 NPC
   * @param itemId   선물할 아이템 id
   * @param itemType 아이템 타입
   */
  giveGift(npcId: NpcId, itemId: string, itemType: string): boolean {
    if (this.isTalking) return false;

    const npc = this.npcs[npcId];
    if (!npc) return false;

    // 주간 선물 횟수 체크
    if (npc.giftsGivenThisWeek >= MAX_GIFTS_PER_WEEK) {
      this.emit('coopDenied', npcId, '이번 주 선물 횟수를 모두 사용했어요.');
      return false;
    }

    // 반응 결정
    const reaction = this.getGiftReaction(npcId, itemId, itemType);
    const delta    = GIFT_AFFECTION_DELTA[reaction];

    npc.giftsGivenThisWeek++;
    this.changeAffection(npcId, delta);
    this.emit('giftResult', npcId, reaction, delta);

    console.log(`[NPCSystem] ${npcId}에게 ${itemId} 선물 → ${reaction} (${delta > 0 ? '+' : ''}${delta})`);
    return true;
  }

  private getGiftReaction(
    npcId: NpcId,
    itemId: string,
    itemType: string
  ): GiftReaction {
    const reactions = GIFT_REACTIONS[npcId];

    // 개별 아이템 반응 우선
    if (reactions[itemId]) return reactions[itemId];

    // 음식·씨앗은 기본 neutral
    if (itemType === 'food' || itemType === 'seed') return 'neutral';

    // 타입별 fallback
    return GIFT_TYPE_FALLBACK[npcId];
  }

  // ── 협동 작업 ─────────────────────────────────────────────────

  /**
   * 협동 작업 요청.
   * 조건: 호감도 50+, 오늘 미사용, 같은 씬(씬에서 사전 체크)
   */
  requestCoop(npcId: NpcId): boolean {
    const npc = this.npcs[npcId];
    if (!npc) return false;

    if (npc.affection < 50) {
      this.emit('coopDenied', npcId, '아직 친하지 않아요.');
      return false;
    }
    if (npc.coopUsedToday) {
      this.emit('coopDenied', npcId, '오늘은 이미 도와줬어요.');
      return false;
    }

    npc.coopUsedToday = true;
    const meta = NPC_META[npcId];

    meta.coopTypes.forEach(coopType => {
      this.applyCoopEffect(npcId, coopType);
    });

    return true;
  }

  private applyCoopEffect(npcId: NpcId, coopType: string): void {
    switch (coopType) {
      case 'autoWater':
        // 농부: 당일 밭 전체 자동 물주기
        this.farmSystem.waterAllTiles();
        this.emit('coopActivated', npcId, 'autoWater');
        break;

      case 'farmExpBonus':
        // 농부: 당일 작물 경험치 +10% (FarmSystem에 플래그 설정)
        // FarmSystem에 activateFarmExpBonus() 추가 필요
        (this.farmSystem as any).activateFarmExpBonus?.();
        this.emit('coopActivated', npcId, 'farmExpBonus');
        break;

      case 'sellBonus':
        // 상인: 판매가 +20% (당일) — 씬/판매 로직에서 플래그 확인
        this.emit('coopActivated', npcId, 'sellBonus');
        break;

      case 'energyRestore':
        // 이장: 기력 +50 즉시
        this.energySystem.restore(COOP_ENERGY_RESTORE);
        this.emit('coopActivated', npcId, 'energyRestore');
        break;

      case 'repairDiscount':
        // 대장장이: 수리 시간 -20% (당일) — ToolSystem에서 플래그 확인
        this.emit('coopActivated', npcId, 'repairDiscount');
        break;

      case 'energyCostReduce':
        // 한의사: 기력 소모 -10% (당일)
        this.energySystem.applyDoctorBuff();
        this.emit('coopActivated', npcId, 'energyCostReduce');
        break;
    }

    console.log(`[NPCSystem] 협동 작업 발동: ${npcId} → ${coopType}`);
  }

  // ── 호감도 관리 ───────────────────────────────────────────────

  private changeAffection(npcId: string, delta: number): void {
    const npc = this.npcs[npcId];
    if (!npc) return;

    const prev  = npc.affection;
    npc.affection = Math.max(MIN_AFFECTION,
                    Math.min(MAX_AFFECTION, prev + delta));

    this.emit('affectionChanged', npcId, delta, npc.affection);

    // 협동 해금 (50 돌파)
    if (prev < 50 && npc.affection >= 50) {
      npc.isCoopUnlocked = true;
    }

    // 10단위 마일스톤 체크
    const prevLevel = Math.floor(prev / 10);
    const newLevel  = Math.floor(npc.affection / 10);
    if (newLevel > prevLevel) {
      this.emit('affectionMilestone', npcId, newLevel * 10);
      console.log(`[NPCSystem] ${npcId} 호감도 마일스톤: ${newLevel * 10}`);
    }

    // 100 도달 → 개인 이벤트
    if (prev < 100 && npc.affection >= 100 && !npc.isEventDone) {
      this.emit('personalEvent', npcId);
    }
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getNpc(npcId: string): Readonly<NPC> | null {
    return this.npcs[npcId] ?? null;
  }

  getAllNpcs(): Readonly<Record<string, NPC>> {
    return this.npcs;
  }

  getMayorLocation(): MayorLocation {
    return this.mayorLocation;
  }

  isTalkingNow(): boolean {
    return this.isTalking;
  }

  /** SaveSystem용 스냅샷 */
  getSnapshot(): Pick<GameState, 'npcs'> {
    return {
      npcs: Object.fromEntries(
        Object.entries(this.npcs).map(([k, v]) => [k, { ...v }])
      ),
    };
  }
}