'use client'
import { useEffect, useRef, useState, useCallback, memo } from 'react'

const KnowledgeGraph = memo(function KnowledgeGraph({ onNodeClick }) {
  const containerRef = useRef(null)
  const [ForceGraph, setForceGraph] = useState(null)

  const [graphData, setGraphData] = useState({ nodes: [], links: [] })
  const [loading, setLoading] = useState(true)

  const handleNodeClick = useCallback((node) => {
    if (onNodeClick) onNodeClick(node)
  }, [onNodeClick])

  useEffect(() => {
    fetch('http://localhost:8000/api/graph/nodes', {
      credentials: 'include'
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const colorMap = {
            'Person': '#a78bfa',
            'Client': '#ef4444',
            'Incident': '#f97316',
            'Project': '#3b82f6'
          }

          const nodes = data.nodes.map(n => {
            const type = Array.isArray(n.type) ? n.type[0] : n.type
            let color = colorMap[type] || '#8b8fa8'
            
            // Override client color by health
            if (type === 'Client') {
              const health = n.props?.health || 'healthy'
              color = health === 'at_risk' ? '#ef4444' :
                      health === 'onboarding' ? '#f59e0b' : '#10b981'
            }

            return {
              id: n.name,
              group: type?.toLowerCase() || 'unknown',
              color,
              val: type === 'Client' ? 4 : type === 'Person' ? 3 : 2
            }
          })

          // Fetch relationships too
          fetch('http://localhost:8000/api/graph/relationships', {
            credentials: 'include'
          })
            .then(r => r.json())
            .then(relData => {
              const links = (relData.relationships || []).map(r => ({
                source: r.from,
                target: r.to,
                label: r.relationship
              }))
              setGraphData({ nodes, links })
              setLoading(false)
            })
            .catch(() => {
              setGraphData({ nodes, links: [] })
              setLoading(false)
            })
        } else {
          setLoading(false)
        }
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    import('react-force-graph-2d').then(mod => {
      setForceGraph(() => mod.default)
    })
  }, [])

  if (!ForceGraph || loading) return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: '#4a5068',
      fontSize: '13px',
    }}>
      {!ForceGraph ? 'Loading graph...' : 'Fetching company data...'}
    </div>
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