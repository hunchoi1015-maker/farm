// ================================================================
// EnergySystem — 기력 관리 시스템
// ================================================================
//
// 기력 기본값: 500
// 기력 0 시:   이동 + NPC 대화/선물 가능, 그 외 행동 차단
//
// 수면 회복 공식:
//   게임 시간 10분당 2% 회복
//   기상 고정: 오전 6시
//   예) 22시 취침 → 480분 수면 → 96% 회복 → 풀회복
//   예) 2시 강제취침 → 240분 수면 → 48% 회복
//
// 야간 패널티 (자정 0시 ~ 새벽 2시):
//   기력 소모 1.5배
//
// 한의사 협동 버프:
//   기력 소모 0.9배 (1일 한정)
//
// 발행 이벤트:
//   'energyChanged'       (current: number, max: number)
//   'energyDepleted'      ()  ← 기력이 0에 도달했을 때
//   'energyInsufficient'  ()  ← 기력 부족으로 행동 차단됐을 때
//
// 구독 이벤트 (TimeSystem):
//   'hourChanged'  → 야간 패널티 구간 체크
//   'dayChanged'   → 버프 초기화
//   'forceSleep'   → 강제 취침 트리거
//   'slept'        → 수면 회복 계산
// ================================================================

import Phaser from 'phaser';
import type { TimeSystem } from './TimeSystem';

// ── 상수 ────────────────────────────────────────────────────────

const MAX_ENERGY = 500;

/** 게임 10분당 회복 비율 */
const RECOVERY_RATE_PER_10MIN = 0.02; // 2%

/** 기상 시각 (고정) */
const WAKE_UP_HOUR = 6;

/** 야간 패널티 구간: 자정(0시) ~ 새벽 2시 미만 */
const NIGHT_PENALTY_START = 0;
const NIGHT_PENALTY_END   = 2;
const NIGHT_PENALTY_MULT  = 1.5;

/** 한의사 버프: 소모 0.9배 */
const DOCTOR_BUFF_MULT = 0.9;

// ── 기력 소모가 필요 없는 행동 목록 ────────────────────────────

/**
 * 기력이 0이어도 허용되는 행동 타입.
 * consume() 호출 시 actionType을 넘겨 예외 처리.
 */
export type FreeAction = 'npcTalk' | 'npcGift' | 'move';

// ── EnergySystem ─────────────────────────────────────────────────

export class EnergySystem extends Phaser.Events.EventEmitter {
  private static instance: EnergySystem | null = null;

  private current: number = MAX_ENERGY;
  private max: number     = MAX_ENERGY;

  /** 야간 패널티 활성 여부 */
  private nightPenaltyActive = false;

  /** 한의사 버프 활성 여부 (1일 한정) */
  private doctorBuffActive = false;

  /** 강제 취침 여부 (수면 회복 계산에 사용) */
  private forcedSleep = false;

  /** 취침 시각 (게임 시간 기준, 0~23) */
  private sleepHour: number | null = null;

  // ── 싱글톤 ────────────────────────────────────────────────────

  static getInstance(): EnergySystem {
    if (!EnergySystem.instance) {
      EnergySystem.instance = new EnergySystem();
    }
    return EnergySystem.instance;
  }

  static resetInstance(): void {
    EnergySystem.instance?.destroy();
    EnergySystem.instance = null;
  }

  private constructor() {
    super();
  }

  // ── 초기화 ────────────────────────────────────────────────────

  /**
   * EnergySystem 초기화.
   * BootScene에서 TimeSystem 초기화 직후 호출.
   *
   * @param timeSystem TimeSystem 싱글톤
   * @param savedEnergy 저장된 기력값 (이어하기) 또는 MAX_ENERGY (새 게임)
   */
  init(timeSystem: TimeSystem, savedEnergy: number = MAX_ENERGY): void {
    this.current            = Math.min(savedEnergy, this.max);
    this.nightPenaltyActive = false;
    this.doctorBuffActive   = false;
    this.forcedSleep        = false;
    this.sleepHour          = null;

    // 초기화 시점의 시각으로 야간 패널티 구간 체크
    this.checkNightPenalty(timeSystem.getHour());

    this.registerEvents(timeSystem);
    console.log(`[EnergySystem] 초기화 완료 — 기력: ${this.current}/${this.max}`);
  }

  // ── 이벤트 구독 ───────────────────────────────────────────────

  private registerEvents(timeSystem: TimeSystem): void {
    // 시간 변경 → 야간 패널티 구간 체크
    timeSystem.on('hourChanged', (hour: number) => {
      this.checkNightPenalty(hour);
    });

    // 날짜 변경 → 버프 초기화
    timeSystem.on('dayChanged', () => {
      this.doctorBuffActive = false;
    });

    // 강제 취침 플래그 설정
    // 실제 수면 회복은 'slept' 이벤트에서 처리
    timeSystem.on('forceSleep', () => {
      this.forcedSleep = true;
    });

    // 취침 완료 → 수면 회복 계산
    // slept 페이로드: { penalized: boolean }
    timeSystem.on('slept', ({ penalized }: { penalized: boolean }) => {
      this.recoverFromSleep(penalized);
    });
  }

  // ── 기력 소모 ─────────────────────────────────────────────────

