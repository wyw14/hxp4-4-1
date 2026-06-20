export interface SignalRange {
  vhfRange: [number, number];
  uhfRange: [number, number];
  antennaAngle: [number, number];
}

export interface Signal extends SignalRange {
  id: string;
  name: string;
  fragmentPath: string;
  description: string;
  intensity: number;
  weatherAffected: boolean;
}

export interface WeatherConfig {
  baseOffset: {
    vhfShift: [number, number];
    uhfShift: [number, number];
    antennaShift: [number, number];
  };
  intervalMs: number;
  stormIntensity: number;
}

export interface SignalsData {
  signals: Signal[];
  weatherConfig: WeatherConfig;
}

export interface TunerState {
  vhf: number;
  uhf: number;
  antenna: number;
}

export interface WeatherOffset {
  vhfShift: number;
  uhfShift: number;
  antennaShift: number;
}

export interface KnobState {
  param: 'vhf' | 'uhf' | 'antenna';
  value: number;
  min: number;
  max: number;
  isDragging: boolean;
  startY: number;
  startValue: number;
}
