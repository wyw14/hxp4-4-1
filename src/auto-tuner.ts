import type { TunerState, WeatherOffset, Signal } from './types';
import { findBestSignalMatch, clamp, type SignalMatch } from './signal';
import type { KnobController, KnobParam } from './knobs';

export type ScanPhase = 'idle' | 'coarse' | 'fine' | 'complete' | 'cancelled';

export interface ScanResult {
  bestTuner: TunerState;
  bestStrength: number;
  bestMatch: SignalMatch;
  signalsFound: Signal[];
}

export interface ScanProgress {
  phase: ScanPhase;
  progress: number;
  currentParam: KnobParam | null;
  currentValue: number;
  currentStrength: number;
  message: string;
}

type ScanCallback = (tuner: TunerState) => void;
type ProgressCallback = (progress: ScanProgress) => void;
type CompleteCallback = (result: ScanResult) => void;

const RANGES: Record<KnobParam, { min: number; max: number }> = {
  vhf: { min: 0, max: 250 },
  uhf: { min: 100, max: 800 },
  antenna: { min: 0, max: 360 }
};

const COARSE_GRID: Record<KnobParam, number> = {
  vhf: 50,
  uhf: 140,
  antenna: 72
};

const FINE_INITIAL_STEP: Record<KnobParam, number> = {
  vhf: 8,
  uhf: 15,
  antenna: 12
};

const FINE_MIN_STEP: Record<KnobParam, number> = {
  vhf: 1,
  uhf: 2,
  antenna: 2
};

const PARAM_NAMES: Record<KnobParam, string> = {
  vhf: 'VHF',
  uhf: 'UHF',
  antenna: '天线'
};

interface ScanPoint {
  tuner: TunerState;
  strength: number;
  match: SignalMatch;
}

export class AutoTuner {
  private signals: Signal[];
  private knobController: KnobController;
  private getWeatherOffset: () => WeatherOffset;

  private isScanning: boolean = false;
  private cancellationRequested: boolean = false;
  private _currentPhase: ScanPhase = 'idle';

  private onTunerChange: ScanCallback;
  private onProgress: ProgressCallback;
  private onComplete: CompleteCallback;

  constructor(
    signals: Signal[],
    knobController: KnobController,
    getWeatherOffset: () => WeatherOffset,
    onTunerChange: ScanCallback,
    onProgress: ProgressCallback,
    onComplete: CompleteCallback
  ) {
    this.signals = signals;
    this.knobController = knobController;
    this.getWeatherOffset = getWeatherOffset;
    this.onTunerChange = onTunerChange;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
  }

  isActive(): boolean {
    return this.isScanning;
  }

  getPhase(): ScanPhase {
    return this._currentPhase;
  }

  cancel(): void {
    if (this.isScanning) {
      this.cancellationRequested = true;
    }
  }

  async start(): Promise<void> {
    if (this.isScanning) return;

    this.isScanning = true;
    this.cancellationRequested = false;

    try {
      const result = await this.runScan();

      if (!this.cancellationRequested) {
        this.onComplete(result);
      }
    } finally {
      if (this.cancellationRequested) {
        this._currentPhase = 'cancelled';
        this.emitProgress('cancelled', 0, null, 0, 0, '扫描已取消');
      }
      this.isScanning = false;
      this.cancellationRequested = false;
    }
  }

  private async runScan(): Promise<ScanResult> {
    const foundSignals: Signal[] = [];
    const foundSignalIds = new Set<string>();

    let globalBest: ScanPoint = {
      tuner: { vhf: 100, uhf: 400, antenna: 180 },
      strength: 0,
      match: { signal: null, strength: 0, vhfMatch: 0, uhfMatch: 0, antennaMatch: 0 }
    };

    const currentTuner: TunerState = { vhf: 100, uhf: 400, antenna: 180 };

    this._currentPhase = 'coarse';
    this.emitProgress('coarse', 0, null, 0, 0, '启动自动搜台...');

    const trackSignal = (match: SignalMatch, strength: number): void => {
      if (match.signal && !foundSignalIds.has(match.signal.id) && strength > 0.5) {
        foundSignalIds.add(match.signal.id);
        foundSignals.push(match.signal);
      }
    };

    const updateGlobalBest = (point: ScanPoint): void => {
      if (point.strength > globalBest.strength) {
        globalBest = { ...point, tuner: { ...point.tuner }, match: { ...point.match } };
      }
    };

    const coarsePoints = await this.coarseScan3D(currentTuner, (point) => {
      trackSignal(point.match, point.strength);
      updateGlobalBest(point);
    });

    if (this.cancellationRequested) {
      return {
        bestTuner: globalBest.tuner,
        bestStrength: globalBest.strength,
        bestMatch: globalBest.match,
        signalsFound: foundSignals
      };
    }

    const candidates = coarsePoints
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3)
      .filter(p => p.strength > 0.15);

