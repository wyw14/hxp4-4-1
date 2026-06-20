import type { TunerState, Signal, WeatherOffset, WeatherConfig } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(min: number, max: number, value: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

export function centerOfRange(range: [number, number]): number {
  return (range[0] + range[1]) / 2;
}

export function calculateMatchStrength(
  value: number,
  range: [number, number],
  falloff: number = 15
): number {
  const center = centerOfRange(range);
  const halfWidth = (range[1] - range[0]) / 2;
  const distance = Math.abs(value - center);

  if (distance <= halfWidth) {
    const normalized = inverseLerp(halfWidth, 0, distance);
    return Math.pow(normalized, 0.5);
  } else {
    const outside = distance - halfWidth;
    return Math.max(0, Math.exp(-outside / falloff));
  }
}

export interface SignalMatch {
  signal: Signal | null;
  strength: number;
  vhfMatch: number;
  uhfMatch: number;
  antennaMatch: number;
}

export function findBestSignalMatch(
  tuner: TunerState,
  signals: Signal[],
  weatherOffset: WeatherOffset
): SignalMatch {
  let bestMatch: SignalMatch = {
    signal: null,
    strength: 0,
    vhfMatch: 0,
    uhfMatch: 0,
    antennaMatch: 0
  };

  for (const signal of signals) {
    let effectiveVhfRange: [number, number] = [...signal.vhfRange] as [number, number];
    let effectiveUhfRange: [number, number] = [...signal.uhfRange] as [number, number];
    let effectiveAntennaRange: [number, number] = [...signal.antennaAngle] as [number, number];

    if (signal.weatherAffected) {
      effectiveVhfRange = [
        effectiveVhfRange[0] + weatherOffset.vhfShift,
        effectiveVhfRange[1] + weatherOffset.vhfShift
      ];
      effectiveUhfRange = [
        effectiveUhfRange[0] + weatherOffset.uhfShift,
        effectiveUhfRange[1] + weatherOffset.uhfShift
      ];
      effectiveAntennaRange = [
        effectiveAntennaRange[0] + weatherOffset.antennaShift,
        effectiveAntennaRange[1] + weatherOffset.antennaShift
      ];
    }

    const vhfMatch = calculateMatchStrength(tuner.vhf, effectiveVhfRange, 12);
    const uhfMatch = calculateMatchStrength(tuner.uhf, effectiveUhfRange, 30);
    const antennaMatch = calculateMatchStrength(tuner.antenna, effectiveAntennaRange, 25);

    const combinedStrength = (vhfMatch * 0.35 + uhfMatch * 0.35 + antennaMatch * 0.3) * signal.intensity;

    if (combinedStrength > bestMatch.strength) {
      bestMatch = {
        signal,
        strength: combinedStrength,
        vhfMatch,
        uhfMatch,
        antennaMatch
      };
    }
  }

  return bestMatch;
}

export function getSignalColor(signal: Signal | null, strength: number): [number, number, number] {
  if (!signal || strength < 0.1) {
    return [0.08, 0.08, 0.1];
  }

  const hue = signal.id === 'signal_01' ? 0.0
    : signal.id === 'signal_02' ? 0.62
    : signal.id === 'signal_03' ? 0.33
    : 0.12;

  const sat = 0.7 * strength;
  const light = 0.35 * strength;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue * 6) % 2 - 1));
  const m = light - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 1/6) { r = c; g = x; }
  else if (hue < 2/6) { r = x; g = c; }
  else if (hue < 3/6) { g = c; b = x; }
  else if (hue < 4/6) { g = x; b = c; }
  else if (hue < 5/6) { r = x; b = c; }
  else { r = c; b = x; }

  return [r + m, g + m, b + m];
}

export class WeatherSystem {
  private config: WeatherConfig;
  private offset: WeatherOffset;
  private targetOffset: WeatherOffset;
  private lastUpdate: number;
  private stormPulse: number = 0;
  private flashActive: boolean = false;
  private flashTimer: number = 0;

  constructor(config: WeatherConfig) {
    this.config = config;
    this.offset = { vhfShift: 0, uhfShift: 0, antennaShift: 0 };
    this.targetOffset = { vhfShift: 0, uhfShift: 0, antennaShift: 0 };
    this.lastUpdate = Date.now();
    this.generateNewTarget();
  }

  private generateNewTarget(): void {
    const { vhfShift, uhfShift, antennaShift } = this.config.baseOffset;
    this.targetOffset = {
      vhfShift: vhfShift[0] + Math.random() * (vhfShift[1] - vhfShift[0]),
      uhfShift: uhfShift[0] + Math.random() * (uhfShift[1] - uhfShift[0]),
      antennaShift: antennaShift[0] + Math.random() * (antennaShift[1] - antennaShift[0])
    };
  }

  update(): { offset: WeatherOffset; rainIntensity: number; flash: boolean } {
    const now = Date.now();

    if (now - this.lastUpdate > this.config.intervalMs) {
      this.generateNewTarget();
      this.lastUpdate = now;
    }

    const smoothFactor = 0.008;
    this.offset.vhfShift += (this.targetOffset.vhfShift - this.offset.vhfShift) * smoothFactor;
    this.offset.uhfShift += (this.targetOffset.uhfShift - this.offset.uhfShift) * smoothFactor;
    this.offset.antennaShift += (this.targetOffset.antennaShift - this.offset.antennaShift) * smoothFactor;

    this.stormPulse = 0.5 + 0.5 * Math.sin(now * 0.001) * Math.sin(now * 0.0007);
    const rainIntensity = this.config.stormIntensity * (0.6 + 0.4 * this.stormPulse);

    if (!this.flashActive && Math.random() < 0.003) {
      this.flashActive = true;
      this.flashTimer = 0.08 + Math.random() * 0.12;
    }

    if (this.flashActive) {
      this.flashTimer -= 0.016;
      if (this.flashTimer <= 0) {
        this.flashActive = false;
      }
    }

    return {
      offset: this.offset,
      rainIntensity,
      flash: this.flashActive
    };
  }
}
