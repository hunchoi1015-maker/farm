// ================================================================
// WeatherSystem — 날씨 관리 시스템
// ================================================================
//
// 날씨 결정 시점: 취침(slept) 시 다음 날 날씨를 미리 결정
// 첫날 날씨:      항상 맑음 (init()에서 고정)
// 계절 전환 당일: 새 계절 기준으로 확률 계산
//
// 구독 이벤트 (TimeSystem):
//   'slept'   → 다음 날 날씨 결정 후 TimeSystem에 반영
//
// 발행 이벤트:
//   'weatherDecided' (weather: Weather, isRain: boolean)
//     → 취침 시 다음 날 날씨가 결정됐을 때
//   'rainApplied'
//     → 비 오는 날 아침, 밭 자동 물주기 적용 완료 시
//
// 사용법:
//   const ws = WeatherSystem.getInstance();
//   ws.init(timeSystem, savedWeather);
//   ws.on('weatherDecided', ({ weather }) => { ... });
// ================================================================

import Phaser from 'phaser';
import type { Weather, Season, FarmTile } from '../types';
import { TimeSystem } from './TimeSystem';
import { rollWeatherFromTable } from '../data/weather';

export class WeatherSystem extends Phaser.Events.EventEmitter {
  private static instance: WeatherSystem | null = null;

  private timeSystem!: TimeSystem;

  /** 오늘의 날씨 (GameState.time.weather와 항상 동기화) */
  private currentWeather: Weather = 'sunny';

  /** 비 오는 날 자동 물주기 중복 방지 플래그 */
  private rainAppliedToday = false;

  // ── 싱글톤 ──────────────────────────────────────────────────

  static getInstance(): WeatherSystem {
    if (!WeatherSystem.instance) {
      WeatherSystem.instance = new WeatherSystem();
    }
    return WeatherSystem.instance;
  }

  static resetInstance(): void {
    WeatherSystem.instance?.destroy();
    WeatherSystem.instance = null;
  }

  private constructor() {
    super();
  }

  // ── 초기화 ──────────────────────────────────────────────────

  /**
   * WeatherSystem 초기화.
   * BootScene에서 TimeSystem 초기화 직후 호출.
   *
   * @param timeSystem  TimeSystem 싱글톤 인스턴스
   * @param savedWeather 저장된 날씨 (이어하기) 또는 'sunny' (새 게임 첫날)
   */
  init(timeSystem: TimeSystem, savedWeather: Weather = 'sunny'): void {
    this.timeSystem = timeSystem;
    this.currentWeather = savedWeather;
    this.rainAppliedToday = false;

    // TimeSystem에 현재 날씨 동기화
    this.timeSystem.setWeather(this.currentWeather);

    // 이벤트 구독 등록
    this.registerEvents();

    console.log(`[WeatherSystem] 초기화 완료 — 오늘 날씨: ${this.currentWeather}`);
  }

  // ── 이벤트 구독 ─────────────────────────────────────────────

  private registerEvents(): void {
    // 취침 시 → 다음 날 날씨 결정
    // slept 이벤트 페이로드: { penalized: boolean }
    // 계절은 sleep() 이후 TimeSystem에서 이미 다음 날로 넘어간 상태
    this.timeSystem.on('slept', () => {
      this.decideNextDayWeather();
    });

    // 날짜 변경 시 → 자동 물주기 플래그 초기화
    // (dayChanged는 slept 내부에서도 발행되므로 항상 초기화됨)
    this.timeSystem.on('dayChanged', () => {
      this.rainAppliedToday = false;
    });
  }

  // ── 날씨 결정 ───────────────────────────────────────────────

  /**
   * 취침 시 호출. 다음 날(= sleep() 이후 TimeSystem의 현재 계절) 기준으로
   * 날씨를 결정하고 TimeSystem에 반영.
   *
   * 계절 전환 당일이라면 이미 TimeSystem이 새 계절로 바뀐 상태이므로
   * 자동으로 새 계절 기준 확률이 적용됨.
   */
  private decideNextDayWeather(): void {
    const nextSeason = this.timeSystem.getSeason();
    const nextWeather = rollWeatherFromTable(nextSeason);

    this.currentWeather = nextWeather;
    this.timeSystem.setWeather(nextWeather);

    const isRain = nextWeather === 'rainy';
    this.emit('weatherDecided', { weather: nextWeather, isRain });

    console.log(
      `[WeatherSystem] 다음 날 날씨 결정 — 계절: ${nextSeason}, 날씨: ${nextWeather}`
    );
  }

  // ── 날씨 효과 적용 ───────────────────────────────────────────

  /**
   * 비 오는 날 아침, 밭 전체에 자동 물주기 적용.
   * FarmSystem이 하루 시작 시 호출. 이미 적용됐으면 무시.
   *
   * @param tiles 현재 밭 타일 배열
   * @returns 물주기가 적용된 새 타일 배열
   */
  applyRainToFarm(tiles: FarmTile[]): FarmTile[] {
    if (this.currentWeather !== 'rainy') return tiles;
    if (this.rainAppliedToday) return tiles;

    this.rainAppliedToday = true;

    const watered = tiles.map(tile => {
      if (tile.state === 'planted' || tile.state === 'growing') {
        return { ...tile, wateredToday: true };
      }
      return tile;
    });

    this.emit('rainApplied');
    console.log('[WeatherSystem] 비 → 밭 자동 물주기 적용 완료');
    return watered;
  }

  // ── 게터 ─────────────────────────────────────────────────────

  getCurrentWeather(): Weather {
    return this.currentWeather;
  }

  isRaining(): boolean {
    return this.currentWeather === 'rainy';
  }

  /** 돌다리 이용 가능 여부 */
  isStoneBridgeOpen(): boolean {
    return this.currentWeather !== 'rainy';
  }
}