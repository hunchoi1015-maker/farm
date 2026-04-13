// ================================================================
// TimeSystem — 싱글톤 + Event Bus 기반 시간 관리 시스템
// ================================================================
//
// 현실 1분 = 게임 1시간 (60,000ms = 1 game hour)
//
// 발행 이벤트:
//   'hourChanged'    (hour: number)
//   'dayChanged'     (time: GameTime)
//   'seasonChanged'  (season: Season)
//   'forceSleep'     ()                 ← 새벽 2시 자동 취침
//   'nightPenalty'   ()                 ← 밤 12시 기력 소모 1.5배 시작
//
// 사용법:
//   const ts = TimeSystem.getInstance();
//   ts.init(savedTime);               // 초기화 (BootScene에서 호출)
//   ts.on('hourChanged', (h) => {});  // 이벤트 구독
//   ts.update(delta);                 // Phaser update()에서 매 프레임 호출
// ================================================================

import Phaser from 'phaser';
import type { GameTime, Season } from '../types';

// ── 상수 ────────────────────────────────────────────────────────

/** 현실 1분(ms) = 게임 1시간 */
const MS_PER_GAME_HOUR = 60_000;

const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn'];
const DAYS_PER_SEASON = 28;

/** 피로도 패널티 시작 시각 (밤 12시) */
const NIGHT_PENALTY_HOUR = 0; // 자정 = 0시

/** 강제 취침 시각 (새벽 2시) */
const FORCE_SLEEP_HOUR = 2;

// ── TimeSystem ───────────────────────────────────────────────────

export class TimeSystem extends Phaser.Events.EventEmitter {
  private static instance: TimeSystem | null = null;

  private time!: GameTime;
  private elapsed = 0;       // 현재 시간 내 누적 ms
  private paused = false;    // 취침/일시정지 시 true

  // 이벤트 중복 발행 방지용 플래그
  private nightPenaltyFired = false;
  private forceSleepFired = false;

  // ── 싱글톤 ──────────────────────────────────────────────────

  static getInstance(): TimeSystem {
    if (!TimeSystem.instance) {
      TimeSystem.instance = new TimeSystem();
    }
    return TimeSystem.instance;
  }

  /** 테스트 또는 새 게임 시작 시 인스턴스 초기화 */
  static resetInstance(): void {
    TimeSystem.instance?.destroy();
    TimeSystem.instance = null;
  }

  private constructor() {
    super();
  }

  // ── 초기화 ──────────────────────────────────────────────────

  /**
   * TimeSystem 초기화.
   * BootScene에서 GameState.time을 넘겨 호출.
   */
  init(savedTime: GameTime): void {
    this.time = { ...savedTime };
    this.elapsed = 0;
    this.paused = false;
    this.nightPenaltyFired = false;
    this.forceSleepFired = false;
    console.log('[TimeSystem] 초기화:', this.getTimeString());
  }

  // ── 매 프레임 업데이트 ───────────────────────────────────────

  /**
   * Phaser의 update(time, delta)에서 매 프레임 호출.
   * delta: 이전 프레임과의 시간 차이 (ms)
   */
  update(delta: number): void {
    if (this.paused) return;

    this.elapsed += delta;

    // 1게임 시간(60초) 경과마다 시간 진행
    while (this.elapsed >= MS_PER_GAME_HOUR) {
      this.elapsed -= MS_PER_GAME_HOUR;
      this.advanceHour();
    }
  }

  // ── 시간 진행 로직 ───────────────────────────────────────────

  private advanceHour(): void {
    this.time.hour = (this.time.hour + 1) % 24;

    // 자정(0시) = 새로운 날 시작
    if (this.time.hour === 0) {
      this.advanceDay();
      return; // advanceDay에서 hourChanged 발행
    }

    this.emit('hourChanged', this.time.hour);
    this.checkTimeEvents();
  }

  private advanceDay(): void {
    this.time.day++;
    this.time.totalDays++;

    // 계절 전환 체크
    if (this.time.day > DAYS_PER_SEASON) {
      this.time.day = 1;
      this.advanceSeason();
    }

    // 날짜 변경 시 플래그 초기화
    this.nightPenaltyFired = false;
    this.forceSleepFired = false;

    this.emit('hourChanged', this.time.hour); // 0시 이벤트
    this.emit('dayChanged', { ...this.time });
    console.log(`[TimeSystem] ${this.getTimeString()}`);
  }

