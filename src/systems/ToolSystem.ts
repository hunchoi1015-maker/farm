// ================================================================
// ToolSystem — 농기구 내구도 및 수리 시스템
// ================================================================
//
// 담당:
//   - 도구 사용 시 내구도 소모
//   - 수리 의뢰 / 완료 / 찾아오기
//   - 대장장이 협동 보상 (수리 시간 -20%)
//
// 레벨 4 효과 적용 방식:
//   ToolSystem은 계산 없이 외부에서 주입된 multiplier만 적용.
//   useTool(toolId, multiplier) 형태로 호출.
//   레벨 4 미달성: multiplier = 1.0 (변화 없음)
//   레벨 4 달성:   multiplier = 0.5 (50% 감소)
//
// 수리 흐름:
//   대장간 방문 → submitRepair() → 6시간 대기
//   → 대장간 재방문 → pickUpRepaired()
//
// 수리 비용: 1골드
//
// 발행 이벤트:
//   'toolUsed'        (toolId, durability)  ← 사용 후 내구도
//   'toolBroken'      (toolId)              ← 내구도 0 도달
//   'toolUnusable'    (toolId)              ← 내구도 0 사용 시도
//   'repairSubmitted' (toolId, completeHour)
//   'repairComplete'  (toolId)              ← 완료 감지 시
//   'repairPickedUp'  (toolId)
//   'goldInsufficient'()                    ← 골드 부족
// ================================================================

import Phaser from 'phaser';
import type { Tool, GameState } from '../types';
import type { TimeSystem } from './TimeSystem';
import type { EconomySystem } from './EconomySystem';
import { TOOL_DATA } from '../data/tools';

// ── 상수 ────────────────────────────────────────────────────────

const REPAIR_COST_GOLD    = 1;
const REPAIR_HOURS        = 6;
const REPAIR_DISCOUNT     = 0.8;   // 대장장이 협동 보상 -20%

// ── ToolSystem ───────────────────────────────────────────────────

export class ToolSystem extends Phaser.Events.EventEmitter {
  private static instance: ToolSystem | null = null;

