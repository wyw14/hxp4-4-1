import type { KnobState } from './types';
import { clamp } from './signal';

export type KnobParam = 'vhf' | 'uhf' | 'antenna';

export interface KnobConfig {
  param: KnobParam;
  element: HTMLElement;
  valueElement: HTMLElement;
  min: number;
  max: number;
  initialValue: number;
  sensitivity?: number;
}

export class KnobController {
  private configs: Map<KnobParam, KnobConfig>;
  private states: Map<KnobParam, KnobState>;
  private onChange: (param: KnobParam, value: number) => void;

  constructor(configs: KnobConfig[], onChange: (param: KnobParam, value: number) => void) {
    this.configs = new Map();
    this.states = new Map();
    this.onChange = onChange;

    for (const cfg of configs) {
      this.configs.set(cfg.param, cfg);
      this.states.set(cfg.param, {
        param: cfg.param,
        value: cfg.initialValue,
        min: cfg.min,
        max: cfg.max,
        isDragging: false,
        startY: 0,
        startValue: cfg.initialValue
      });
      this.attachEvents(cfg);
      this.updateVisual(cfg.param);
    }
  }

  private attachEvents(config: KnobConfig): void {
    const { element } = config;
    const param = config.param;

    element.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const state = this.states.get(param)!;
      state.isDragging = true;
      state.startY = e.clientY;
      state.startValue = state.value;
      element.style.cursor = 'grabbing';
    });

    element.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const state = this.states.get(param)!;
      state.isDragging = true;
      state.startY = e.touches[0].clientY;
      state.startValue = state.value;
    });

    window.addEventListener('mousemove', (e) => {
      for (const state of this.states.values()) {
        if (state.isDragging) {
          this.handleDrag(state, e.clientY);
        }
      }
    });

    window.addEventListener('touchmove', (e) => {
      for (const state of this.states.values()) {
        if (state.isDragging && e.touches.length > 0) {
          this.handleDrag(state, e.touches[0].clientY);
        }
      }
    });

    window.addEventListener('mouseup', () => this.stopDrags());
    window.addEventListener('touchend', () => this.stopDrags());
    window.addEventListener('touchcancel', () => this.stopDrags());

    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      const state = this.states.get(param)!;
      const delta = e.deltaY > 0 ? -1 : 1;
      const step = param === 'antenna' ? 2 : (param === 'uhf' ? 3 : 1);
      const newValue = clamp(state.value + delta * step, state.min, state.max);
      state.value = newValue;
      this.updateVisual(param);
      this.onChange(param, newValue);
    }, { passive: false });
  }

  private handleDrag(state: KnobState, currentY: number): void {
    const config = this.configs.get(state.param)!;
    const sensitivity = config.sensitivity ?? 0.8;
    const deltaY = state.startY - currentY;
    const range = state.max - state.min;
    const deltaValue = (deltaY * sensitivity * range) / 300;
    const newValue = clamp(state.startValue + deltaValue, state.min, state.max);

    if (Math.abs(newValue - state.value) > 0.01) {
      state.value = newValue;
      this.updateVisual(state.param);
      this.onChange(state.param, newValue);
    }
  }

  private stopDrags(): void {
    for (const [param, state] of this.states) {
      if (state.isDragging) {
        state.isDragging = false;
        const cfg = this.configs.get(param);
        if (cfg) cfg.element.style.cursor = 'grab';
      }
    }
  }

  private updateVisual(param: KnobParam): void {
    const state = this.states.get(param)!;
    const config = this.configs.get(param)!;
    const normalized = (state.value - state.min) / (state.max - state.min);
    const rotation = normalized * 270 - 135;

    config.element.style.transform = `rotate(${rotation}deg)`;

    let displayValue: string;
    if (param === 'antenna') {
      displayValue = `${Math.round(state.value)}°`;
    } else {
      displayValue = Math.round(state.value).toString().padStart(3, '0');
    }
    config.valueElement.textContent = displayValue;
  }

  getValue(param: KnobParam): number {
    return this.states.get(param)?.value ?? 0;
  }

  setValue(param: KnobParam, value: number): void {
    const state = this.states.get(param);
    if (state) {
      state.value = clamp(value, state.min, state.max);
      this.updateVisual(param);
    }
  }
}
