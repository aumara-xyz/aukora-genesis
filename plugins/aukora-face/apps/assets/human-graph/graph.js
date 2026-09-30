import * as THREE from './three/three.module.min.js'
import { getGraph } from './graph-data.js'

// Matches layout/src/client/spatial-tokens.css: blue, mint, violet, gold.
const PALETTE = [0xe0b76a, 0x96b4ff, 0x81d4b4, 0xc4aaff, 0xe0b76a]
const TAU = Math.PI * 2
const clamp = THREE.MathUtils.clamp

export async function mountGraph(signal, onError) {
  const graph = await getGraph({ signal })
  signal.throwIfAborted()
  const canvas = document.getElementById('field')
  const announcement = document.getElementById('announcement')
  const motion = document.getElementById('motion')
  const lifetime = new AbortController()
  const resources = new Set()
  const own = value => { resources.add(value); return value }
  const scene = new THREE.Scene()
  let renderer
  let context
  let observer
  let raf = 0
  let disposed = false
  const listen = (target, name, fn, options = {}) =>
    target.addEventListener(name, fn, { ...options, signal: lifetime.signal })
  const dispose = () => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(raf)
    // Remove our context-lost handler before deliberately losing the context.
    lifetime.abort()
    signal.removeEventListener('abort', dispose)
    observer?.disconnect()
    for (const resource of resources) resource.dispose()
    resources.clear()
    scene.clear()
    if (renderer) {
      renderer.setAnimationLoop(null)
      renderer.renderLists.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer = undefined
    }
    // Also release a context if renderer construction itself failed part-way.
    if (context && !context.isContextLost()) context.getExtension('WEBGL_lose_context')?.loseContext()
    context = undefined
    canvas.width = canvas.height = 1
    delete canvas.dataset.hover
  }
  signal.addEventListener('abort', dispose, { once: true })

  try {
    // DPR capped for Retina fill rate. All nodes/edges are batched; no postprocess
    // render targets, per-node DOM, external textures, or shadow passes.
    const contextOptions = { antialias: true, alpha: true, powerPreference: 'low-power' }
    context = canvas.getContext('webgl2', contextOptions)
    if (!context) throw new Error('WebGL2 unavailable')
    renderer = new THREE.WebGLRenderer({ canvas, context, ...contextOptions })
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault()
      dispose()
      onError()
    })
    renderer.debug.onShaderError = () => { throw new Error('Human Graph shader unavailable') }
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500)
    const nodes = graph.nodes
    const byId = new Map(nodes.map((node, index) => [node.id, index]))
    const rootIndex = byId.get(graph.root)
    if (rootIndex === undefined) throw new Error('Missing graph root')
    const positions = nodes.map(node => new THREE.Vector3(...node.position))
    const graphRadius = Math.max(1, ...positions.map(position => position.distanceTo(positions[rootIndex]))) + 2
    const colors = nodes.map(node => new THREE.Color(PALETTE[node.cluster < 0 ? 0 : 1 + node.cluster % 4]))
    const mutualDegree = new Float32Array(nodes.length)
    for (const edge of [...graph.branches, ...graph.vouches]) {
      if (!edge.mutual) continue
      const a = byId.get(edge.source), b = byId.get(edge.target)
      mutualDegree[a]++; mutualDegree[b]++
    }
    const baseGlowSizes = nodes.map((_, i) => i === rootIndex ? 12 : 1.8 + mutualDegree[i] * 0.5)
    const nodePositions = new Float32Array(nodes.length * 3)
    const glowColors = new Float32Array(nodes.length * 3)
    const glowSizes = new Float32Array(nodes.length)
    nodes.forEach((node, index) => {
      positions[index].toArray(nodePositions, index * 3)
      colors[index].toArray(glowColors, index * 3)
      glowSizes[index] = baseGlowSizes[index]
    })

    const pointMaterial = own(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { height: { value: 800 }, time: { value: 0 }, pulse: { value: 1 } },
      vertexShader: `
        attribute float size;
        attribute vec3 tint;
        attribute float strength;
        attribute float softness;
        uniform float height;
        uniform float time;
        uniform float pulse;
        varying vec3 vColor;
        varying float vPulse;
        varying float vStrength;
        varying float vSoftness;
        void main() {
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vColor = tint;
          vStrength = strength;
          vSoftness = softness;
          vPulse = 0.92 + pulse * 0.08 * sin(time * 0.7 + position.x * 0.16);
          gl_PointSize = clamp(size * height / max(1.0, -p.z), 2.0, 480.0);
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vPulse;
        varying float vStrength;
        varying float vSoftness;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float halo = exp(-r * r * mix(7.0, 3.0, vSoftness)) * 0.30;
          float core = exp(-r * r * 70.0) * 0.46 * (1.0 - vSoftness);
          gl_FragColor = vec4(vColor, (halo + core) * (1.0 - r) * vPulse * vStrength);
          #include <colorspace_fragment>
        }`,
    }))
    const pointGeometry = own(new THREE.BufferGeometry())
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3))
    pointGeometry.setAttribute('tint', new THREE.BufferAttribute(glowColors, 3))
    pointGeometry.setAttribute('size', new THREE.BufferAttribute(glowSizes, 1))
    pointGeometry.setAttribute('strength', new THREE.Float32BufferAttribute(nodes.map((_, i) => i === rootIndex ? 1 : 0.55 + mutualDegree[i] * 0.15), 1))
    pointGeometry.setAttribute('softness', new THREE.BufferAttribute(new Float32Array(nodes.length), 1))
    const glows = new THREE.Points(pointGeometry, pointMaterial)
    scene.add(glows)

    // Soft volumes expose mutually vouched membership without painting a page background.
    const haloCanvas = document.createElement('canvas')
    haloCanvas.width = haloCanvas.height = 128
    const brush = haloCanvas.getContext('2d')
    if (!brush) throw new Error('Human Graph halo unavailable')
    const fade = brush.createRadialGradient(64, 64, 0, 64, 64, 64)
    fade.addColorStop(0, 'rgba(255,255,255,0.65)')
    fade.addColorStop(0.25, 'rgba(255,255,255,0.35)')
    fade.addColorStop(0.55, 'rgba(255,255,255,0.12)')
    fade.addColorStop(1, 'rgba(255,255,255,0)')
    brush.fillStyle = fade
    brush.fillRect(0, 0, 128, 128)
    const haloTexture = own(new THREE.CanvasTexture(haloCanvas))
    const largestCell = Math.max(1, ...graph.cells.map(cell => cell.members.length))
    for (const cell of graph.cells) {
      const members = cell.members.map(id => byId.get(id))
      const centre = new THREE.Vector3()
      for (const index of members) centre.add(positions[index])
      centre.divideScalar(members.length)
      // World-space billboards stay attached to the cell at every zoom level;
      // point sprites would stop growing at the GPU's point-size limit.
      const material = own(new THREE.SpriteMaterial({ map: haloTexture,
        color: PALETTE[1 + cell.cluster % 4], transparent: true,
        opacity: 0.4 * members.length / largestCell,
        depthWrite: false, blending: THREE.AdditiveBlending }))
      const halo = new THREE.Sprite(material)
      own(halo.geometry)
      halo.position.copy(centre)
      halo.scale.setScalar(members.length * 2.4)
      halo.renderOrder = -2
      scene.add(halo)
    }

    const coreGeometry = own(new THREE.IcosahedronGeometry(1, 1))
    const coreMaterial = own(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    const cores = own(new THREE.InstancedMesh(coreGeometry, coreMaterial, nodes.length))
    const transform = new THREE.Object3D()
    nodes.forEach((node, index) => {
      transform.position.copy(positions[index])
      transform.scale.setScalar(index === rootIndex ? 0.001 : 0.13 + mutualDegree[index] * 0.025)
      transform.updateMatrix()
      cores.setMatrixAt(index, transform.matrix)
      cores.setColorAt(index, colors[index].clone().lerp(new THREE.Color(0xffffff), 0.38))
    })
    cores.instanceMatrix.needsUpdate = true
    scene.add(cores)

    const root = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.78)), own(new THREE.MeshBasicMaterial({ color: 0xffe1a0 })))
    root.position.copy(positions[rootIndex])
    root.rotation.z = 0.12
    scene.add(root)
    const ringPoints = Array.from({ length: 96 }, (_, i) =>
      new THREE.Vector3(Math.cos(i / 96 * TAU) * 1.85, Math.sin(i / 96 * TAU) * 1.85, 0))
    const ringGeometry = own(new THREE.BufferGeometry().setFromPoints(ringPoints))
    const ringMaterial = own(new THREE.LineBasicMaterial({ color: PALETTE[0], transparent: true, opacity: 0.27, depthWrite: false }))
    const ring = new THREE.LineLoop(ringGeometry, ringMaterial)
    ring.position.copy(root.position)
    ring.rotation.x = 0.7
    scene.add(ring)

    // Two batched triangle meshes: screen-space ribbons keep their real pixel
    // width on WebGL. Only loose, second-degree links are cut into round dots.
    const neighbours = nodes.map(() => new Set())
    const edgeMaterials = []
    function connections(edges, dotted) {
      const starts = [], ends = [], corners = [], tints = [], ids = []
      for (const edge of edges) {
        const a = byId.get(edge.source), b = byId.get(edge.target)
        if (a === undefined || b === undefined) throw new Error('Invalid graph edge')
        neighbours[a].add(b); neighbours[b].add(a)
        const color = colors[a].clone().lerp(colors[b], 0.5).lerp(new THREE.Color(0xffffff), 0.2)
        for (const [along, side] of [[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]]) {
          starts.push(...positions[a].toArray()); ends.push(...positions[b].toArray())
          corners.push(along, side); tints.push(...color.toArray()); ids.push(a, b)
        }
      }
      const geometry = own(new THREE.BufferGeometry())
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(starts, 3))
      geometry.setAttribute('end', new THREE.Float32BufferAttribute(ends, 3))
      geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2))
      geometry.setAttribute('tint', new THREE.Float32BufferAttribute(tints, 3))
      geometry.setAttribute('ids', new THREE.Float32BufferAttribute(ids, 2))
      const material = own(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        uniforms: { resolution: { value: new THREE.Vector2(1, 1) }, selected: { value: -1 }, dotted: { value: dotted ? 1 : 0 } },
        vertexShader: `
          attribute vec3 end; attribute vec2 corner; attribute vec3 tint; attribute vec2 ids;
          uniform vec2 resolution; uniform float selected; uniform float dotted;
          varying vec3 vTint; varying float vAlong; varying float vSide; varying float vActive;
          void main() {
            vec4 start = modelViewMatrix * vec4(position, 1.0);
            vec4 finish = modelViewMatrix * vec4(end, 1.0);
            // Clip in view space before dividing by w when focus enters the web.
            const float nearZ = -0.1001;
            if (start.z > nearZ && finish.z > nearZ) {
              gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
              return;
            }
            if (start.z > nearZ) start = mix(start, finish, (nearZ - start.z) / (finish.z - start.z));
            if (finish.z > nearZ) finish = mix(finish, start, (nearZ - finish.z) / (start.z - finish.z));
            vec4 a = projectionMatrix * start;
            vec4 b = projectionMatrix * finish;
            vec2 delta = (b.xy / b.w - a.xy / a.w) * resolution * 0.5;
            float len = max(length(delta), 0.001);
            vec2 normal = vec2(-delta.y, delta.x) / len;
            vActive = (abs(ids.x - selected) < 0.1 || abs(ids.y - selected) < 0.1) ? 1.0 : 0.0;
            float thickness = mix(1.5, 1.1, dotted) + vActive * 1.3;
            vec4 p = mix(a, b, corner.x);
            p.xy += normal * corner.y * thickness / resolution * p.w;
            gl_Position = p;
            vAlong = corner.x * len; vSide = corner.y;
            vTint = tint;
          }`,
        fragmentShader: `
          uniform float dotted; uniform float selected;
          varying vec3 vTint; varying float vAlong; varying float vSide; varying float vActive;
          void main() {
            float alpha = 1.0 - smoothstep(0.7, 1.0, abs(vSide));
            if (dotted > 0.5) {
              float x = (mod(vAlong, 7.0) - 3.5) / 1.5;
              alpha = 1.0 - smoothstep(0.7, 1.0, length(vec2(x, vSide)));
            }
            if (alpha < 0.01) discard;
            float emphasis = selected < 0.0 ? mix(0.76, 0.28, dotted) : mix(0.12, 1.0, vActive);
            gl_FragColor = vec4(mix(vTint, vec3(1.0, 0.91, 0.65), vActive * 0.65), alpha * emphasis);
            #include <colorspace_fragment>
          }`,
      }))
      edgeMaterials.push(material)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.renderOrder = -1
      scene.add(mesh)
    }
    const edges = [...graph.branches, ...graph.vouches]
    const solid = edge => edge.source === graph.root || edge.target === graph.root || edge.mutual
    connections(edges.filter(solid), false)
    connections(edges.filter(edge => !solid(edge)), true)
    const selection = new THREE.Mesh(own(new THREE.RingGeometry(0.52, 0.57, 48)), own(new THREE.MeshBasicMaterial({ color: 0xffe1ad, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false, depthWrite: false })))
    selection.visible = false
    scene.add(selection)

    let width = 1, height = 1, overview = 90
    let distance = overview, wantedDistance = overview
    let yaw = 0.10, pitch = 0.16
    const target = positions[rootIndex].clone()
    const wantedTarget = target.clone()
    let selected = null, hovered = null, highlighted = null
    let pointerInside = false, pickDirty = false
    let pointerX = 0, pointerY = 0
    let drag = null
    let lastTime = 0, elapsed = 0, settling = true
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let paused = reducedMotion.matches
    const cameraOffset = new THREE.Vector3()
    const projected = new THREE.Vector3()
    const pathNodes = new Set()

    function highlight(index) {
      if (highlighted === index) return
      highlighted = index
      pathNodes.clear()
      if (index !== null) {
        pathNodes.add(index)
        for (const neighbour of neighbours[index]) pathNodes.add(neighbour)
      }
      for (const material of edgeMaterials) material.uniforms.selected.value = index ?? -1
      nodes.forEach((node, i) => {
        const color = pathNodes.has(i) ? new THREE.Color(0xffdfa1) : colors[i]
        const coreColor = index === null
          ? colors[i].clone().lerp(new THREE.Color(0xffffff), 0.38)
          : color.clone().multiplyScalar(pathNodes.has(i) ? 1 : 0.45)
        cores.setColorAt(i, coreColor)
        color.toArray(glowColors, i * 3)
        glowSizes[i] = baseGlowSizes[i] * (pathNodes.has(i) ? 1.7 : 1)
      })
      cores.instanceColor.needsUpdate = true
      pointGeometry.attributes.tint.needsUpdate = true
      pointGeometry.attributes.size.needsUpdate = true
      selection.visible = index !== null
      if (index !== null) selection.position.copy(positions[index])
    }
    function pick() {
      // Screen-space picking is cheap for 250 nodes and remains usable at any zoom.
      // Tiny instanced cores would otherwise require precision clicking/raycasting.
      let winner = null, nearest = Infinity
      for (let i = 0; i < nodes.length; i++) {
        projected.copy(positions[i]).project(camera)
        if (projected.z < -1 || projected.z > 1) continue
        const x = (projected.x * 0.5 + 0.5) * width
        const y = (-projected.y * 0.5 + 0.5) * height
        const d = Math.hypot(x - pointerX, y - pointerY)
        if (d < (i === rootIndex ? 18 : 12) && d < nearest) { nearest = d; winner = i }
      }
      hovered = winner
      canvas.toggleAttribute('data-hover', winner !== null)
      highlight(hovered ?? selected)
      pickDirty = false
      return winner
    }
    function schedule() {
      if (!disposed && !document.hidden && !raf) raf = requestAnimationFrame(frame)
    }
    function focus(index) {
      selected = index
      pointerInside = false; hovered = null
      wantedTarget.copy(positions[index])
      wantedDistance = index === rootIndex ? overview : 28
      highlight(index)
      announcement.textContent = index === rootIndex ? 'YOU. Centre keystone focused.' : `${nodes[index].name} focused. Immediate neighbours highlighted.`
      settling = true
      schedule()
    }
    function home() {
      selected = hovered = null
      pointerInside = false
      highlight(null)
      wantedTarget.copy(positions[rootIndex])
      wantedDistance = overview
      yaw = 0.10; pitch = 0.16
      settling = true
      announcement.textContent = 'Entire graph.'
      schedule()
    }
    function zoom(factor) {
      wantedDistance = clamp(wantedDistance * factor, 10, Math.max(overview * 1.8, 170))
      settling = true
      schedule()
    }
    function updateMotion() {
      motion.setAttribute('aria-pressed', String(paused))
      motion.setAttribute('aria-label', paused ? 'Resume motion' : 'Pause motion')
      // Reduced motion starts paused; the play control is an explicit opt-in.
      pointMaterial.uniforms.pulse.value = paused ? 0 : 1
      lastTime = 0
      schedule()
    }
    function toggleMotion() { paused = !paused; updateMotion() }
    function resize() {
      if (disposed) return
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width); height = Math.max(1, rect.height)
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75)
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      pointMaterial.uniforms.height.value = height * dpr
      for (const material of edgeMaterials) material.uniforms.resolution.value.set(width, height)
      camera.aspect = width / height
      const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.min(camera.aspect, 1))
      overview = graphRadius / Math.sin(halfFov) * 1.04
      camera.far = Math.max(500, overview * 4 + graphRadius)
      camera.updateProjectionMatrix()
      if (selected === null || selected === rootIndex) wantedDistance = overview
      settling = true
      schedule()
    }
    function frame(now) {
      raf = 0
      if (disposed || document.hidden) return
      try {
        const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60
        lastTime = now
        const moving = !paused
        if (moving) elapsed += dt
        if (moving && !drag && !pointerInside) yaw += dt * 0.024
        const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 7)
        target.lerp(wantedTarget, blend)
        distance = THREE.MathUtils.lerp(distance, wantedDistance, blend)
        settling = Math.abs(distance - wantedDistance) > 0.005 || target.distanceToSquared(wantedTarget) > 0.00001
        cameraOffset.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance)
        camera.position.copy(target).add(cameraOffset)
        camera.lookAt(target)
        camera.updateMatrixWorld()
        if (pointerInside && !drag && (pickDirty || settling || moving)) pick()
        root.rotation.y = elapsed * 0.12
        root.scale.setScalar(1 + (moving ? Math.sin(elapsed * 0.7) * 0.055 : 0))
        ring.rotation.y = elapsed * 0.08
        selection.quaternion.copy(camera.quaternion)
        pointMaterial.uniforms.time.value = elapsed
        renderer.render(scene, camera)
        if (moving || settling || drag) schedule()
      } catch {
        dispose()
        onError()
      }
    }

    listen(motion, 'click', toggleMotion)
    listen(document.getElementById('home'), 'click', home)
    listen(document.getElementById('zoom-in'), 'click', () => zoom(0.82))
    listen(document.getElementById('zoom-out'), 'click', () => zoom(1.22))
    listen(reducedMotion, 'change', () => { paused = reducedMotion.matches; updateMotion() })
    listen(window, 'resize', resize)
    observer = new ResizeObserver(resize)
    observer.observe(canvas)
    listen(document, 'visibilitychange', () => {
      cancelAnimationFrame(raf); raf = 0; lastTime = 0
      if (!document.hidden) resize()
    })
    function pointer(event) {
      const rect = canvas.getBoundingClientRect()
      pointerX = event.clientX - rect.left; pointerY = event.clientY - rect.top
      pointerInside = true; pickDirty = true
    }
    listen(canvas, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return
      pointer(event)
      canvas.focus({ preventScroll: true })
      canvas.setPointerCapture(event.pointerId)
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 }
    })
    listen(canvas, 'pointermove', event => {
      if (!event.isPrimary) return
      pointer(event)
      if (drag && drag.id === event.pointerId) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y
        drag.travel += Math.hypot(dx, dy)
        yaw -= dx * 0.005
        pitch = clamp(pitch + dy * 0.005, -1.15, 1.15)
        drag.x = event.clientX; drag.y = event.clientY
      }
      schedule()
    })
    listen(canvas, 'pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return
      const click = drag.travel < 6
      drag = null
      pointer(event)
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      if (click) {
        const index = pick()
        if (index !== null) focus(index)
      }
      if (event.pointerType !== 'mouse') { pointerInside = false; hovered = null; highlight(selected) }
      schedule()
    })
    listen(canvas, 'pointercancel', () => { drag = null; pointerInside = false; hovered = null; highlight(selected); schedule() })
    listen(canvas, 'lostpointercapture', () => { drag = null; schedule() })
    listen(canvas, 'pointerleave', () => { pointerInside = false; hovered = null; highlight(selected); schedule() })
    listen(canvas, 'wheel', event => {
      event.preventDefault()
      zoom(Math.exp(clamp(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1), -150, 150) * 0.002))
    }, { passive: false })
    listen(canvas, 'keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        pointerInside = false; hovered = null
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
        selected = ((selected ?? rootIndex) + step + nodes.length) % nodes.length
        highlight(selected)
        announcement.textContent = selected === rootIndex ? 'YOU. Centre keystone.' : `${nodes[selected].name}.`
        schedule()
      } else if (event.key === 'Enter') { event.preventDefault(); focus(selected ?? rootIndex) }
      else if (event.key === 'Home') { event.preventDefault(); home() }
      else if (event.key === ' ') { event.preventDefault(); toggleMotion() }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.82) }
      else if (event.key === '-') { event.preventDefault(); zoom(1.22) }
      // Escape remains unconsumed for EmbeddedAppSurface's existing close handler.
    })
    resize()
    distance = wantedDistance
    updateMotion()
    announcement.textContent = 'Demo graph. 250 people. YOU are the centre keystone.'
    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}
