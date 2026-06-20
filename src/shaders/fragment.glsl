precision highp float;

varying vec2 v_texCoord;

uniform float u_time;
uniform float u_signalStrength;
uniform float u_staticAmount;
uniform float u_distortionAmount;
uniform float u_vhsTint;
uniform vec3 u_signalColor;
uniform float u_rainIntensity;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec2 uv = v_texCoord;
    vec2 distortedUV = uv;
    
    float staticNoise = hash(uv * vec2(640.0, 480.0) + vec2(u_time * 120.0, u_time * 87.0));
    staticNoise += hash(uv * vec2(320.0, 240.0) + vec2(u_time * 60.0, u_time * 43.0)) * 0.5;
    staticNoise *= 0.75;
    
    float waveOffset = sin(uv.y * 80.0 + u_time * 3.0) * 0.003;
    waveOffset += sin(uv.y * 40.0 + u_time * 1.7) * 0.005;
    waveOffset *= u_distortionAmount;
    distortedUV.x += waveOffset;
    
    float glitchThreshold = u_distortionAmount * 0.3;
    if (hash(vec2(floor(uv.y * 480.0), u_time * 10.0)) > (1.0 - glitchThreshold)) {
        distortedUV.x += (hash(vec2(floor(uv.y * 480.0), u_time * 20.0)) - 0.5) * 0.08;
    }
    
    float scanline = sin(distortedUV.y * 480.0 * 3.14159) * 0.08 + 0.92;
    
    float rainEffect = 0.0;
    if (u_rainIntensity > 0.0) {
        float rainStreak = hash(vec2(floor(distortedUV.x * 80.0 + u_time * 200.0), floor(distortedUV.y * 600.0 - u_time * 1500.0)));
        rainEffect = smoothstep(0.92, 1.0, rainStreak) * u_rainIntensity * 0.5;
    }
    
    vec3 staticColor = vec3(staticNoise);
    staticColor += (hash(uv + vec2(u_time * 45.0, 0.0)) - 0.5) * 0.1;
    
    vec3 signalColorMix = mix(staticColor, u_signalColor, u_signalStrength * 0.85);
    
    vec3 vignetteColor = vec3(0.0);
    float dist = distance(uv, vec2(0.5, 0.5));
    float vignette = smoothstep(0.55, 0.9, dist);
    
    vec3 finalColor = mix(signalColorMix, vignetteColor, vignette * 0.85);
    finalColor *= scanline;
    finalColor += rainEffect * vec3(0.5, 0.6, 0.8);
    
    if (u_signalStrength > 0.1) {
        float bars = sin(distortedUV.x * 80.0 + u_time * 5.0) * 0.5 + 0.5;
        finalColor += u_signalColor * bars * u_signalStrength * 0.15;
        
        float vertBars = sin(distortedUV.y * 40.0 - u_time * 3.0) * 0.5 + 0.5;
        finalColor += u_signalColor * vertBars * u_signalStrength * 0.1;
    }
    
    if (u_vhsTint > 0.0) {
        float r = fbm(uv * vec2(30.0, 20.0) + u_time * 0.5);
        float g = fbm(uv * vec2(30.0, 20.0) + u_time * 0.5 + 100.0);
        float b = fbm(uv * vec2(30.0, 20.0) + u_time * 0.5 + 200.0);
        vec3 vhsNoise = vec3(r, g, b) * 0.3;
        finalColor = mix(finalColor, finalColor + vhsNoise, u_vhsTint);
        
        vec3 tint = vec3(1.0, 0.92, 0.75);
        finalColor *= mix(vec3(1.0), tint, u_vhsTint * 0.35);
    }
    
    finalColor += (hash(uv * 1000.0 + u_time * 500.0) - 0.5) * 0.02 * u_staticAmount;
    
    vec3 crtCurve = abs(uv - 0.5);
    float curveMask = smoothstep(0.55, 0.48, max(crtCurve.x, crtCurve.y));
    finalColor *= curveMask;
    
    finalColor = pow(finalColor, vec3(0.92));
    
    gl_FragColor = vec4(finalColor, 1.0);
}
