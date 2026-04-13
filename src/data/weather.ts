// ================================================================
// data/weather.ts — 날씨 확률 테이블
// ================================================================
//
// 추후 흐림·눈 등 날씨 종류 추가 시 여기서만 수정하면 됩니다.
// ================================================================

import type { Season, Weather } from '../types';

export interface WeatherEntry {
  weather: Weather;
  probability: number; // 0~1 (모든 항목의 합 = 1.0)
}

/** 계절별 날씨 확률 테이블 */
export const WEATHER_TABLE: Record<Season, WeatherEntry[]> = {
  spring: [
    { weather: 'rainy', probability: 0.35 },
    { weather: 'sunny', probability: 0.65 },
  ],
  summer: [
    { weather: 'rainy', probability: 0.50 },
    { weather: 'sunny', probability: 0.50 },
  ],
  autumn: [
    { weather: 'rainy', probability: 0.25 },
    { weather: 'sunny', probability: 0.75 },
  ],
};

/**
 * 확률 테이블을 기반으로 날씨를 뽑는 유틸 함수.
 * 추후 날씨 종류가 늘어나도 로직 변경 없이 테이블만 수정하면 됨.
 */
export function rollWeatherFromTable(season: Season): Weather {
  const table = WEATHER_TABLE[season];
  const rand = Math.random();
  let cumulative = 0;

  for (const entry of table) {
    cumulative += entry.probability;
    if (rand < cumulative) return entry.weather;
  }

  // 부동소수점 오차 대비 fallback
  return table[table.length - 1].weather;
}