    if (candidates.length === 0) {
      candidates.push(globalBest);
    }

    this._currentPhase = 'fine';

    for (let i = 0; i < candidates.length; i++) {
      if (this.cancellationRequested) {
        return {
          bestTuner: globalBest.tuner,
          bestStrength: globalBest.strength,
          bestMatch: globalBest.match,
          signalsFound: foundSignals
        };
      }

      const candidate = candidates[i];
      this.emitProgress('fine', (i / candidates.length) * 100, null, 0, candidate.strength,
        `精扫候选点 ${i + 1}/${candidates.length} (${(candidate.strength * 100).toFixed(0)}%)...`);

      await this.sleep(200);

      const fineResult = await this.fineScanGradient(candidate.tuner, currentTuner, (point) => {
        trackSignal(point.match, point.strength);
        updateGlobalBest(point);
      });

      if (fineResult.strength > globalBest.strength) {
        globalBest = { ...fineResult, tuner: { ...fineResult.tuner }, match: { ...fineResult.match } };
      }

      if (this.cancellationRequested) {
        return {
          bestTuner: globalBest.tuner,
          bestStrength: globalBest.strength,
          bestMatch: globalBest.match,
          signalsFound: foundSignals
        };
      }
    }

    if (this.cancellationRequested) {
      return {
        bestTuner: globalBest.tuner,
        bestStrength: globalBest.strength,
        bestMatch: globalBest.match,
        signalsFound: foundSignals
      };
    }

    this.emitProgress('fine', 100, null, 0, globalBest.strength, '定位最佳位置...');
    await this.sleep(300);

    if (this.cancellationRequested) {
      return {
        bestTuner: globalBest.tuner,
        bestStrength: globalBest.strength,
        bestMatch: globalBest.match,
        signalsFound: foundSignals
      };
    }

    await this.smoothMoveTo(globalBest.tuner, currentTuner);

    if (this.cancellationRequested) {
      return {
        bestTuner: globalBest.tuner,
        bestStrength: globalBest.strength,
        bestMatch: globalBest.match,
        signalsFound: foundSignals
      };
    }

    this._currentPhase = 'complete';
    this.emitProgress('complete', 100, null, 0, globalBest.strength,
      globalBest.match.signal ? `锁定: ${globalBest.match.signal.name}` : '扫描完成');

