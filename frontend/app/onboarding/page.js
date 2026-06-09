'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    company: '',
    geminiKey: '',
    pineconeKey: '',
    pineconeIndex: 'neuralos'
  })

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleInitialize() {
    if (!form.company || !form.geminiKey || !form.pineconeKey) {
      setError('All fields are required.')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('http://localhost:8000/api/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: form.company,
          gemini_key: form.geminiKey,
          pinecone_key: form.pineconeKey,
          pinecone_index: form.pineconeIndex
        })
      })

      const data = await res.json()

      if (data.success) {
        localStorage.setItem('neuralos_company', form.company)
        localStorage.setItem('neuralos_gemini_key', form.geminiKey)
        localStorage.setItem('neuralos_pinecone_key', form.pineconeKey)
        localStorage.setItem('neuralos_pinecone_index', form.pineconeIndex)
        router.push('/')
      } else {
        setError(data.message || 'Failed to initialize. Check your keys.')
      }
    } catch (err) {
      setError('Could not connect to backend. Is it running?')
    }
    setLoading(false)
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    background: '#0d0f18',
    border: '0.5px solid #1e2130',
    borderRadius: '6px',
    color: '#e2e8f0',
    fontSize: '13px',
    outline: 'none',
    marginTop: '6px',
  }

  const labelStyle = {
    fontSize: '12px',
    color: '#4a5068',
    display: 'block',
    marginBottom: '2px',
  }

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
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            fontSize: '22px',
            fontWeight: '600',
            color: '#a78bfa',
            letterSpacing: '-0.5px',
            marginBottom: '8px',
          }}>NeuralOS</div>
          <div style={{
            fontSize: '13px',
            color: '#4a5068',
          }}>Your company, running on intelligence</div>
        </div>

        {/* Card */}
        <div style={{
          background: '#0d0f18',
          border: '0.5px solid #1e2130',
          borderRadius: '12px',
          padding: '28px',
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#e2e8f0',
            marginBottom: '4px',
          }}>Set up your company brain</div>
          <div style={{
            fontSize: '12px',
            color: '#4a5068',
            marginBottom: '24px',
            lineHeight: '1.6',
          }}>
            Your API keys are stored locally and never sent to our servers.
          </div>

          {/* Company Name */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Company name</label>
            <input
              style={inputStyle}
              placeholder="SwiftMove Logistics"
              value={form.company}
              onChange={e => updateForm('company', e.target.value)}
            />
          </div>

          {/* Gemini Key */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>
              Gemini API key
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: '#7c3aed',
                  marginLeft: '8px',
                  fontSize: '11px',
                  textDecoration: 'none',
                }}
              >Get key →</a>
            </label>
            <input
              style={inputStyle}
              placeholder="AIzaSy..."
              type="password"
              value={form.geminiKey}
              onChange={e => updateForm('geminiKey', e.target.value)}
            />
          </div>

          {/* Pinecone Key */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>
              Pinecone API key
              <a
                href="https://app.pinecone.io"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: '#7c3aed',
                  marginLeft: '8px',
                  fontSize: '11px',
                  textDecoration: 'none',
                }}
              >Get key →</a>
            </label>
            <input
              style={inputStyle}
              placeholder="pcsk_..."
              type="password"
              value={form.pineconeKey}
              onChange={e => updateForm('pineconeKey', e.target.value)}
            />
          </div>

          {/* Pinecone Index */}
          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Pinecone index name</label>
            <input
              style={inputStyle}
              placeholder="neuralos"
              value={form.pineconeIndex}
              onChange={e => updateForm('pineconeIndex', e.target.value)}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontSize: '12px',
              color: '#ef4444',
              marginBottom: '16px',
              padding: '8px 12px',
              background: '#1a0a0a',
              border: '0.5px solid #3a1010',
              borderRadius: '6px',
            }}>
              {error}
            </div>
          )}

          {/* Divider */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
          }}>
            <div style={{ flex: 1, height: '0.5px', background: '#1e2130' }} />
            <div style={{ fontSize: '11px', color: '#2a2f45' }}>or</div>
            <div style={{ flex: 1, height: '0.5px', background: '#1e2130' }} />
          </div>

          {/* Use NeuralOS keys */}
          <button
            onClick={() => {
              localStorage.setItem('neuralos_company', form.company || 'My Company')
              localStorage.setItem('neuralos_gemini_key', 'neuralos_managed')
              localStorage.setItem('neuralos_pinecone_key', 'neuralos_managed')
              localStorage.setItem('neuralos_pinecone_index', 'neuralos')
              window.location.href = '/'
            }}
            style={{
              width: '100%',
              padding: '10px',
              background: 'transparent',
              border: '0.5px solid #1e2130',
              borderRadius: '6px',
              color: '#4a5068',
              fontSize: '13px',
              cursor: 'pointer',
              marginBottom: '12px',
            }}
          >
            Continue with NeuralOS managed keys
          </button>

          {/* Button */}
          <button
            onClick={handleInitialize}
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px',
              background: loading ? '#1e2130' : '#7c3aed',
              border: 'none',
              borderRadius: '6px',
              color: loading ? '#4a5068' : '#ffffff',
              fontSize: '13px',
              fontWeight: '500',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Initializing...' : 'Initialize company brain →'}
          </button>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          marginTop: '20px',
          fontSize: '11px',
          color: '#2a2f45',
          lineHeight: '1.6',
        }}>
          Keys are stored in your browser only.<br/>
          NeuralOS never stores your API keys.
        </div>
      </div>
    </div>
  )
}
