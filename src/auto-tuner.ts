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

const COARSE_STEPS: Record<KnobParam, number> = {
  vhf: 25,
  uhf: 70,
  antenna: 36
};

const FINE_STEPS: Record<KnobParam, number> = {
  vhf: 3,
  uhf: 6,
  antenna: 5
};

const FINE_RANGE: Record<KnobParam, number> = {
  vhf: 40,
  uhf: 100,
  antenna: 60
};

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
      this.onComplete(result);
    } finally {
      this.isScanning = false;
      this.cancellationRequested = false;
    }
  }

  private async runScan(): Promise<ScanResult> {
    const foundSignals: Signal[] = [];
    const foundSignalIds = new Set<string>();

    let bestTuner: TunerState = { vhf: 100, uhf: 400, antenna: 180 };
    let bestStrength: number = 0;
    let bestMatch: SignalMatch = { signal: null, strength: 0, vhfMatch: 0, uhfMatch: 0, antennaMatch: 0 };

    const currentTuner: TunerState = { vhf: 100, uhf: 400, antenna: 180 };

    this._currentPhase = 'coarse';
    this.emitProgress('coarse', 0, null, 0, 0, '启动自动搜台...');

    const coarsePeaks: Array<{ tuner: TunerState; strength: number; match: SignalMatch }> = [];

    for (const param of ['vhf', 'uhf', 'antenna'] as KnobParam[]) {
      if (this.cancellationRequested) {
        this._currentPhase = 'cancelled';
        this.emitProgress('cancelled', 0, null, 0, 0, '扫描已取消');
        return { bestTuner, bestStrength, bestMatch, signalsFound: foundSignals };
      }

      const peaks = await this.coarseScanParam(param, currentTuner, (tuner, strength, match) => {
        if (match.signal && !foundSignalIds.has(match.signal.id) && strength > 0.5) {
          foundSignalIds.add(match.signal.id);
          foundSignals.push(match.signal);
        }
        if (strength > bestStrength) {
          bestStrength = strength;
          bestTuner = { ...tuner };
          bestMatch = match;
        }
      });
      coarsePeaks.push(...peaks);
    }

    coarsePeaks.sort((a, b) => b.strength - a.strength);
    const topPeaks = coarsePeaks.slice(0, 3);

    this._currentPhase = 'fine';

    for (let i = 0; i < topPeaks.length; i++) {
      if (this.cancellationRequested) {
        this._currentPhase = 'cancelled';
        this.emitProgress('cancelled', 0, null, 0, 0, '扫描已取消');
        return { bestTuner, bestStrength, bestMatch, signalsFound: foundSignals };
      }

      const peak = topPeaks[i];
      this.emitProgress('fine', (i / topPeaks.length) * 100, null, 0, peak.strength,
        `精扫峰值点 ${i + 1}/${topPeaks.length}...`);

      await this.sleep(300);

      const fineResult = await this.fineScan(peak.tuner, (tuner, strength, match) => {
        if (match.signal && !foundSignalIds.has(match.signal.id) && strength > 0.5) {
          foundSignalIds.add(match.signal.id);
          foundSignals.push(match.signal);
        }
        if (strength > bestStrength) {
          bestStrength = strength;
          bestTuner = { ...tuner };
          bestMatch = match;
        }
      });

      if (fineResult.strength > bestStrength) {
        bestStrength = fineResult.strength;
        bestTuner = { ...fineResult.tuner };
        bestMatch = fineResult.match;
      }
    }

    this.emitProgress('fine', 100, null, 0, bestStrength, '定位最佳位置...');
    await this.sleep(500);

    await this.smoothMoveTo(bestTuner, currentTuner);

    this._currentPhase = 'complete';
    this.emitProgress('complete', 100, null, 0, bestStrength,
      bestMatch.signal ? `锁定: ${bestMatch.signal.name}` : '扫描完成');

    return { bestTuner, bestStrength, bestMatch, signalsFound: foundSignals };
  }

  private async coarseScanParam(
    param: KnobParam,
    currentTuner: TunerState,
    onReading: (tuner: TunerState, strength: number, match: SignalMatch) => void
  ): Promise<Array<{ tuner: TunerState; strength: number; match: SignalMatch }>> {
    const range = RANGES[param];
    const step = COARSE_STEPS[param];
    const peaks: Array<{ tuner: TunerState; strength: number; match: SignalMatch }> = [];

    const paramNames: Record<KnobParam, string> = {
      vhf: 'VHF',
      uhf: 'UHF',
      antenna: '天线'
    };

    const totalSteps = Math.ceil((range.max - range.min) / step);

    let readings: Array<{ value: number; strength: number; match: SignalMatch }> = [];

    for (let i = 0; i <= totalSteps; i++) {
      if (this.cancellationRequested) return peaks;

      const value = clamp(range.min + i * step, range.min, range.max);
      currentTuner[param] = value;

      this.knobController.setValue(param, value);
      this.onTunerChange({ ...currentTuner });

      await this.sleep(60);

      const match = findBestSignalMatch(currentTuner, this.signals, this.getWeatherOffset());
      const strength = match.strength;

      readings.push({ value, strength, match });
      onReading({ ...currentTuner }, strength, match);

      const progress = (i / totalSteps) * 100;
      this.emitProgress('coarse', progress, param, value, strength,
        `粗扫 ${paramNames[param]}: ${Math.round(value)}`);
    }

    for (let i = 1; i < readings.length - 1; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const next = readings[i + 1];

      if (curr.strength > prev.strength && curr.strength > next.strength && curr.strength > 0.2) {
        const peakTuner = { ...currentTuner };
        peakTuner[param] = curr.value;
        peaks.push({ tuner: peakTuner, strength: curr.strength, match: curr.match });
      }
    }

    if (readings.length > 0) {
      const maxReading = readings.reduce((max, r) => r.strength > max.strength ? r : max, readings[0]);
      if (maxReading.strength > 0.2) {
        const peakTuner = { ...currentTuner };
        peakTuner[param] = maxReading.value;
        const exists = peaks.some(p => Math.abs(p.tuner[param] - maxReading.value) < step);
        if (!exists) {
          peaks.push({ tuner: peakTuner, strength: maxReading.strength, match: maxReading.match });
        }
      }
    }

    return peaks;
  }

  private async fineScan(
    startTuner: TunerState,
    onReading: (tuner: TunerState, strength: number, match: SignalMatch) => void
  ): Promise<{ tuner: TunerState; strength: number; match: SignalMatch }> {
    const currentTuner = { ...startTuner };
    let best = { tuner: { ...startTuner }, strength: 0, match: null as unknown as SignalMatch };

    for (const param of ['vhf', 'uhf', 'antenna'] as KnobParam[]) {
      if (this.cancellationRequested) return best;

      const range = RANGES[param];
      const fineRange = FINE_RANGE[param];
      const step = FINE_STEPS[param];
      const center = startTuner[param];
      const start = clamp(center - fineRange / 2, range.min, range.max);
      const end = clamp(center + fineRange / 2, range.min, range.max);

      const paramNames: Record<KnobParam, string> = {
        vhf: 'VHF',
        uhf: 'UHF',
        antenna: '天线'
      };

      const totalSteps = Math.ceil((end - start) / step);

      for (let i = 0; i <= totalSteps; i++) {
        if (this.cancellationRequested) return best;

        const value = clamp(start + i * step, range.min, range.max);
        currentTuner[param] = value;

        this.knobController.setValue(param, value);
        this.onTunerChange({ ...currentTuner });

        await this.sleep(40);

        const match = findBestSignalMatch(currentTuner, this.signals, this.getWeatherOffset());
        const strength = match.strength;

        onReading({ ...currentTuner }, strength, match);

        if (strength > best.strength) {
          best = { tuner: { ...currentTuner }, strength, match };
        }

        const progress = 50 + (i / totalSteps) * 50;
        this.emitProgress('fine', progress, param, value, strength,
          `精扫 ${paramNames[param]}: ${Math.round(value)}`);
      }

      currentTuner[param] = best.tuner[param];
      this.knobController.setValue(param, best.tuner[param]);
      this.onTunerChange({ ...currentTuner });
    }

    return best;
  }

  private async smoothMoveTo(target: TunerState, currentTuner: TunerState): Promise<void> {
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
