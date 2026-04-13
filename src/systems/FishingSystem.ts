// ================================================================
// FishingSystem — 낚시 상태 머신
// ================================================================
//
// 상태 흐름:
//   idle → charging → cast → float → bite → fight → catch/fail
//
// 물고기 AI:
//   pull → dash → rest → pull ... (패턴 기반 상태 머신)
//
// 발행 이벤트:
//   'chargingStart'   ()
//   'chargingUpdate'  (power: number)        ← 0~1
//   'chargingCancel'  ()                     ← 5초 초과
//   'cast'            (power: number)
//   'splash'          (landed: boolean)      ← 물 착지 여부
//   'floatStart'      ()
//   'biteWarning'     ()                     ← 예비 입질
//   'bite'            ()                     ← 확정 입질
//   'fightStart'      ()
//   'tensionUpdate'   (tension: number)
//   'catchUpdate'     (catchGauge: number)
//   'fishAIState'     (state: FishAIState)
//   'catch'           (fishId: string)
//   'fail'            (reason: FailReason)
//   'reset'           ()
// ================================================================

import Phaser from 'phaser';
import {
  FISHING_CONFIG, rollFish,
  type FishLocation,
} from '../data/fishing';

// ── 타입 ────────────────────────────────────────────────────────

export type FishingState =
  | 'idle' | 'charging' | 'cast'
  | 'float' | 'bite' | 'fight'
  | 'catch' | 'fail';

export type FishAIState = 'pull' | 'dash' | 'rest';
export type FailReason  = 'line_break' | 'fish_escape' | 'misscast' | 'overcharge';

// ── FishingSystem ─────────────────────────────────────────────────

export class FishingSystem extends Phaser.Events.EventEmitter {
  private scene!:    Phaser.Scene;
  private state:     FishingState = 'idle';
  private location:  FishLocation = 'sea';

  // 충전
  private chargeStart  = 0;
  private chargeTimer?: Phaser.Time.TimerEvent;

  // 줄다리기
  private tension      = 50;  // 0~100
  private catchGauge   = FISHING_CONFIG.CATCH_GAUGE_MAX as number;
  private isHolding    = false;

  // 물고기 AI
  private fishAIState: FishAIState = 'pull';
  private fishAITimer?: Phaser.Time.TimerEvent;

  // 결과
  private caughtFishId: string | null = null;

  // ── 초기화 ────────────────────────────────────────────────────

  init(scene: Phaser.Scene): void {
    this.scene = scene;
    this.reset();
  }

  // ── 상태 게터 ─────────────────────────────────────────────────

  getState():      FishingState { return this.state; }
  getTension():    number       { return this.tension; }
  getCatchGauge(): number       { return this.catchGauge; }
  getFishAIState():FishAIState  { return this.fishAIState; }
  isIdle():        boolean      { return this.state === 'idle'; }
  isBusy():        boolean      { return this.state !== 'idle'; }
  getCaughtFish(): string|null  { return this.caughtFishId; }

  // ── 충전 시작 ─────────────────────────────────────────────────

  startCharging(): void {
    if (this.state !== 'idle') return;
    this.state      = 'charging';
    this.chargeStart = this.scene.time.now;
    this.emit('chargingStart');

    // 5초 초과 → 힘 풀림
    this.chargeTimer = this.scene.time.delayedCall(
      FISHING_CONFIG.CHARGE_MAX_SEC * 1000,
      () => this.cancelCharge()
    );
  }

  // 매 프레임 호출 (charging 중)
  updateCharging(): void {
    if (this.state !== 'charging') return;
    const t = Math.min(
      (this.scene.time.now - this.chargeStart) / (FISHING_CONFIG.CHARGE_MAX_SEC * 1000),
      1
    );
    const power = 1 - Math.pow(1 - t, 2); // ease-out
    this.emit('chargingUpdate', power);
  }

  private cancelCharge(): void {
    this.chargeTimer?.remove();
    this.state = 'idle';
    this.emit('chargingCancel');
    this.emit('reset');
  }

  // ── 던지기 ────────────────────────────────────────────────────

  /**
   * 버튼 떼는 순간 호출.
   * @param location 현재 낚시 장소
   */
  release(location: FishLocation): number {
    if (this.state !== 'charging') return 0;
    this.chargeTimer?.remove();
    this.location = location;

    const elapsed = (this.scene.time.now - this.chargeStart) / (FISHING_CONFIG.CHARGE_MAX_SEC * 1000);
    const t       = Math.min(elapsed, 1);
    const power   = 1 - Math.pow(1 - t, 2);

    this.state = 'cast';
    this.emit('cast', power);
    return power;
  }

  // ── 착지 판정 ─────────────────────────────────────────────────

