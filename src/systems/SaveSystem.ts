// ================================================================
// SaveSystem — IndexedDB 기반 저장/불러오기 시스템
// ================================================================
//
// 의존성: npm install idb
//
// 저장 구조:
//   DB명: FarmDiaryDB
//   스토어: saves
//     └── key: 'slot_main'   → 현재 세이브 데이터 (SaveData)
//     └── key: 'slot_backup' → 손상 감지 시 자동 백업
//
// 저장 시점: 취침 시에만 (수동 저장 없음)
// 실패 처리: 플레이어에게 알림 표시
// 손상 처리: 백업 저장 후 플레이어에게 선택지 제공
// ================================================================
import type {IDBPDatabase} from 'idb';
import { openDB } from 'idb';
import type {
  GameState,
  SaveData,
  SaveResult,
  LoadResult,
} from '../types';

import { SAVE_VERSION } from '../types';

// ── 상수 ────────────────────────────────────────────────────────

const DB_NAME = 'FarmDiaryDB';
const DB_VERSION = 1;
const STORE_NAME = 'saves';
const KEY_MAIN = 'slot_main';
const KEY_BACKUP = 'slot_backup';

// ── SaveSystem ───────────────────────────────────────────────────

export class SaveSystem {
  private db: IDBPDatabase | null = null;
  private _hasUnsavedChanges = false;

  // ── 초기화 ────────────────────────────────────────────────────

