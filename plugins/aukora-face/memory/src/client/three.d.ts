/** Narrow typed boundary for the pinned, unmodified three.js modules. */
declare module '#memory-three' {
  // Raw ShaderMaterial writes sRGB directly: use setStyle(..., NoColorSpace), not the default linear conversion.
  export class Color { constructor(); setStyle(style: string, colourSpace: string): this; r: number; g: number; b: number }
  export class BufferAttribute { constructor(array: Float32Array, size: number); needsUpdate: boolean }
  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this
    dispose(): void
  }
  export class ShaderMaterial {
    constructor(options: { uniforms: Record<string, { value: number }>; vertexShader: string; fragmentShader: string;
      transparent: boolean; depthWrite: boolean; blending: number })
    uniforms: Record<string, { value: number }>
    dispose(): void
  }
  export class Points {
    constructor(geometry: BufferGeometry, material: ShaderMaterial)
    frustumCulled: boolean
    position: { x: number; y: number }
  }
  export class Scene { add(object: Points): void; clear(): void }
  export class OrthographicCamera {
    constructor(left: number, right: number, top: number, bottom: number, near: number, far: number)
    left: number; right: number; top: number; bottom: number; position: { z: number }
    updateProjectionMatrix(): void
  }
  export class WebGLRenderer {
    constructor(options: { canvas: HTMLCanvasElement; alpha: boolean; antialias: boolean; powerPreference: string })
    setPixelRatio(ratio: number): void
    setSize(width: number, height: number, updateStyle: boolean): void
    render(scene: Scene, camera: OrthographicCamera): void
    dispose(): void
    forceContextLoss(): void
  }
  export const NormalBlending: number
  export const NoColorSpace: string
}