  /**
   * 찌 착지 후 호출.
   * @param landedOnWater 물 타일에 착지했는지
   */
  onLand(landedOnWater: boolean): void {
    if (this.state !== 'cast') return;
    this.emit('splash', landedOnWater);

    if (!landedOnWater) {
      // 헛손질
      this.state = 'idle';
      this.emit('fail', 'misscast');
      this.emit('reset');
      return;
    }

    // 착수 성공 → 대기
    this.state = 'float';
    this.emit('floatStart');

    const waitMs = Phaser.Math.Between(
      FISHING_CONFIG.WAIT_MIN_SEC * 1000,
      FISHING_CONFIG.WAIT_MAX_SEC * 1000
    );

    // 예비 입질 (대기 시간 70% 지점)
    this.scene.time.delayedCall(waitMs * 0.7, () => {
      if (this.state !== 'float') return;
      this.emit('biteWarning');
    });

    // 확정 입질
    this.scene.time.delayedCall(waitMs, () => {
      if (this.state !== 'float') return;
      this.state = 'bite';
      this.emit('bite');

      // 0.8초 후 FIGHT 시작
      this.scene.time.delayedCall(800, () => {
        if (this.state !== 'bite') return;
        this.startFight();
      });
    });
  }

  // ── 줄다리기 ──────────────────────────────────────────────────

  private startFight(): void {
    this.state      = 'fight';
    this.tension    = 50;
    this.catchGauge = FISHING_CONFIG.CATCH_GAUGE_MAX;
    this.caughtFishId = rollFish(this.location);

    this.emit('fightStart');
    this.startFishAI();
  }

  /** 홀드 키 상태 업데이트 */
  setHolding(holding: boolean): void { this.isHolding = holding; }

  /** 매 프레임 호출 (fight 중) */
  updateFight(delta: number): void {
    if (this.state !== 'fight') return;
    const dt = delta / 1000;

    // 텐션 계산
    const playerForce = this.isHolding
      ? FISHING_CONFIG.TENSION_HOLD_RATE
      : -FISHING_CONFIG.TENSION_DECAY;

    const fishForce = this.getFishForce();
    this.tension = Phaser.Math.Clamp(
      this.tension + (playerForce + fishForce) * dt,
      FISHING_CONFIG.TENSION_MIN,
      FISHING_CONFIG.TENSION_MAX
    );

    this.emit('tensionUpdate', this.tension);

    // 안정 구간 판정
    const inSafe = this.tension >= FISHING_CONFIG.TENSION_SAFE_LOW
                && this.tension <= FISHING_CONFIG.TENSION_SAFE_HIGH;

    if (inSafe) {
      this.catchGauge = Math.max(0,
        this.catchGauge - FISHING_CONFIG.CATCH_RATE_PER_S * dt
      );
      this.emit('catchUpdate', this.catchGauge);

      if (this.catchGauge <= 0) {
        this.completeCatch();
        return;
      }
    }

    // 실패 판정
    if (this.tension >= FISHING_CONFIG.TENSION_MAX) {
      this.endFight('line_break');
    } else if (this.tension <= FISHING_CONFIG.TENSION_MIN) {
      this.endFight('fish_escape');
    }
  }

  private getFishForce(): number {
    switch (this.fishAIState) {
      case 'pull': return FISHING_CONFIG.FISH_PULL_RATE;
      case 'dash': return FISHING_CONFIG.FISH_DASH_RATE;
      case 'rest': return -FISHING_CONFIG.FISH_REST_RATE;
    }
  }

  // ── 물고기 AI ─────────────────────────────────────────────────

  private startFishAI(): void {
    this.setFishAIState('pull');
    this.scheduleNextFishState();
  }

  private scheduleNextFishState(): void {
    this.fishAITimer?.remove();

    // 상태별 지속 시간 (랜덤)
    const durations: Record<FishAIState, [number, number]> = {
      pull: [2000, 4000],
      dash: [500,  1200],
      rest: [1000, 2500],
    };
    const [min, max] = durations[this.fishAIState];
    const delay = Phaser.Math.Between(min, max);

    this.fishAITimer = this.scene.time.delayedCall(delay, () => {
      if (this.state !== 'fight') return;
      this.transitionFishAI();
    });
  }

  private transitionFishAI(): void {
    // pull → dash(30%) or rest(70%)
    // dash → rest
    // rest → pull
    const next: Record<FishAIState, FishAIState> = {
      pull: Math.random() < 0.3 ? 'dash' : 'rest',
      dash: 'rest',
      rest: 'pull',
    };
    this.setFishAIState(next[this.fishAIState]);
    this.scheduleNextFishState();
  }

  private setFishAIState(s: FishAIState): void {
    this.fishAIState = s;
    this.emit('fishAIState', s);
  }

  // ── 결과 처리 ─────────────────────────────────────────────────

  private completeCatch(): void {
    this.fishAITimer?.remove();
    this.state = 'catch';
    this.emit('catch', this.caughtFishId);
    this.scene.time.delayedCall(1500, () => this.reset());
  }

  private endFight(reason: FailReason): void {
    this.fishAITimer?.remove();
    this.state = 'fail';
    this.emit('fail', reason);
    this.scene.time.delayedCall(1000, () => this.reset());
  }

  // ── 리셋 ──────────────────────────────────────────────────────

  reset(): void {
    this.chargeTimer?.remove();
    this.fishAITimer?.remove();
    this.state        = 'idle';
    this.tension      = 50;
    this.catchGauge   = FISHING_CONFIG.CATCH_GAUGE_MAX as number;
    this.isHolding    = false;
    this.caughtFishId = null;
    this.emit('reset');
  }

  /** 씬 전환 등 외부에서 강제 리셋 */
  forceReset(): void {
    this.reset();
  }
}