  /**
   * SaveSystem 초기화. 게임 시작 시 반드시 먼저 호출.
   * BootScene에서 await saveSystem.init() 으로 실행.
   */
  async init(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });

    // 브라우저 종료/새로고침 시 미저장 경고
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  /**
   * SaveSystem 정리. 게임 종료 시 호출.
   */
  destroy(): void {
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.db?.close();
    this.db = null;
  }

  // ── 저장 ──────────────────────────────────────────────────────

  /**
   * 게임 상태를 저장. 취침 시에만 호출.
   * 실패 시 SaveResult { success: false, reason } 반환.
   */
  async save(state: GameState): Promise<SaveResult> {
    if (!this.db) {
      return { success: false, reason: 'DB가 초기화되지 않았어요.' };
    }

    const saveData: SaveData = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state,
    };

    try {
      await this.db.put(STORE_NAME, saveData, KEY_MAIN);
      this._hasUnsavedChanges = false;
      console.log('[SaveSystem] 저장 완료:', saveData.savedAt);
      return { success: true };
    } catch (e) {
      const reason = this.parseError(e);
      console.error('[SaveSystem] 저장 실패:', reason);
      return { success: false, reason };
    }
  }

  /**
   * 게임 상태가 변경될 때 호출.
   * 취침 전까지 미저장 상태를 추적함.
   */
  markUnsaved(): void {
    this._hasUnsavedChanges = true;
  }

  get hasUnsavedChanges(): boolean {
    return this._hasUnsavedChanges;
  }

  // ── 불러오기 ──────────────────────────────────────────────────

  /**
   * 저장 데이터 불러오기.
   * 없으면 not_found, 손상되면 corrupted 반환.
   */
  async load(): Promise<LoadResult> {
    if (!this.db) {
      return { success: false, reason: 'unknown' };
    }

    let raw: unknown;

    try {
      raw = await this.db.get(STORE_NAME, KEY_MAIN);
    } catch (e) {
      console.error('[SaveSystem] 불러오기 실패:', e);
      return { success: false, reason: 'unknown' };
    }

    // 저장 데이터 없음 → 새 게임
    if (raw === undefined || raw === null) {
      return { success: false, reason: 'not_found' };
    }

    // 유효성 검사
    const validation = this.validate(raw);
    if (!validation.valid) {
      console.warn('[SaveSystem] 데이터 손상 감지:', validation.reason);
      await this.backupCorrupted(raw);
      return { success: false, reason: 'corrupted' };
    }

    // 버전 마이그레이션
    const migrated = this.migrate(raw as SaveData);

    return { success: true, data: migrated };
  }

  /**
   * 저장 데이터 존재 여부 확인.
   */
  async exists(): Promise<boolean> {
    if (!this.db) return false;
    try {
      const data = await this.db.get(STORE_NAME, KEY_MAIN);
      return data !== undefined && data !== null;
    } catch {
      return false;
    }
  }

  /**
   * 저장 데이터 삭제 (새 게임 시작 시).
   */
  async delete(): Promise<SaveResult> {
    if (!this.db) {
      return { success: false, reason: 'DB가 초기화되지 않았어요.' };
    }
    try {
      await this.db.delete(STORE_NAME, KEY_MAIN);
      this._hasUnsavedChanges = false;
      console.log('[SaveSystem] 세이브 데이터 삭제 완료');
      return { success: true };
    } catch (e) {
      return { success: false, reason: this.parseError(e) };
    }
  }

  // ── 백업 ──────────────────────────────────────────────────────

  /**
   * 손상된 데이터를 별도 키로 백업.
   * 플레이어가 나중에 "지원 요청" 시 활용 가능.
   */
  private async backupCorrupted(data: unknown): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.put(STORE_NAME, data, KEY_BACKUP);
      console.log('[SaveSystem] 손상 데이터 백업 완료 (slot_backup)');
    } catch (e) {
      console.error('[SaveSystem] 백업 저장 실패:', e);
    }
  }

  /**
   * 백업 데이터를 JSON 문자열로 내보내기.
   * 복구가 필요한 경우 개발자에게 전달 가능.
   */
  async exportBackup(): Promise<string | null> {
    if (!this.db) return null;
    try {
      const backup = await this.db.get(STORE_NAME, KEY_BACKUP);
      return backup ? JSON.stringify(backup, null, 2) : null;
    } catch {
      return null;
    }
  }

  // ── 유효성 검사 ───────────────────────────────────────────────

  /**
   * 불러온 데이터가 SaveData 구조를 갖추고 있는지 검사.
   * 필수 최상위 필드만 확인 (경량 검사).
   */
  private validate(raw: unknown): { valid: boolean; reason?: string } {
    if (typeof raw !== 'object' || raw === null) {
      return { valid: false, reason: '데이터가 객체가 아님' };
    }

    const data = raw as Record<string, unknown>;

    if (typeof data.version !== 'number') {
      return { valid: false, reason: 'version 필드 없음' };
    }
    if (typeof data.savedAt !== 'string') {
      return { valid: false, reason: 'savedAt 필드 없음' };
    }
    if (typeof data.state !== 'object' || data.state === null) {
      return { valid: false, reason: 'state 필드 없음' };
    }

    const state = data.state as Record<string, unknown>;

    // GameState 핵심 필드 확인
    const requiredFields: (keyof GameState)[] = [
      'houseLocation',
      'time',
      'energy',
      'gold',
      'farmTiles',
      'farmLevel',
      'tools',
      'inventory',
      'npcs',
      'records',
      'library',
      'museum',
    ];

    for (const field of requiredFields) {
      if (!(field in state)) {
        return { valid: false, reason: `state.${field} 필드 없음` };
      }
    }

    return { valid: true };
  }

  // ── 버전 마이그레이션 ─────────────────────────────────────────

  /**
   * 구버전 SaveData를 현재 버전으로 변환.
   * 새 필드가 추가될 때마다 여기에 케이스를 추가.
   *
   * 예시:
   *   v1 → v2: state에 fishingLevel 필드 추가
   *   v2 → v3: npcs 구조 변경
   */
  private migrate(data: SaveData): SaveData {
    let migrated = { ...data };

    // v1 → v2 (예시, 아직 v1이므로 실제 변환 없음)
    // if (migrated.version === 1) {
    //   migrated.state = {
    //     ...migrated.state,
    //     fishingLevel: { level: 1, exp: 0 },
    //   };
    //   migrated.version = 2;
    // }

    if (migrated.version !== SAVE_VERSION) {
      console.warn(
        `[SaveSystem] 버전 불일치: 저장=${migrated.version}, 현재=${SAVE_VERSION}`
      );
    }

    return migrated;
  }

  // ── 유틸리티 ─────────────────────────────────────────────────

  private parseError(e: unknown): string {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      return '저장 공간이 부족해요. 브라우저 저장 공간을 확인해주세요.';
    }
    if (e instanceof Error) return e.message;
    return '알 수 없는 오류가 발생했어요.';
  }

  /**
   * 브라우저 종료/새로고침 시 미저장 경고.
   * 취침 후 저장되면 경고 없음.
   */
  private handleBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (this._hasUnsavedChanges) {
      e.preventDefault();
      // 모던 브라우저는 커스텀 메시지 무시하고 기본 경고창 표시
      e.returnValue = '';
    }
  };
}