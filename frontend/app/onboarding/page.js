'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const t = {
  bg: '#080b11',
  surface: '#0e0f15',
  elevated: '#13141c',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.12)',
  text: '#f0f0f5',
  secondary: '#8b8fa8',
  tertiary: '#55596e',
  purple: '#7c3aed',
  purpleHover: '#6d28d9',
  purpleSubtle: 'rgba(124,58,237,0.1)',
  green: '#10b981',
  red: '#ef4444',
}

const input = {
  width: '100%',
  padding: '10px 14px',
  background: t.elevated,
  border: `1px solid ${t.border}`,
  borderRadius: '8px',
  color: t.text,
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  transition: 'border-color 0.15s',
}

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState('account') // 'account' | 'setup'
  const [authMode, setAuthMode] = useState('signup')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [account, setAccount] = useState({ email: '', password: '' })
  const [setup, setSetup] = useState({
    company: '',
    geminiKey: '',
    pineconeKey: '',
    pineconeIndex: 'neuralos',
    managed: false,
  })

  async function handleAccount() {
    if (!account.email || !account.password) {
      setError('Email and password are required.')
      return
    }
    setError('')
    setLoading(true)

    if (authMode === 'login') {
      try {
        const res = await fetch('http://localhost:8000/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: account.email, password: account.password })
        })
        const data = await res.json()
        if (data.success) {
          localStorage.setItem('neuralos_company', data.name || 'My Company')
          window.location.replace('/')
        } else {
          setError(data.detail || 'Login failed.')
        }
      } catch {
        setError('Could not connect to backend.')
      }
    } else {
      setStep('setup')
    }
    setLoading(false)
  }

  async function handleSetup(managed = false) {
    if (!setup.company.trim()) {
      setError('Company name is required.')
      return
    }
    if (!managed && (!setup.geminiKey || !setup.pineconeKey)) {
      setError('API keys are required, or use NeuralOS managed keys.')
      return
    }
    setError('')
    setLoading(true)

    try {
      const geminiKey = managed ? 'neuralos_managed' : setup.geminiKey
      const pineconeKey = managed ? 'neuralos_managed' : setup.pineconeKey

      const initRes = await fetch('http://localhost:8000/api/initialize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: setup.company,
          gemini_key: geminiKey,
          pinecone_key: pineconeKey,
          pinecone_index: setup.pineconeIndex
        })
      })
      const initData = await initRes.json()
      if (!initData.success && !managed) {
        setError(initData.message || 'Invalid API keys.')
        setLoading(false)
        return
      }

      await fetch('http://localhost:8000/api/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: setup.company })
      })

      await fetch('http://localhost:8000/api/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: account.password })
      })

      localStorage.setItem('neuralos_company', setup.company)
      localStorage.setItem('neuralos_gemini_key', geminiKey)
      localStorage.setItem('neuralos_pinecone_key', pineconeKey)
      localStorage.setItem('neuralos_pinecone_index', setup.pineconeIndex)

      window.location.replace('/')
    } catch {
      setError('Something went wrong. Is the backend running?')
    }
    setLoading(false)
  }

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    color: t.secondary,
    marginBottom: '6px',
    fontWeight: '500',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: t.bg,
      display: 'flex',
      fontFamily: 'Inter, -apple-system, sans-serif',
      color: t.text,
    }}>

      {/* Left panel — branding */}
      <div style={{
        width: '420px',
        flexShrink: 0,
        background: t.surface,
        borderRight: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '48px 40px',
        justifyContent: 'space-between',
      }}>
        <div>
          {/* Logo */}
          <div style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#a78bfa',
            letterSpacing: '-0.4px',
            marginBottom: '48px',
          }}>NeuralOS</div>

          {/* Headline */}
          <div style={{
            fontSize: '28px',
            fontWeight: '600',
            color: t.text,
            letterSpacing: '-0.6px',
            lineHeight: '1.3',
            marginBottom: '16px',
          }}>
            Your company,<br />running on intelligence.
          </div>
          <div style={{
            fontSize: '14px',
            color: t.secondary,
            lineHeight: '1.7',
            marginBottom: '48px',
          }}>
            NeuralOS connects your Slack, Notion, Gmail and Drive into a single AI brain that answers questions, detects anomalies, and executes tasks autonomously.
          </div>

          {/* Feature list */}
          {[
            { icon: '🔍', text: 'Hybrid search across all your tools' },
            { icon: '⚡', text: 'Real-time ingestion via webhooks' },
            { icon: '🤖', text: 'Autonomous agent with approval gates' },
            { icon: '🔒', text: 'Per-company encryption and PII redaction' },
            { icon: '📊', text: 'Proactive anomaly detection' },
          ].map((f, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '14px',
            }}>
              <span style={{ fontSize: '16px' }}>{f.icon}</span>
              <span style={{ fontSize: '13px', color: t.secondary }}>{f.text}</span>
            </div>
          ))}
        </div>

        {/* Bottom trust signal */}
        <div style={{
          fontSize: '11px',
          color: t.tertiary,
          lineHeight: '1.6',
        }}>
          Built for enterprise. SOC2-ready architecture.<br />
          Data encrypted at rest per company.
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 40px',
      }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>

          {/* Step indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '32px',
          }}>
            {['account', 'setup'].map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '24px', height: '24px',
                  borderRadius: '50%',
                  background: step === s ? t.purple :
                    (step === 'setup' && s === 'account') ? t.green : t.elevated,
                  border: `1px solid ${step === s ? t.purple : t.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: '600',
                  color: step === s || (step === 'setup' && s === 'account') ? '#fff' : t.tertiary,
                }}>
                  {step === 'setup' && s === 'account' ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: '12px',
                  color: step === s ? t.text : t.tertiary,
                  fontWeight: step === s ? '500' : '400',
                  textTransform: 'capitalize',
                }}>
                  {s === 'account' ? 'Account' : 'Workspace'}
                </span>
                {i === 0 && (
                  <div style={{
                    width: '24px', height: '1px',
                    background: t.border,
                    margin: '0 4px',
                  }} />
                )}
              </div>
            ))}
          </div>

          {step === 'account' ? (
            <>
              <div style={{
                fontSize: '20px',
                fontWeight: '600',
                letterSpacing: '-0.4px',
                marginBottom: '6px',
              }}>
                {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
              </div>
              <div style={{
                fontSize: '13px',
                color: t.secondary,
                marginBottom: '28px',
              }}>
                {authMode === 'signup'
                  ? 'Start building your company brain.'
                  : 'Sign in to continue to NeuralOS.'}
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Work email</label>
                <input
                  style={input}
                  type="email"
                  placeholder="you@company.com"
                  value={account.email}
                  onChange={e => setAccount(p => ({ ...p, email: e.target.value }))}
                  onFocus={e => e.target.style.borderColor = t.purple}
                  onBlur={e => e.target.style.borderColor = t.border}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>Password</label>
                <input
                  style={input}
                  type="password"
                  placeholder="Min 8 characters"
                  value={account.password}
                  onChange={e => setAccount(p => ({ ...p, password: e.target.value }))}
                  onFocus={e => e.target.style.borderColor = t.purple}
                  onBlur={e => e.target.style.borderColor = t.border}
                  onKeyDown={e => e.key === 'Enter' && handleAccount()}
                />
              </div>

              {error && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: t.red,
                  marginBottom: '16px',
                }}>{error}</div>
              )}

              <button
                onClick={handleAccount}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '11px',
                  background: loading ? t.elevated : t.purple,
                  border: 'none',
                  borderRadius: '8px',
                  color: loading ? t.tertiary : '#fff',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '16px',
                  fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                {loading ? 'Please wait...' : authMode === 'signup' ? 'Continue →' : 'Sign in →'}
              </button>

              <div style={{
                textAlign: 'center',
                fontSize: '12px',
                color: t.tertiary,
              }}>
                {authMode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
                <span
                  onClick={() => { setAuthMode(authMode === 'signup' ? 'login' : 'signup'); setError('') }}
                  style={{ color: t.purple, cursor: 'pointer' }}
                >
                  {authMode === 'signup' ? 'Sign in' : 'Sign up'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{
                fontSize: '20px',
                fontWeight: '600',
                letterSpacing: '-0.4px',
                marginBottom: '6px',
              }}>Set up your workspace</div>
              <div style={{
                fontSize: '13px',
                color: t.secondary,
                marginBottom: '28px',
              }}>
                Connect your tools to initialize the company brain.
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Company name</label>
                <input
                  style={input}
                  placeholder="Acme Corp"
                  value={setup.company}
                  onChange={e => setSetup(p => ({ ...p, company: e.target.value }))}
                  onFocus={e => e.target.style.borderColor = t.purple}
                  onBlur={e => e.target.style.borderColor = t.border}
                />
              </div>

              {!setup.managed && (
                <>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={labelStyle}>
                      Gemini API key
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer"
                        style={{ color: t.purple, marginLeft: '8px', fontWeight: '400' }}>
                        Get key →
                      </a>
                    </label>
                    <input
                      style={input}
                      type="password"
                      placeholder="AIzaSy..."
                      value={setup.geminiKey}
                      onChange={e => setSetup(p => ({ ...p, geminiKey: e.target.value }))}
                      onFocus={e => e.target.style.borderColor = t.purple}
                      onBlur={e => e.target.style.borderColor = t.border}
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={labelStyle}>
                      Pinecone API key
                      <a href="https://app.pinecone.io" target="_blank" rel="noreferrer"
                        style={{ color: t.purple, marginLeft: '8px', fontWeight: '400' }}>
                        Get key →
                      </a>
                    </label>
                    <input
                      style={input}
                      type="password"
                      placeholder="pcsk_..."
                      value={setup.pineconeKey}
                      onChange={e => setSetup(p => ({ ...p, pineconeKey: e.target.value }))}
                      onFocus={e => e.target.style.borderColor = t.purple}
                      onBlur={e => e.target.style.borderColor = t.border}
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={labelStyle}>Pinecone index name</label>
                    <input
                      style={input}
                      placeholder="neuralos"
                      value={setup.pineconeIndex}
                      onChange={e => setSetup(p => ({ ...p, pineconeIndex: e.target.value }))}
                      onFocus={e => e.target.style.borderColor = t.purple}
                      onBlur={e => e.target.style.borderColor = t.border}
                    />
                  </div>
                </>
              )}

              {error && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: t.red,
                  marginBottom: '16px',
                }}>{error}</div>
              )}

              <button
                onClick={() => handleSetup(false)}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '11px',
                  background: loading ? t.elevated : t.purple,
                  border: 'none',
                  borderRadius: '8px',
                  color: loading ? t.tertiary : '#fff',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '10px',
                  fontFamily: 'inherit',
                }}
              >
                {loading ? 'Initializing...' : 'Initialize company brain →'}
              </button>

              <button
                onClick={() => {
                  setSetup(p => ({ ...p, managed: !p.managed }))
                  setError('')
                }}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: setup.managed ? t.purpleSubtle : 'transparent',
                  border: `1px solid ${setup.managed ? t.purple : t.border}`,
                  borderRadius: '8px',
                  color: setup.managed ? '#a78bfa' : t.tertiary,
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: '16px',
                }}
              >
                {setup.managed ? '✓ Using NeuralOS managed keys' : 'Use NeuralOS managed keys instead'}
              </button>

              {setup.managed && (
                <button
                  onClick={() => handleSetup(true)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '11px',
                    background: loading ? t.elevated : t.purple,
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    marginBottom: '16px',
                    fontFamily: 'inherit',
                  }}
                >
                  {loading ? 'Initializing...' : 'Continue with managed keys →'}
                </button>
              )}

              <div
                onClick={() => { setStep('account'); setError('') }}
                style={{
                  textAlign: 'center',
                  fontSize: '12px',
                  color: t.tertiary,
                  cursor: 'pointer',
                }}
              >
                ← Back to account
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}