  private advanceSeason(): void {
    const currentIndex = SEASON_ORDER.indexOf(this.time.season);
    const nextIndex = (currentIndex + 1) % SEASON_ORDER.length;
    this.time.season = SEASON_ORDER[nextIndex];
    this.emit('seasonChanged', this.time.season);
    console.log(`[TimeSystem] 계절 변경 → ${this.time.season}`);
  }

  // ── 시간 이벤트 체크 ─────────────────────────────────────────

  private checkTimeEvents(): void {
    const h = this.time.hour;

    // 밤 12시 (자정 = 0시는 advanceDay에서 처리되므로 여기선 24시 직전인 23시 이후 체크)
    // 실제 "밤 12시 이후" = 자정(0시) 이후 → dayChanged 이후 첫 시간부터 적용
    // 피로도 패널티: 밤 12시(0시) 이후 → dayChanged 이벤트 리스너에서 처리
    // 여기서는 별도 시각 기반 이벤트만 처리

    // 새벽 2시 강제 취침
    if (h === FORCE_SLEEP_HOUR && !this.forceSleepFired) {
      this.forceSleepFired = true;
      this.emit('forceSleep');
      console.log('[TimeSystem] 새벽 2시 — 강제 취침');
    }
  }

  // ── 취침 / 일시정지 ──────────────────────────────────────────

  /**
   * 취침 시작. 시간 진행이 멈추고 다음 날 아침으로 건너뜀.
   * @param penalized 강제 취침 여부 (기력 패널티 적용)
   */
  sleep(penalized = false): void {
    this.paused = true;
    this.elapsed = 0;

    // 다음 날 오전 6시로 설정
    this.time.hour = 6;
    this.time.minute = 0;
    this.time.day++;
    this.time.totalDays++;

    if (this.time.day > DAYS_PER_SEASON) {
      this.time.day = 1;
      this.advanceSeason();
    }

    this.nightPenaltyFired = false;
    this.forceSleepFired = false;

    this.emit('dayChanged', { ...this.time });
    this.emit('slept', { penalized });
    console.log(`[TimeSystem] 취침 완료 (패널티: ${penalized}) → ${this.getTimeString()}`);
  }

  /** 취침 후 기상 시 호출 */
  wakeUp(): void {
    this.paused = false;
    this.emit('wokeUp');
  }

  /** 대화/UI 등 일시정지 */
  pause(): void {
    this.paused = true;
  }

  /** 일시정지 해제 */
  resume(): void {
    this.paused = false;
  }

  // ── 날씨 설정 ────────────────────────────────────────────────

  /**
   * 하루 시작 시 WeatherSystem이 호출해서 날씨를 설정.
   */
  setWeather(weather: GameTime['weather']): void {
    this.time.weather = weather;
    this.emit('weatherChanged', weather);
  }

  // ── 게터 ─────────────────────────────────────────────────────

  getTime(): Readonly<GameTime> {
    return { ...this.time };
  }

  getHour(): number {
    return this.time.hour;
  }

  getSeason(): Season {
    return this.time.season;
  }

  getTotalDays(): number {
    return this.time.totalDays;
  }

  /** 현재 시각이 피로도 패널티 구간인지 (자정 0시 ~ 새벽 2시) */
  isNightPenaltyActive(): boolean {
    return this.time.hour >= NIGHT_PENALTY_HOUR && this.time.hour < FORCE_SLEEP_HOUR;
  }

  /** 갯벌 입장 가능 여부 (13~20시) */
  isTidalFlatOpen(): boolean {
    return this.time.hour >= 13 && this.time.hour < 20;
  }

  /** 돌다리 이용 가능 여부 */
  isStoneBridgeOpen(): boolean {
    return this.time.weather !== 'rainy';
  }

  // ── 디버그 유틸 ──────────────────────────────────────────────

  getTimeString(): string {
    const seasonKo = { spring: '봄', summer: '여름', autumn: '가을' }[this.time.season];
    return `${seasonKo} ${this.time.day}일 ${String(this.time.hour).padStart(2, '0')}:00 (총 ${this.time.totalDays}일째)`;
  }

  /**
   * 개발 중 시간을 빠르게 건너뛸 때 사용.
   * 프로덕션 빌드에서는 호출하지 말 것.
   */
  debugSkipHours(hours: number): void {
    for (let i = 0; i < hours; i++) {
      this.advanceHour();
    }
  }
}