import { useCallback, useLayoutEffect, useRef } from 'react'
import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'

type GraphWindow = Window & { disposeHumanGraph?: () => void }

function MountedGraph(props: StockAppSurfaceProps) {
  const frame = useRef<GraphWindow | null>(null)
  const receiveWindow = useCallback((value: Window | null) => { frame.current = value }, [])
  // Layout cleanup runs before React removes the iframe. Release the GPU explicitly,
  // including when the shell switches seats without closing its mounted surfaces.
  useLayoutEffect(() => () => {
    frame.current?.disposeHumanGraph?.()
    frame.current = null
  }, [])
  const receiveMessage = useCallback((message: unknown) => {
    const value = message as { source?: unknown; type?: unknown } | null
    if (value?.source === 'aukora-human-graph' && value.type === 'close') props.closeSurface()
  }, [props.closeSurface])
  return <EmbeddedAppSurface {...props} id="human-graph" title={props.t('humanGraph.name')}
    src="/stock-apps/human-graph/index.html" onFrameWindow={receiveWindow} onFrameMessage={receiveMessage} />
}

/** Inactive shell seats never create a document, fetch three.js, or own a WebGL context. */
export function HumanGraphSurface(props: StockAppSurfaceProps) {
  return props.activeSurface === 'human-graph' ? <MountedGraph {...props} /> : null
}