  private tools: Tool[]       = [];
  private totalElapsedHours   = 0;
  private repairDiscountActive = false;
  private economySystem!: EconomySystem;
  private timeSystem!: TimeSystem;

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): ToolSystem {
    if (!ToolSystem.instance) {
      ToolSystem.instance = new ToolSystem();
    }
    return ToolSystem.instance;
  }

  static resetInstance(): void {
    ToolSystem.instance?.destroy();
    ToolSystem.instance = null;
  }

  private constructor() { super(); }

  // ── 초기화 ────────────────────────────────────────────────────

  init(
    state: Pick<GameState, 'tools' | 'time'>,
    timeSystem: TimeSystem,
    economySystem: EconomySystem,
  ): void {
    this.tools             = state.tools.map(t => ({ ...t }));
    this.totalElapsedHours = state.time.totalDays * 24 + state.time.hour;
    this.timeSystem        = timeSystem;
    this.economySystem     = economySystem;
    this.repairDiscountActive = false;

    this.registerEvents();
    console.log(`[ToolSystem] 초기화 완료 — 도구 ${this.tools.length}개`);
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private registerEvents(): void {
    // 시간 변경 → 누적 시간 업데이트 + 수리 완료 체크
    this.timeSystem.on('hourChanged', (hour: number) => {
      this.totalElapsedHours++;
      this.checkRepairComplete();
    });

    // 날짜 변경 → 협동 보상 초기화
    this.timeSystem.on('dayChanged', () => {
      this.repairDiscountActive = false;
    });
  }

  // ── 도구 사용 ─────────────────────────────────────────────────

  /**
   * 도구 사용 시 내구도 소모.
   * 내구도 0이면 차단 후 'toolUnusable' 발행.
   *
   * @param toolId      사용할 Tool.id
   * @param multiplier  내구도 감소 배율 (레벨 4: 0.5 / 기본: 1.0)
   * @returns 성공 여부
   */
  useTool(toolId: string, multiplier = 1.0): boolean {
    const tool = this.getTool(toolId);
    if (!tool) return false;

    // 내구도 0 → 사용 불가
    if (tool.durability <= 0) {
      this.emit('toolUnusable', toolId);
      return false;
    }

    // 수리 중 → 사용 불가
    if (tool.isRepairing) {
      this.emit('toolUnusable', toolId);
      return false;
    }

    const toolData    = TOOL_DATA[tool.type];
    const baseCost    = toolData?.durabilityCost ?? 6;
    const actualCost  = Math.max(1, Math.ceil(baseCost * multiplier));

    const wasAboveZero = tool.durability > 0;
    tool.durability    = Math.max(0, tool.durability - actualCost);

    this.emit('toolUsed', toolId, tool.durability);

    // 내구도 0 도달
    if (wasAboveZero && tool.durability === 0) {
      this.emit('toolBroken', toolId);
      console.log(`[ToolSystem] 도구 파손: ${toolId}`);
    }

    return true;
  }

  // ── 수리 의뢰 ─────────────────────────────────────────────────

  /**
   * 대장장이에게 수리 의뢰.
   * 조건: 골드 1개 이상 / 수리 중이 아닌 도구 / 동시에 1개만
   *
   * @param toolId 수리할 Tool.id
   * @returns 성공 여부
   */
  submitRepair(toolId: string): boolean {
    // 이미 수리 중인 도구가 있는지 확인
    const alreadyRepairing = this.tools.some(t => t.isRepairing);
    if (alreadyRepairing) {
      console.warn('[ToolSystem] 이미 수리 중인 도구가 있어요.');
      return false;
    }

    const tool = this.getTool(toolId);
    if (!tool) return false;
    if (tool.isRepairing) return false;

    // 골드 차감 요청 → EconomySystem
    if (!this.economySystem.requestRepairPayment(REPAIR_COST_GOLD)) {
      return false;
    }

    // 수리 시간 계산
    const repairHours    = this.calcRepairHours();
    const completeHour   = this.totalElapsedHours + repairHours;

    tool.isRepairing             = true;
    tool.repairCompleteHour      = completeHour;

    this.emit('repairSubmitted', toolId, completeHour);
    console.log(
      `[ToolSystem] 수리 의뢰: ${toolId} → ${repairHours}시간 후 완료 ` +
      `(할인: ${this.repairDiscountActive})`
    );
    return true;
  }

  /**
   * 수리 완료된 도구 찾아오기.
   * 수리가 완료되지 않았으면 남은 시간 반환.
   *
   * @returns 성공 시 true / 미완료 시 남은 시간(number) / 없으면 false
   */
  pickUpRepaired(toolId: string): true | number | false {
    const tool = this.getTool(toolId);
    if (!tool || !tool.isRepairing) return false;

    // 완료 여부 확인
    if (this.totalElapsedHours < (tool.repairCompleteHour ?? Infinity)) {
      const remaining = (tool.repairCompleteHour ?? 0) - this.totalElapsedHours;
      return remaining; // 남은 시간 반환
    }

    // 수리 완료 처리
    tool.isRepairing        = false;
    tool.durability         = tool.maxDurability;
    tool.repairCompleteHour = undefined;

    this.emit('repairPickedUp', toolId);
    console.log(`[ToolSystem] 도구 수령: ${toolId} (내구도 풀 회복)`);
    return true;
  }

  // ── 대장장이 협동 보상 ────────────────────────────────────────

  /**
   * 대장장이 협동 보상 활성화.
   * 당일 수리 의뢰분 + 진행 중인 수리에 -20% 적용.
   */
  applyRepairDiscount(): void {
    this.repairDiscountActive = true;

    // 이미 진행 중인 수리에도 소급 적용
    this.tools.forEach(tool => {
      if (tool.isRepairing && tool.repairCompleteHour !== undefined) {
        const reduction = Math.floor(REPAIR_HOURS * (1 - REPAIR_DISCOUNT));
        tool.repairCompleteHour = Math.max(
          this.totalElapsedHours + 1, // 최소 1시간은 남아야 함
          tool.repairCompleteHour - reduction
        );
        console.log(`[ToolSystem] 진행 중 수리 단축: ${tool.id} → ${reduction}시간 감소`);
      }
    });

    console.log('[ToolSystem] 대장장이 협동 보상 활성화 — 수리 시간 -20%');
  }

  // ── 수리 완료 체크 ────────────────────────────────────────────

  /**
   * 매 시간 변경 시 자동 호출.
   * 완료된 수리가 있으면 'repairComplete' 발행.
   */
  private checkRepairComplete(): void {
    this.tools.forEach(tool => {
      if (
        tool.isRepairing &&
        tool.repairCompleteHour !== undefined &&
        this.totalElapsedHours >= tool.repairCompleteHour
      ) {
        this.emit('repairComplete', tool.id);
        console.log(`[ToolSystem] 수리 완료 알림: ${tool.id} (대장간에서 찾아가세요)`);
      }
    });
  }

  // ── 내구도 색상 ───────────────────────────────────────────────

  /**
   * UI에서 내구도 색상 표시용.
   * 60% 이상: 초록 / 30~60%: 주황 / 30% 미만: 빨강
   */
  getDurabilityColor(toolId: string): string {
    const tool = this.getTool(toolId);
    if (!tool) return '#888888';
    const ratio = tool.durability / tool.maxDurability;
    if (ratio > 0.6) return '#4CAF50';
    if (ratio > 0.3) return '#FF9800';
    return '#F44336';
  }

  // ── 유틸리티 ──────────────────────────────────────────────────

  private calcRepairHours(): number {
    const hours = this.repairDiscountActive
      ? Math.floor(REPAIR_HOURS * REPAIR_DISCOUNT)
      : REPAIR_HOURS;
    return hours;
  }

  private getTool(toolId: string): Tool | undefined {
    return this.tools.find(t => t.id === toolId);
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getTools(): Readonly<Tool[]>                       { return this.tools; }

  /** 외부에서 tools 배열 동기화 (스타터 도구 지급 등) */
  syncTools(tools: Tool[]): void {
    this.tools = tools.map(t => ({ ...t }));
    console.log(`[ToolSystem] 도구 동기화 완료 — ${this.tools.length}개`);
  }
  getToolById(toolId: string): Readonly<Tool> | undefined { return this.getTool(toolId); }
  getRepairingTool(): Readonly<Tool> | undefined     { return this.tools.find(t => t.isRepairing); }
  isRepairing(toolId: string): boolean               { return this.getTool(toolId)?.isRepairing ?? false; }

  isRepairComplete(toolId: string): boolean {
    const tool = this.getTool(toolId);
    if (!tool?.isRepairing) return false;
    return this.totalElapsedHours >= (tool.repairCompleteHour ?? Infinity);
  }

  getRemainingRepairHours(toolId: string): number {
    const tool = this.getTool(toolId);
    if (!tool?.isRepairing || tool.repairCompleteHour === undefined) return 0;
    return Math.max(0, tool.repairCompleteHour - this.totalElapsedHours);
  }

  /** SaveSystem용 스냅샷 */
  getSnapshot(): Pick<GameState, 'tools'> {
    return { tools: this.tools.map(t => ({ ...t })) };
  }
}