  /**
   * 기력 소모 시도.
   * 성공 시 true, 기력 부족으로 차단 시 false 반환.
   *
   * @param amount     소모할 기력량 (양수)
   * @param freeAction 기력 0이어도 허용되는 행동이면 해당 타입 전달
   */
  consume(amount: number, freeAction?: FreeAction): boolean {
    // 기력 소모 없는 행동 (NPC 대화, 선물, 이동)
    if (freeAction) return true;

    const cost = this.calcCost(amount);

    // 기력 부족 → 행동 차단
    if (this.current <= 0 || this.current < cost) {
      this.emit('energyInsufficient');
      return false;
    }

    const wasAboveZero = this.current > 0;
    this.current = Math.max(0, this.current - cost);

    this.emit('energyChanged', this.current, this.max);

    // 기력 첫 고갈 시 이벤트 발행
    if (wasAboveZero && this.current === 0) {
      this.emit('energyDepleted');
    }

    return true;
  }

  /**
   * 실제 소모량 계산.
   * 야간 패널티(1.5배) → 한의사 버프(0.9배) 순으로 적용.
   * 소수점은 올림 처리 (1 미만으로 내려가지 않도록).
   */
  private calcCost(base: number): number {
    let cost = base;
    if (this.nightPenaltyActive) cost *= NIGHT_PENALTY_MULT;
    if (this.doctorBuffActive)   cost *= DOCTOR_BUFF_MULT;
    return Math.max(1, Math.ceil(cost));
  }

  // ── 기력 회복 ─────────────────────────────────────────────────

  /**
   * 음식 등으로 즉시 기력 회복.
   * 최대치를 초과하지 않도록 클램프.
   */
  restore(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
    this.emit('energyChanged', this.current, this.max);
    console.log(`[EnergySystem] 기력 회복 +${amount} → ${this.current}/${this.max}`);
  }

  /**
   * 수면 회복 계산.
   * 공식: 게임 10분당 2% 회복, 기상 시각 = 오전 6시 고정.
   *
   * 수면 시간(분) = (WAKE_UP_HOUR - sleepHour + 24) % 24 * 60
   * 회복량 = 수면시간(분) / 10 * 2% * MAX_ENERGY
   */
  private recoverFromSleep(penalized: boolean): void {
    const sleepHour = this.sleepHour ?? NIGHT_PENALTY_END; // 기록 없으면 새벽 2시로 간주

    // 수면 시간(분) 계산: 취침 시각 → 오전 6시까지
    const sleepHours  = (WAKE_UP_HOUR - sleepHour + 24) % 24;
    const sleepMinutes = sleepHours * 60;

    // 10분당 2% 회복
    const recoveryRate   = (sleepMinutes / 10) * RECOVERY_RATE_PER_10MIN;
    const recoveryAmount = Math.floor(this.max * recoveryRate);

    this.current = Math.min(this.max, recoveryAmount);

    // 상태 초기화
    this.forcedSleep = false;
    this.sleepHour   = null;

    this.emit('energyChanged', this.current, this.max);
    console.log(
      `[EnergySystem] 수면 회복 — 취침: ${sleepHour}시, 수면: ${sleepMinutes}분, ` +
      `회복: ${recoveryAmount} → ${this.current}/${this.max}` +
      (penalized ? ' (강제 취침)' : '')
    );
  }

  // ── 야간 패널티 ───────────────────────────────────────────────

  private checkNightPenalty(hour: number): void {
    const inPenaltyZone =
      hour >= NIGHT_PENALTY_START && hour < NIGHT_PENALTY_END;

    if (inPenaltyZone !== this.nightPenaltyActive) {
      this.nightPenaltyActive = inPenaltyZone;
      console.log(
        `[EnergySystem] 야간 패널티 ${inPenaltyZone ? '활성' : '비활성'}`
      );
    }
  }

  // ── 버프 ──────────────────────────────────────────────────────

  /**
   * 한의사 협동 보상 적용. 당일 자정까지 유지.
   * dayChanged 이벤트 시 자동 해제.
   */
  applyDoctorBuff(): void {
    this.doctorBuffActive = true;
    console.log('[EnergySystem] 한의사 버프 활성 — 기력 소모 -10%');
  }

  // ── 취침 시각 기록 ────────────────────────────────────────────

  /**
   * 플레이어가 취침을 선택하거나 강제 취침될 때 호출.
   * TimeSystem.sleep() 호출 전에 반드시 먼저 호출해야 함.
   * (sleep() 이후엔 시각이 다음 날 6시로 바뀌므로)
   */
  recordSleepHour(hour: number): void {
    this.sleepHour = hour;
  }

  // ── 게터 ──────────────────────────────────────────────────────

  getCurrent(): number { return this.current; }
  getMax(): number     { return this.max; }

  /** 기력 부족 여부 (0이면 true) */
  isDepleted(): boolean { return this.current <= 0; }

  /** 특정 행동이 가능한지 확인 (소모 없이 사전 체크용) */
  canAfford(amount: number): boolean {
    return this.current >= this.calcCost(amount);
  }

  isNightPenaltyActive(): boolean { return this.nightPenaltyActive; }
  isDoctorBuffActive(): boolean   { return this.doctorBuffActive; }
}