// ================================================================
// data/tools.ts — 농기구 정적 데이터
// ================================================================

import type { ToolType } from '../types';

export interface ToolData {
  id: string;
  type: ToolType;
  label: string;
  energyCost: number;    // 1회 사용당 기력 소모
  durabilityCost: number; // 1회 사용당 내구도 소모
  maxDurability: number;
}

export const TOOL_DATA: Record<ToolType, ToolData> = {
  hoe: {
    id:             'hoe',
    type:           'hoe',
    label:          '괭이',
    energyCost:     4,
    durabilityCost: 6,
    maxDurability:  500,
  },
  wateringCan: {
    id:             'wateringCan',
    type:           'wateringCan',
    label:          '물뿌리개',
    energyCost:     2,   // TODO: 기획 확정 후 수정
    durabilityCost: 6,
    maxDurability:  500,
  },
  sickle: {
    id:             'sickle',
    type:           'sickle',
    label:          '낫',
    energyCost:     2,
    durabilityCost: 6,
    maxDurability:  500,
  },
  fishingRod: {
    id:             'fishingRod',
    type:           'fishingRod',
    label:          '낚싯대',
    energyCost:     6,
    durabilityCost: 6,
    maxDurability:  500,
  },
};