    return {
      bestTuner: globalBest.tuner,
      bestStrength: globalBest.strength,
      bestMatch: globalBest.match,
      signalsFound: foundSignals
    };
  }

  private async coarseScan3D(
    currentTuner: TunerState,
    onPoint: (point: ScanPoint) => void
  ): Promise<ScanPoint[]> {
    const points: ScanPoint[] = [];

    const vhfValues = this.generateGridValues('vhf');
    const uhfValues = this.generateGridValues('uhf');
    const antennaValues = this.generateGridValues('antenna');

    const totalPoints = vhfValues.length * uhfValues.length * antennaValues.length;
    let completedPoints = 0;

    for (const vhf of vhfValues) {
      for (const uhf of uhfValues) {
        for (const antenna of antennaValues) {
          if (this.cancellationRequested) return points;

          currentTuner.vhf = vhf;
          currentTuner.uhf = uhf;
          currentTuner.antenna = antenna;

          this.setTunerKnobs(currentTuner);
          this.onTunerChange({ ...currentTuner });

          await this.sleep(50);

          const match = findBestSignalMatch(currentTuner, this.signals, this.getWeatherOffset());
          const strength = match.strength;

          const point: ScanPoint = {
            tuner: { ...currentTuner },
            strength,
            match
          };

          points.push(point);
          onPoint(point);

          completedPoints++;
          const progress = (completedPoints / totalPoints) * 100;
          this.emitProgress('coarse', progress, 'vhf', vhf, strength,
            `粗扫网格: VHF=${Math.round(vhf)}, UHF=${Math.round(uhf)}, 天线=${Math.round(antenna)}°`);
        }
      }
    }

    return points;
  }

  private generateGridValues(param: KnobParam): number[] {
    const range = RANGES[param];
    const step = COARSE_GRID[param];
    const values: number[] = [];

    for (let value = range.min; value <= range.max; value += step) {
      values.push(clamp(value, range.min, range.max));
    }

    if (values[values.length - 1] < range.max) {
      values.push(range.max);
    }

    return values;
  }

  private async fineScanGradient(
    center: TunerState,
    currentTuner: TunerState,
    onPoint: (point: ScanPoint) => void
  ): Promise<ScanPoint> {
    let best: ScanPoint = {
      tuner: { ...center },
      strength: 0,
      match: { signal: null, strength: 0, vhfMatch: 0, uhfMatch: 0, antennaMatch: 0 }
    };

    currentTuner.vhf = center.vhf;
    currentTuner.uhf = center.uhf;
    currentTuner.antenna = center.antenna;

    const initialMatch = await this.measurePoint(currentTuner, onPoint);
    best = { ...initialMatch, tuner: { ...initialMatch.tuner }, match: { ...initialMatch.match } };

    let stepSizes: Record<KnobParam, number> = { ...FINE_INITIAL_STEP };
    let iterations = 0;
    const maxIterations = 8;

    while (iterations < maxIterations && !this.cancellationRequested) {
      let improved = false;

      for (const param of ['vhf', 'uhf', 'antenna'] as KnobParam[]) {
        if (this.cancellationRequested) return best;

        const step = stepSizes[param];
        if (step < FINE_MIN_STEP[param]) continue;

        const currentValue = best.tuner[param];
        const range = RANGES[param];

        const testUp = clamp(currentValue + step, range.min, range.max);
        const testDown = clamp(currentValue - step, range.min, range.max);

        currentTuner[param] = testUp;
        const pointUp = await this.measurePoint(currentTuner, onPoint, param, iterations, maxIterations);

        if (this.cancellationRequested) return best;

        currentTuner[param] = testDown;
        const pointDown = await this.measurePoint(currentTuner, onPoint, param, iterations, maxIterations);

        if (this.cancellationRequested) return best;

        if (pointUp.strength > best.strength && pointUp.strength >= pointDown.strength) {
          best = { ...pointUp, tuner: { ...pointUp.tuner }, match: { ...pointUp.match } };
          currentTuner[param] = testUp;
          improved = true;
        } else if (pointDown.strength > best.strength) {
          best = { ...pointDown, tuner: { ...pointDown.tuner }, match: { ...pointDown.match } };
          currentTuner[param] = testDown;
          improved = true;
        } else {
          currentTuner[param] = currentValue;
        }

        const baseProgress = 50 + (iterations / maxIterations) * 50;
        this.emitProgress('fine', baseProgress, param, best.tuner[param], best.strength,
          `精扫 ${PARAM_NAMES[param]}: ${Math.round(best.tuner[param])}${param === 'antenna' ? '°' : ''} (步长: ${step})`);
      }

      if (!improved) {
        for (const param of ['vhf', 'uhf', 'antenna'] as KnobParam[]) {
          stepSizes[param] = Math.max(stepSizes[param] * 0.5, FINE_MIN_STEP[param]);
        }
      }

      iterations++;
    }

    currentTuner.vhf = best.tuner.vhf;
    currentTuner.uhf = best.tuner.uhf;
    currentTuner.antenna = best.tuner.antenna;
    this.setTunerKnobs(currentTuner);
    this.onTunerChange({ ...currentTuner });

    return best;
  }

  private async measurePoint(
    tuner: TunerState,
    onPoint: (point: ScanPoint) => void,
    _param?: KnobParam,
    _iteration?: number,
    _maxIterations?: number
  ): Promise<ScanPoint> {
    this.setTunerKnobs(tuner);
    this.onTunerChange({ ...tuner });

    await this.sleep(35);

    const match = findBestSignalMatch(tuner, this.signals, this.getWeatherOffset());
    const strength = match.strength;

    const point: ScanPoint = {
      tuner: { ...tuner },
      strength,
      match
    };

    onPoint(point);

    return point;
  }

  private setTunerKnobs(tuner: TunerState): void {
    this.knobController.setValue('vhf', tuner.vhf);
    this.knobController.setValue('uhf', tuner.uhf);
    this.knobController.setValue('antenna', tuner.antenna);
  }

  private async smoothMoveTo(target: TunerState, currentTuner: TunerState): Promise<void> {
    if (this.cancellationRequested) return;

    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      if (this.cancellationRequested) return;

      const t = i / steps;
      for (const param of ['vhf', 'uhf', 'antenna'] as KnobParam[]) {
        const value = currentTuner[param] + (target[param] - currentTuner[param]) * t;
        this.knobController.setValue(param, value);
        currentTuner[param] = value;
      }
      this.onTunerChange({ ...currentTuner });
      await this.sleep(25);
    }
  }

  private emitProgress(
    phase: ScanPhase,
    progress: number,
    currentParam: KnobParam | null,
    currentValue: number,
    currentStrength: number,
    message: string
  ): void {
    if (this.cancellationRequested && phase !== 'cancelled') {
      return;
    }
    this.onProgress({
      phase,
      progress,
      currentParam,
      currentValue,
      currentStrength,
      message
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
