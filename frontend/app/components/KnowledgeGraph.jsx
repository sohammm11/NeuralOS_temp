'use client'
import { useEffect, useRef, useState, useCallback, memo } from 'react'

const KnowledgeGraph = memo(function KnowledgeGraph({ onNodeClick }) {
  const containerRef = useRef(null)
  const [ForceGraph, setForceGraph] = useState(null)

  const graphData = {
    nodes: [
      // People
      { id: 'Rahul Sharma', group: 'person', color: '#a78bfa', val: 3 },
      { id: 'Dev Mehta', group: 'person', color: '#a78bfa', val: 3 },
      { id: 'Priya Nair', group: 'person', color: '#a78bfa', val: 3 },
      { id: 'Ananya Iyer', group: 'person', color: '#a78bfa', val: 3 },
      { id: 'Karan Joshi', group: 'person', color: '#a78bfa', val: 2 },
      { id: 'Vikram Rao', group: 'person', color: '#a78bfa', val: 2 },
      // Clients
      { id: 'Flipkart', group: 'client', color: '#ef4444', val: 5 },
      { id: 'Myntra', group: 'client', color: '#10b981', val: 3 },
      { id: 'Meesho', group: 'client', color: '#f59e0b', val: 3 },
      // Incidents
      { id: 'Zone 3 Incident', group: 'incident', color: '#f97316', val: 4 },
      { id: 'Route API Bug', group: 'incident', color: '#f97316', val: 3 },
      // Projects
      { id: 'Monitoring Dashboard', group: 'project', color: '#3b82f6', val: 2 },
      { id: 'Meesho Onboarding', group: 'project', color: '#3b82f6', val: 2 },
      { id: 'Route API Rewrite', group: 'project', color: '#3b82f6', val: 2 },
    ],
    links: [
      { source: 'Ananya Iyer', target: 'Flipkart', label: 'owns' },
      { source: 'Ananya Iyer', target: 'Myntra', label: 'owns' },
      { source: 'Dev Mehta', target: 'Zone 3 Incident', label: 'fixed' },
      { source: 'Dev Mehta', target: 'Route API Bug', label: 'fixed' },
      { source: 'Dev Mehta', target: 'Monitoring Dashboard', label: 'owns' },
      { source: 'Dev Mehta', target: 'Route API Rewrite', label: 'owns' },
      { source: 'Priya Nair', target: 'Zone 3 Incident', label: 'managed' },
      { source: 'Priya Nair', target: 'Meesho Onboarding', label: 'owns' },
      { source: 'Rahul Sharma', target: 'Zone 3 Incident', label: 'decided' },
      { source: 'Karan Joshi', target: 'Meesho', label: 'closed deal' },
      { source: 'Zone 3 Incident', target: 'Flipkart', label: 'affected' },
      { source: 'Route API Bug', target: 'Zone 3 Incident', label: 'caused' },
    ]
  }

  const handleNodeClick = useCallback((node) => {
    if (onNodeClick) onNodeClick(node)
  }, [onNodeClick])

  useEffect(() => {
    import('react-force-graph-2d').then(mod => {
      setForceGraph(() => mod.default)
    })
  }, [])

  if (!ForceGraph) return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: '#4a5068',
      fontSize: '13px',
    }}>Loading graph...</div>
  )

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph
        graphData={graphData}
        backgroundColor="#08090e"
        nodeLabel="id"
        nodeColor={node => node.color}
        nodeVal={node => node.val}
        linkColor={() => 'rgba(255,255,255,0.15)'}
        linkWidth={1}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.003}
        linkDirectionalParticleColor={() => 'rgba(124,58,237,0.6)'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.id
          const fontSize = 11 / globalScale
          ctx.font = `${fontSize}px Inter, sans-serif`

          // Node circle
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.val * 2, 0, 2 * Math.PI)
          ctx.fillStyle = node.color
          ctx.fill()

          // Glow effect
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.val * 2 + 3, 0, 2 * Math.PI)
          ctx.fillStyle = node.color + '20'
          ctx.fill()

          // Label
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = 'rgba(240,240,245,0.9)'
          ctx.fillText(label, node.x, node.y + node.val * 2 + fontSize)
        }}
        onNodeClick={handleNodeClick}
        cooldownTicks={100}
        width={containerRef.current?.offsetWidth || 800}
        height={containerRef.current?.offsetHeight || 500}
      />
    </div>
  )
})

export default KnowledgeGraph