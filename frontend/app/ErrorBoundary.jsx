'use client'
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('NeuralOS crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#080b11',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, -apple-system, sans-serif',
          padding: '24px',
        }}>
          <div style={{ textAlign: 'center', maxWidth: '360px' }}>
            <div style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#e2e8f0',
              marginBottom: '8px',
            }}>Something went wrong</div>
            <div style={{
              fontSize: '13px',
              color: '#4a5068',
              marginBottom: '20px',
              lineHeight: '1.6',
            }}>
              NeuralOS hit an unexpected error. Your data is safe — just reload to continue.
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                background: '#7c3aed',
                border: 'none',
                borderRadius: '6px',
                color: '#ffffff',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >Reload NeuralOS</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
