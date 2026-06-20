import { vertexShaderSource, fragmentShaderSource } from './shaders/shaders';

export interface RendererUniforms {
  signalStrength: number;
  staticAmount: number;
  distortionAmount: number;
  vhsTint: number;
  signalColor: [number, number, number];
  rainIntensity: number;
  flash: boolean;
}

export class CRTRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private startTime: number;
  private uniforms: {
    u_time: WebGLUniformLocation | null;
    u_signalStrength: WebGLUniformLocation | null;
    u_staticAmount: WebGLUniformLocation | null;
    u_distortionAmount: WebGLUniformLocation | null;
    u_vhsTint: WebGLUniformLocation | null;
    u_signalColor: WebGLUniformLocation | null;
    u_rainIntensity: WebGLUniformLocation | null;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.startTime = performance.now();

    const gl = canvas.getContext('webgl', {
      preserveDrawingBuffer: false,
      antialias: false
    });

    if (!gl) {
      throw new Error('WebGL not supported');
    }

    this.gl = gl;

    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

    this.program = this.createProgram(vertexShader, fragmentShader);

    this.setupBuffers();

    this.uniforms = {
      u_time: gl.getUniformLocation(this.program, 'u_time'),
      u_signalStrength: gl.getUniformLocation(this.program, 'u_signalStrength'),
      u_staticAmount: gl.getUniformLocation(this.program, 'u_staticAmount'),
      u_distortionAmount: gl.getUniformLocation(this.program, 'u_distortionAmount'),
      u_vhsTint: gl.getUniformLocation(this.program, 'u_vhsTint'),
      u_signalColor: gl.getUniformLocation(this.program, 'u_signalColor'),
      u_rainIntensity: gl.getUniformLocation(this.program, 'u_rainIntensity')
    };

    this.resize();
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile error: ' + info);
    }
    return shader;
  }

  private createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Program link error: ' + info);
    }
    return program;
  }

  private setupBuffers(): void {
    const gl = this.gl;
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);

    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    const texCoordLocation = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
  }

  resize(): void {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }

  render(params: RendererUniforms): void {
    const gl = this.gl;
    const time = (performance.now() - this.startTime) / 1000;

    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform1f(this.uniforms.u_time, time);
    gl.uniform1f(this.uniforms.u_signalStrength, params.signalStrength);
    gl.uniform1f(this.uniforms.u_staticAmount, params.staticAmount);
    gl.uniform1f(this.uniforms.u_distortionAmount, params.distortionAmount);
    gl.uniform1f(this.uniforms.u_vhsTint, params.vhsTint);
    gl.uniform3fv(this.uniforms.u_signalColor, params.signalColor);
    gl.uniform1f(this.uniforms.u_rainIntensity, params.rainIntensity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (params.flash) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(1, 1, 1, 0.35);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
    }
  }
}
