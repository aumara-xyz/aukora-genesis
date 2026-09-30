import { useEffect, useId, useRef, useState } from 'react'
import { Panel } from '@aukora/face-layout/client'
import type { ConstellationRecord } from './memory-api.ts'
import css from './Memory.module.css'

export function MemoryAuthorIcon({ person }: { person: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {person ? <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>
      : <><rect x="4" y="7" width="16" height="14" rx="3" /><path d="M12 3v4M8 12v2m8-2v2M9 17h6" /></>}
  </svg>
}

export function MemoryViewIcon({ list }: { list: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    {list ? <><path d="M8 5h12M8 12h12M8 19h12" /><path d="M3 5h.01M3 12h.01M3 19h.01" strokeWidth="3" /></>
      : <><path d="m5 7 8-3 6 11-9 5Z" opacity=".5" /><circle cx="5" cy="7" r="2" /><circle cx="13" cy="4" r="1.5" /><circle cx="19" cy="15" r="2" /><circle cx="10" cy="20" r="1.5" /></>}
  </svg>
}

interface Props {
  points: readonly ConstellationRecord[]
  matches: readonly string[] | null
  onSelect: (id: string) => void
  onUnavailable: () => void
  labels: { field: string; person: string; agent: string }
}
const firstLine = (text: string) => text.split(/\r?\n/u).find(line => line.trim())?.slice(0, 180) ?? ''

/** One draw call for every note. Search changes attributes, never the semantic positions. */
export function MemoryConstellation({ points, matches, onSelect, onUnavailable, labels }: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const tooltipId = useId()
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const callbacks = useRef({ onSelect, onUnavailable })
  callbacks.current = { onSelect, onUnavailable }
  const updateMatches = useRef<((ids: readonly string[] | null) => void) | null>(null)
  const currentMatches = useRef(matches)
  currentMatches.current = matches

  useEffect(() => {
    setHover(null)
    const element = host.current, node = canvas.current
    if (!element || !node) return
    let stopped = false
    let teardown = () => {}
    const mount = (THREE: typeof import('#memory-three')) => {
      let renderer: import('#memory-three').WebGLRenderer
      try { renderer = new THREE.WebGLRenderer({ canvas: node, alpha: true, antialias: false, powerPreference: 'low-power' }) }
      catch { callbacks.current.onUnavailable(); return }
      const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10)
      camera.position.z = 2
      const geometry = new THREE.BufferGeometry()
      const position = new Float32Array(points.length * 3), colours = new Float32Array(points.length * 3)
      const sizes = new Float32Array(points.length), emphasis = new Float32Array(points.length), best = new Float32Array(points.length)
      const style = getComputedStyle(element)
      const person = new THREE.Color().setStyle(style.getPropertyValue('--aukora-blue').trim(), THREE.NoColorSpace)
      const agent = new THREE.Color().setStyle(style.getPropertyValue('--aukora-green').trim(), THREE.NoColorSpace)
      const unknown = new THREE.Color().setStyle(style.getPropertyValue('--aukora-text-muted').trim(), THREE.NoColorSpace)
      const now = Date.now()
      points.forEach((point, i) => {
        const colour = point.author === 'Peter' ? person : point.author === 'agent' ? agent : unknown
        colours.set([colour.r, colour.g, colour.b], i * 3)
        const age = point.createdAt === null ? Infinity : Math.max(0, now - point.createdAt) / 86400000
        sizes[i] = 10 + 12 * Math.exp(-age / 45)
      })
      const positionAttribute = new THREE.BufferAttribute(position, 3)
      const emphasisAttribute = new THREE.BufferAttribute(emphasis, 1), bestAttribute = new THREE.BufferAttribute(best, 1)
      geometry.setAttribute('position', positionAttribute).setAttribute('starColour', new THREE.BufferAttribute(colours, 3))
        .setAttribute('starSize', new THREE.BufferAttribute(sizes, 1)).setAttribute('emphasis', emphasisAttribute).setAttribute('best', bestAttribute)
      const motion = matchMedia('(prefers-reduced-motion: reduce)')
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.NormalBlending,
        uniforms: { time: { value: 0 }, ratio: { value: 1 }, moving: { value: motion.matches ? 0 : 1 } },
        vertexShader: `attribute vec3 starColour; attribute float starSize; attribute float emphasis; attribute float best;
          uniform float time; uniform float ratio; uniform float moving; varying vec3 colour; varying float light; varying float pulse;
          void main() { colour = starColour; light = emphasis;
            pulse = best * (0.5 + 0.5 * sin(time * 2.0)) * moving;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = starSize * ratio * (1.0 + 0.35 * best + 0.2 * pulse); }`,
        fragmentShader: `varying vec3 colour; varying float light; varying float pulse;
          void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
            float core = exp(-r * r * 48.0); float glow = exp(-r * r * 5.5) * 0.36;
            gl_FragColor = vec4(colour + core * 0.35, (core + glow) * light * (1.0 + pulse * 0.3)); }`,
      })
      const stars = new THREE.Points(geometry, material)
      stars.frustumCulled = false
      scene.add(stars)
      let width = 1, height = 1, scale = 1, hovered = -1, keyboard = -1, disposed = false
      let frame = 0, visible = true, elapsed = 0, previous = 0
      const render = () => { if (!disposed) renderer.render(scene, camera) }
      let bounds = node.getBoundingClientRect()
      const refreshBounds = () => { bounds = node.getBoundingClientRect() }
      const pointIds = new Set(points.map(point => point.id))
      const show = (index: number, force = false) => {
        if (!force && index === hovered) return
        hovered = index
        node.style.cursor = index < 0 ? 'default' : 'pointer'
        const point = points[index]
        setHover(point ? { index, x: Math.max(12, Math.min(width - 12, width / 2 + point.position[0] * scale + stars.position.x)),
          y: Math.max(48, Math.min(height - 12, height / 2 - point.position[1] * scale - stars.position.y)) } : null)
      }
      updateMatches.current = ids => {
        const hits = ids === null ? null : new Set(ids)
        const bestId = ids?.find(id => pointIds.has(id))
        points.forEach((point, i) => { emphasis[i] = hits === null ? .85 : hits.has(point.id) ? 1.15 : .16; best[i] = point.id === bestId ? 1 : 0 })
        emphasisAttribute.needsUpdate = true; bestAttribute.needsUpdate = true
        render()
      }
      updateMatches.current(currentMatches.current)
      const resize = () => {
        refreshBounds()
        width = element.clientWidth; height = element.clientHeight
        if (!width || !height) return
        const ratio = Math.min(devicePixelRatio || 1, 2)
        renderer.setPixelRatio(ratio); renderer.setSize(width, height, false)
        material.uniforms.ratio!.value = ratio
        camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2
        camera.updateProjectionMatrix()
        scale = Math.max(1, Math.min(width - 64, height - 100) / 2)
        points.forEach((point, i) => { position[i * 3] = point.position[0] * scale; position[i * 3 + 1] = point.position[1] * scale })
        positionAttribute.needsUpdate = true
        if (hovered >= 0) show(hovered, true)
        render()
      }
      const hitTest = (event: PointerEvent) => {
        const x = event.clientX - bounds.left - width / 2 - stars.position.x
        const y = height / 2 - (event.clientY - bounds.top) - stars.position.y
        const hits: { index: number; distance: number }[] = []
        points.forEach((point, index) => {
          const distance = (point.position[0] * scale - x) ** 2 + (point.position[1] * scale - y) ** 2
          if (distance < 144) hits.push({ index, distance })
        })
        return hits.sort((a, b) => a.distance - b.distance || a.index - b.index)
      }
      let pointerFrame = 0, pointerEvent: PointerEvent | null = null, clickGroup = '', clickOffset = -1
      const pick = (event: PointerEvent) => {
        pointerEvent = event
        if (pointerFrame) return
        pointerFrame = requestAnimationFrame(() => {
          pointerFrame = 0; keyboard = -1
          const hits = hitTest(pointerEvent!)
          show(hits[0]?.index ?? -1)
        })
      }
      const leave = () => { cancelAnimationFrame(pointerFrame); pointerFrame = 0; if (keyboard < 0) show(-1) }
      const click = (event: PointerEvent) => {
        cancelAnimationFrame(pointerFrame); pointerFrame = 0; keyboard = -1
        const hits = hitTest(event)
        // Cycle the hit group on repeated clicks. Identical vectors keep identical semantic coordinates,
        // while each overlapping note remains reachable without adding fake spacing to the projection.
        const group = hits.map(hit => hit.index).sort((a, b) => a - b).join(',')
        clickOffset = group === clickGroup ? (clickOffset + 1) % hits.length : 0
        clickGroup = group
        show(hits[clickOffset]?.index ?? -1)
        if (hovered >= 0) callbacks.current.onSelect(points[hovered]!.id)
      }
      const key = (event: KeyboardEvent) => {
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          keyboard = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
            : (Math.max(0, keyboard) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + points.length) % points.length
          show(keyboard)
        } else if ((event.key === 'Enter' || event.key === ' ') && hovered >= 0) {
          event.preventDefault(); callbacks.current.onSelect(points[hovered]!.id)
        } else if (event.key === 'Escape') { keyboard = -1; show(-1) }
      }
      const focus = () => { keyboard = Math.max(0, best.findIndex(v => v > 0)); show(keyboard) }
      const blur = () => { keyboard = -1; show(-1) }
      const tick = (time: number) => {
        frame = 0
        if (disposed || !visible || document.hidden || motion.matches) return
        elapsed += previous ? Math.min(time - previous, 100) / 1000 : 0
        previous = time
        // Render every display frame (60 Hz), keeping the motion itself slow.
        // Freeze drift under the pointer/focus so the target never slides away.
        if (hovered < 0) { stars.position.x = Math.sin(elapsed * .17) * 3; stars.position.y = Math.sin(elapsed * .13) * 2 }
        material.uniforms.time!.value = elapsed
        render()
        frame = requestAnimationFrame(tick)
      }
      const wake = () => {
        cancelAnimationFrame(frame); frame = 0; previous = 0
        material.uniforms.moving!.value = motion.matches ? 0 : 1
        if (motion.matches) { stars.position.x = 0; stars.position.y = 0; if (hovered >= 0) show(hovered, true) }
        if (!document.hidden && visible) { render(); if (!motion.matches) frame = requestAnimationFrame(tick) }
      }
      const lost = (event: Event) => { event.preventDefault(); callbacks.current.onUnavailable() }
      const observer = new ResizeObserver(resize)
      const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); wake() })
      observer.observe(element); intersection.observe(element)
      node.addEventListener('pointermove', pick); node.addEventListener('pointerleave', leave); node.addEventListener('click', click)
      node.addEventListener('keydown', key); node.addEventListener('focus', focus); node.addEventListener('blur', blur)
      node.addEventListener('webglcontextlost', lost)
      document.addEventListener('visibilitychange', wake); motion.addEventListener('change', wake)
      document.addEventListener('scroll', refreshBounds, true); node.addEventListener('pointerenter', refreshBounds)
      resize(); wake()
      return () => {
        disposed = true; updateMatches.current = null; cancelAnimationFrame(frame); cancelAnimationFrame(pointerFrame)
        observer.disconnect(); intersection.disconnect()
        node.removeEventListener('pointermove', pick); node.removeEventListener('pointerleave', leave); node.removeEventListener('click', click)
        node.removeEventListener('keydown', key); node.removeEventListener('focus', focus); node.removeEventListener('blur', blur)
        node.removeEventListener('webglcontextlost', lost)
        document.removeEventListener('visibilitychange', wake); motion.removeEventListener('change', wake)
        document.removeEventListener('scroll', refreshBounds, true); node.removeEventListener('pointerenter', refreshBounds)
        geometry.dispose(); material.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss()
      }
    }
    // Native ESM from the authenticated local face route; default list users fetch no three.js bytes.
    const moduleUrl = new URL('/api/aukora/memory/three/r180/three.module.min.js', window.location.href).href
    void import(/* @vite-ignore */ moduleUrl).then((THREE: typeof import('#memory-three')) => {
      if (!stopped) teardown = mount(THREE) ?? (() => {})
    }).catch(() => { if (!stopped) callbacks.current.onUnavailable() })
    return () => { stopped = true; teardown() }
  }, [points])

  useEffect(() => { updateMatches.current?.(matches) }, [matches])
  const point = hover ? points[hover.index] : null
  const tooltipWidth = Math.min(260, (host.current?.clientWidth ?? 400) * .65)
  const tooltipLeft = hover ? Math.max(tooltipWidth / 2 + 12, Math.min((host.current?.clientWidth ?? 400) - tooltipWidth / 2 - 12, hover.x)) : 0
  return <Panel ref={host} className={css.constellation} data-memory-constellation>
    <canvas ref={canvas} className={css.starCanvas} tabIndex={0} role="group" aria-label={labels.field} aria-describedby={point ? tooltipId : undefined} />
    <div className={css.starKey}>
      <span className={css.personKey} tabIndex={0} role="img" title={labels.person} aria-label={labels.person}><MemoryAuthorIcon person /></span>
      <span className={css.agentKey} tabIndex={0} role="img" title={labels.agent} aria-label={labels.agent}><MemoryAuthorIcon person={false} /></span>
    </div>
    {point && hover ? <div id={tooltipId} className={css.starTooltip} data-memory-tooltip
      style={{ left: tooltipLeft, top: hover.y < 140 ? hover.y + 18 : hover.y - 16,
        transform: hover.y < 140 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}>
      <span>{firstLine(point.text)}</span>
      <time dateTime={point.createdAt === null ? undefined : new Date(point.createdAt).toISOString()}>
        {point.createdAt === null ? '—' : new Date(point.createdAt).toLocaleDateString()}
      </time>
    </div> : null}
  </Panel>
}
