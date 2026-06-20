export class AudioManager {
  private audioContext: AudioContext | null = null;
  private whiteNoiseSource: AudioBufferSourceNode | null = null;
  private noiseGainNode: GainNode | null = null;
  private signalOscillator: OscillatorNode | null = null;
  private signalGainNode: GainNode | null = null;
  private currentVolume: number = 0;
  private targetVolume: number = 0;
  private signalFrequency: number = 0;
  private targetSignalFrequency: number = 0;
  private isInitialized: boolean = false;
  private isEnabled: boolean = false;

  constructor() {}

  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      const bufferSize = 2 * this.audioContext.sampleRate;
      const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.whiteNoiseSource = this.audioContext.createBufferSource();
      this.whiteNoiseSource.buffer = noiseBuffer;
      this.whiteNoiseSource.loop = true;

      this.noiseGainNode = this.audioContext.createGain();
      this.noiseGainNode.gain.value = 0;

      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 800;

      const filter2 = this.audioContext.createBiquadFilter();
      filter2.type = 'bandpass';
      filter2.frequency.value = 3500;
      filter2.Q.value = 0.5;

      this.whiteNoiseSource.connect(filter);
      filter.connect(filter2);
      filter2.connect(this.noiseGainNode);
      this.noiseGainNode.connect(this.audioContext.destination);

      this.signalOscillator = this.audioContext.createOscillator();
      this.signalOscillator.type = 'sine';

      this.signalGainNode = this.audioContext.createGain();
      this.signalGainNode.gain.value = 0;

      this.signalOscillator.connect(this.signalGainNode);
      this.signalGainNode.connect(this.audioContext.destination);

      this.whiteNoiseSource.start();
      this.signalOscillator.start();

      this.isInitialized = true;
    } catch (e) {
      console.warn('Audio init failed:', e);
    }
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.targetVolume = enabled ? 0.12 : 0;
  }

  toggle(): boolean {
    this.setEnabled(!this.isEnabled);
    return this.isEnabled;
  }

  setNoiseIntensity(signalStrength: number): void {
    if (!this.isEnabled) {
      this.targetVolume = 0;
      return;
    }
    const baseNoise = 0.12;
    const noiseReduction = signalStrength * 0.09;
    this.targetVolume = Math.max(0.01, baseNoise - noiseReduction);
  }

  setSignalTone(frequency: number, strength: number): void {
    this.targetSignalFrequency = frequency;
    if (this.signalGainNode && this.audioContext) {
      const targetGain = strength > 0.6 ? strength * 0.06 : 0;
      this.signalGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.08);
    }
  }

  update(): void {
    if (!this.noiseGainNode || !this.audioContext || !this.isInitialized) return;

    this.currentVolume += (this.targetVolume - this.currentVolume) * 0.05;
    this.noiseGainNode.gain.setTargetAtTime(this.currentVolume, this.audioContext.currentTime, 0.02);

    this.signalFrequency += (this.targetSignalFrequency - this.signalFrequency) * 0.1;
    if (this.signalOscillator) {
      this.signalOscillator.frequency.setValueAtTime(this.signalFrequency, this.audioContext.currentTime);
    }
  }

  resume(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  destroy(): void {
    if (this.whiteNoiseSource) {
      try { this.whiteNoiseSource.stop(); } catch {}
    }
    if (this.signalOscillator) {
      try { this.signalOscillator.stop(); } catch {}
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
