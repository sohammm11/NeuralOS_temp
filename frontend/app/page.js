'use client'
import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { MessageSquare, Database, GitBranch, Settings, Send, Plus, Zap, Bot } from 'lucide-react'

const NAV = [
  { icon: MessageSquare, label: 'Chat' },
  { icon: Zap, label: 'Insights' },
  { icon: Database, label: 'Sources' },
  { icon: Bot, label: 'Agent' },
  { icon: GitBranch, label: 'Workflows' },
  { icon: Settings, label: 'Settings' },
]

const SUGGESTIONS = [
  'Why did we have issues with Flipkart?',
  'Who is our most at-risk client?',
  'What are problems with our route API?',
  'What tech stack do we use?',
]

export default function Home() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState('Chat')
  const [insights, setInsights] = useState([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [company, setCompany] = useState('Your Company')
  const [notionToken, setNotionToken] = useState(
    typeof window !== 'undefined' 
      ? localStorage.getItem('neuralos_notion_token') || ''
      : ''
  )
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [slackToken, setSlackToken] = useState('')
  const [slackSyncing, setSlackSyncing] = useState(false)
  const [slackSyncMessage, setSlackSyncMessage] = useState('')
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [gmailSyncMessage, setGmailSyncMessage] = useState('')
  const [agentInstruction, setAgentInstruction] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentSteps, setAgentSteps] = useState([])
  const bottomRef = useRef(null)

  useEffect(() => {
    const savedCompany = localStorage.getItem('neuralos_company')
    if (!savedCompany) {
      window.location.href = '/onboarding'
    } else {
      setCompany(savedCompany)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function askQuestion(q) {
    const userMessage = q || question
    if (!userMessage.trim()) return
    setQuestion('')
    setMessages(prev => [...prev, { role: 'user', text: userMessage }])
    setLoading(true)
    setMessages(prev => [...prev, { role: 'ai', text: '', sources: [] }])

    // Check if it's an action
    const actionWords = ['create task', 'add task', 'create a task',
                         'create follow up', 'add follow up', 'remind', 
                         'schedule', 'send message', 'send a message',
                         'message to', 'notify', 'ping', 'send slack',
                         'tell the team']
    const isAction = actionWords.some(w => userMessage.toLowerCase().includes(w))

    if (isAction) {
      try {
        const notionToken = localStorage.getItem('neuralos_notion_token')
        const slackToken = localStorage.getItem('neuralos_slack_token')
        const res = await fetch('http://localhost:8000/api/workflow', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': 'nros_swiftmove_demo_key'
          },
          body: JSON.stringify({
            message: userMessage,
            notion_token: notionToken,
            slack_token: slackToken
          })
        })
        const data = await res.json()
        setMessages(prev => prev.map((msg, i) =>
          i === prev.length - 1
            ? {
                ...msg,
                text: data.message + (data.url ? `\n\n[View in Notion](${data.url})` : ''),
                sources: ['Workflow Engine']
              }
            : msg
        ))
      } catch (err) {
        setMessages(prev => prev.map((msg, i) =>
          i === prev.length - 1
            ? { ...msg, text: 'Failed to execute workflow.' }
            : msg
        ))
      }
      setLoading(false)
      return
    }

    try {
      const res = await fetch('http://localhost:8000/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'nros_swiftmove_demo_key'
        },
        body: JSON.stringify({
          question: userMessage,
          history: messages
            .filter(m => m.text)
            .slice(-6)
            .map(m => ({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.text
            }))
        })
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'text') {
                setMessages(prev => prev.map((msg, i) =>
                  i === prev.length - 1 ? { ...msg, text: msg.text + data.content } : msg
                ))
              } else if (data.type === 'sources') {
                setMessages(prev => prev.map((msg, i) =>
                  i === prev.length - 1 ? { ...msg, sources: data.sources } : msg
                ))
              }
            } catch (e) { }
          }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map((msg, i) =>
        i === prev.length - 1 ? { ...msg, text: 'Backend not reachable. Make sure the server is running.' } : msg
      ))
    }
    setLoading(false)
  }

  async function fetchInsights() {
    setInsightsLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/insights', {
        headers: {
          'X-Api-Key': 'nros_swiftmove_demo_key'
        }
      })
      const data = await res.json()
      setInsights(data.insights)
    } catch (err) {
      setInsights([])
    }
    setInsightsLoading(false)
  }

  async function handleFeedback(index, type, msg) {
    if (type === 'good') {
      await fetch('http://localhost:8000/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'nros_swiftmove_demo_key'
        },
        body: JSON.stringify({
          question: messages[index - 1]?.text || '',
          answer: msg.text,
          feedback_type: 'good'
        })
      })
      setMessages(prev => prev.map((m, i) =>
        i === index ? { ...m, feedback: 'good' } : m
      ))
    } else {
      setMessages(prev => prev.map((m, i) =>
        i === index ? { ...m, showCorrection: true } : m
      ))
    }
  }

  async function submitCorrection(index, msg, correction) {
    if (!correction.trim()) return
    await fetch('http://localhost:8000/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'nros_swiftmove_demo_key'
      },
      body: JSON.stringify({
        question: messages[index - 1]?.text || '',
        answer: msg.text,
        feedback_type: 'bad',
        correction: correction
      })
    })
    setMessages(prev => prev.map((m, i) =>
      i === index
        ? { ...m, feedback: 'bad', showCorrection: false }
        : m
    ))
  }

  async function runAgent() {
    if (!agentInstruction.trim()) return
    setAgentRunning(true)
    setAgentSteps([])

    try {
      const res = await fetch('http://localhost:8000/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'nros_swiftmove_demo_key'
        },
        body: JSON.stringify({
          instruction: agentInstruction,
          notion_token: localStorage.getItem('neuralos_notion_token'),
          slack_token: localStorage.getItem('neuralos_slack_token')
        })
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              setAgentSteps(prev => [...prev, data])
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      setAgentSteps(prev => [...prev, {
        type: 'error',
        content: 'Agent failed. Is the backend running?'
      }])
    }
    setAgentRunning(false)
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#080b11',
      color: '#e2e8f0',
      fontFamily: 'Inter, -apple-system, sans-serif',
      fontSize: '14px',
    }}>

      {/* Sidebar */}
      <div style={{
        width: '216px',
        borderRight: '0.5px solid #13151f',
        display: 'flex',
        flexDirection: 'column',
        padding: '0',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{
          padding: '20px 16px 16px',
          borderBottom: '0.5px solid #13151f',
        }}>
          <div style={{
            fontSize: '15px',
            fontWeight: '600',
            color: '#a78bfa',
            letterSpacing: '-0.3px',
            marginBottom: '6px',
          }}>NeuralOS</div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: '#4a5068',
          }}>
            <span style={{
              width: '5px', height: '5px',
              borderRadius: '50%',
              background: '#10b981',
              flexShrink: 0,
            }} />
            {company}
          </div>
        </div>

        {/* New Chat */}
        <div style={{ padding: '12px 10px 8px' }}>
          <button
            onClick={() => setMessages([])}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '7px 10px',
              background: 'transparent',
              border: '0.5px solid #1e2130',
              borderRadius: '6px',
              color: '#6b7280',
              fontSize: '12px',
              cursor: 'pointer',
            }}>
            <Plus size={13} />
            New chat
          </button>
        </div>

        {/* Nav */}
        <nav style={{ padding: '4px 10px', flex: 1 }}>
          {NAV.map(({ icon: Icon, label }) => (
            <div
              key={label}
              onClick={() => {
                setActive(label)
                if (label === 'Insights' && insights.length === 0) {
                  fetchInsights()
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 10px',
                borderRadius: '6px',
                marginBottom: '1px',
                cursor: 'pointer',
                color: active === label ? '#e2e8f0' : '#4a5068',
                background: active === label ? '#13151f' : 'transparent',
                fontSize: '13px',
                fontWeight: active === label ? '500' : '400',
              }}>
              <Icon size={14} strokeWidth={1.5} />
              {label}
            </div>
          ))}
        </nav>

        {/* Sources indicator */}
        <div style={{
          padding: '12px 16px 20px',
          borderTop: '0.5px solid #13151f',
          fontSize: '11px',
          color: '#2a2f45',
          lineHeight: '1.6',
        }}>
          <div style={{ color: '#4a5068', marginBottom: '4px' }}>Connected sources</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
            Slack — 2 channels
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
            Notion — 3 pages
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}>

        {/* Header */}
        <div style={{
          padding: '14px 24px',
          borderBottom: '0.5px solid #13151f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '13px', color: '#4a5068', fontWeight: '500' }}>
            Company Brain
          </div>
          <div style={{
            fontSize: '11px',
            color: '#10b981',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}>
            <span style={{
              width: '5px', height: '5px',
              borderRadius: '50%',
              background: '#10b981',
            }} />
            5 documents indexed
          </div>
        </div>

        {/* Content Area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '32px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}>
          {active === 'Insights' ? (
  <div>
    <div style={{
      fontSize: '15px',
      fontWeight: '600',
      color: '#e2e8f0',
      marginBottom: '4px',
      letterSpacing: '-0.3px',
    }}>Company insights</div>
    <div style={{
      fontSize: '12px',
      color: '#4a5068',
      marginBottom: '24px',
    }}>
      NeuralOS automatically analyzed your company data.
    </div>

    {insightsLoading ? (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            padding: '16px',
            background: '#0d0f18',
            border: '0.5px solid #1e2130',
            borderRadius: '8px',
            color: '#2a2f45',
            fontSize: '12px',
          }}>
            Analyzing company data...
          </div>
        ))}
      </div>
    ) : (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {insights.map((insight, i) => (
          <div key={i} style={{
            padding: '16px',
            background: '#0d0f18',
            border: '0.5px solid #1e2130',
            borderRadius: '8px',
          }}>
            <div style={{
              fontSize: '11px',
              color: '#7c3aed',
              fontWeight: '500',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {insight.label}
            </div>
            <div style={{
              fontSize: '13px',
              color: '#c4c9d4',
              lineHeight: '1.7',
            }}>
              <ReactMarkdown>{insight.answer}</ReactMarkdown>
            </div>
            {insight.sources && insight.sources.length > 0 && (
              <div style={{
                marginTop: '10px',
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
              }}>
                {insight.sources.map((src, j) => (
                  <span key={j} style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: '0.5px solid #1e2130',
                    color: '#4a5068',
                    background: '#080b11',
                  }}>
                    {src}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setActive('Chat')
                askQuestion(`Tell me more about: ${insight.label}. ${insight.answer.slice(0, 100)}`)
              }}
              style={{
                marginTop: '12px',
                padding: '6px 12px',
                background: 'transparent',
                border: '0.5px solid #1e2130',
                borderRadius: '5px',
                color: '#4a5068',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              Dig deeper →
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
) : active === 'Sources' ? (
            <div>
              <div style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#e2e8f0',
                marginBottom: '4px',
                letterSpacing: '-0.3px',
              }}>Connected sources</div>
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                marginBottom: '24px',
              }}>NeuralOS is reading from these sources in real time.</div>

              {/* Notion Connect */}
              <div style={{
                padding: '16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '16px',
              }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#e2e8f0',
                  marginBottom: '4px',
                }}>Sync Notion pages</div>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '12px',
                }}>
                  Paste your Notion integration token to auto-sync all connected pages.
                </div>
                <input
                  type="password"
                  placeholder="ntn_..."
                  value={notionToken}
                  onChange={e => setNotionToken(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#080b11',
                    border: '0.5px solid #1e2130',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    outline: 'none',
                    marginBottom: '10px',
                  }}
                />
                <button
                  onClick={async () => {
                    if (!notionToken.trim()) return
                    setSyncing(true)
                    setSyncMessage('')
                    try {
                      const geminiKey = localStorage.getItem('neuralos_gemini_key')
                      const pineconeKey = localStorage.getItem('neuralos_pinecone_key')
                      const pineconeIndex = localStorage.getItem('neuralos_pinecone_index')

                      const res = await fetch('http://localhost:8000/api/sync/notion', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'X-Api-Key': 'nros_swiftmove_demo_key'
                        },
                        body: JSON.stringify({
                          notion_token: notionToken,
                          gemini_key: geminiKey === 'neuralos_managed'
                            ? 'neuralos_managed' : geminiKey,
                          pinecone_key: pineconeKey === 'neuralos_managed'
                            ? 'neuralos_managed' : pineconeKey,
                          pinecone_index: pineconeIndex || 'neuralos'
                        })
                      })
                      const data = await res.json()
                      setSyncMessage(data.message)
                    } catch (err) {
                      setSyncMessage('Failed to sync. Is the backend running?')
                    }
                    setSyncing(false)
                  }}
                  style={{
                    padding: '7px 14px',
                    background: syncing ? '#1e2130' : '#7c3aed',
                    border: 'none',
                    borderRadius: '5px',
                    color: syncing ? '#4a5068' : '#ffffff',
                    fontSize: '12px',
                    cursor: syncing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {syncing ? 'Syncing...' : 'Sync Notion →'}
                </button>
                {syncMessage && (
                  <div style={{
                    marginTop: '10px',
                    fontSize: '12px',
                    color: '#10b981',
                  }}>
                    {syncMessage}
                  </div>
                )}
                <div style={{
                  marginTop: '10px',
                  fontSize: '12px',
                  color: '#4a5068',
                }}>
                  <input
                    type="password"
                    placeholder="Save token for workflow actions..."
                    defaultValue={typeof window !== 'undefined' ? localStorage.getItem('neuralos_notion_token') || '' : ''}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: '#080b11',
                      border: '0.5px solid #1e2130',
                      borderRadius: '6px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                      outline: 'none',
                      marginTop: '6px',
                    }}
                    onChange={e => {
                      localStorage.setItem('neuralos_notion_token', e.target.value)
                    }}
                  />
                  <div style={{ marginTop: '4px', color: '#2a2f45' }}>
                    Saved locally for workflow actions
                  </div>
                </div>
              </div>

              {/* Slack Connect */}
              <div style={{
                padding: '16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '16px',
              }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#e2e8f0',
                  marginBottom: '4px',
                }}>Sync Slack channels</div>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '12px',
                }}>
                  Paste your Slack bot token to auto-sync all public channels.
                </div>
                <input
                  type="password"
                  placeholder="xoxb-..."
                  value={slackToken}
                  onChange={e => setSlackToken(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#080b11',
                    border: '0.5px solid #1e2130',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    outline: 'none',
                    marginBottom: '10px',
                  }}
                />
                <button
                  onClick={async () => {
                    if (!slackToken.trim()) return
                    setSlackSyncing(true)
                    setSlackSyncMessage('')
                    try {
                      const geminiKey = localStorage.getItem('neuralos_gemini_key')
                      const pineconeKey = localStorage.getItem('neuralos_pinecone_key')
                      const pineconeIndex = localStorage.getItem('neuralos_pinecone_index')

                      const res = await fetch('http://localhost:8000/api/sync/slack', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'X-Api-Key': 'nros_swiftmove_demo_key'
                        },
                        body: JSON.stringify({
                          slack_token: slackToken,
                          gemini_key: geminiKey === 'neuralos_managed'
                            ? 'neuralos_managed' : geminiKey,
                          pinecone_key: pineconeKey === 'neuralos_managed'
                            ? 'neuralos_managed' : pineconeKey,
                          pinecone_index: pineconeIndex || 'neuralos'
                        })
                      })
                      const data = await res.json()
                      setSlackSyncMessage(data.message)
                    } catch (err) {
                      setSlackSyncMessage('Failed to sync. Is the backend running?')
                    }
                    setSlackSyncing(false)
                  }}
                  style={{
                    padding: '7px 14px',
                    background: slackSyncing ? '#1e2130' : '#7c3aed',
                    border: 'none',
                    borderRadius: '5px',
                    color: slackSyncing ? '#4a5068' : '#ffffff',
                    fontSize: '12px',
                    cursor: slackSyncing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {slackSyncing ? 'Syncing...' : 'Sync Slack →'}
                </button>
                 {slackSyncMessage && (
                  <div style={{
                    marginTop: '10px',
                    fontSize: '12px',
                    color: '#10b981',
                  }}>
                    {slackSyncMessage}
                  </div>
                )}
                <div style={{
                  marginTop: '10px',
                  fontSize: '12px',
                  color: '#4a5068',
                }}>
                  <input
                    type="password"
                    placeholder="Save token for Slack actions..."
                    defaultValue={typeof window !== 'undefined' ? localStorage.getItem('neuralos_slack_token') || '' : ''}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: '#080b11',
                      border: '0.5px solid #1e2130',
                      borderRadius: '6px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                      outline: 'none',
                      marginTop: '6px',
                    }}
                    onChange={e => {
                      localStorage.setItem('neuralos_slack_token', e.target.value)
                    }}
                  />
                  <div style={{ marginTop: '4px', color: '#2a2f45' }}>
                    Saved locally for Slack actions
                  </div>
                </div>
              </div>

              {/* Gmail Connect */}
              <div style={{
                padding: '16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '16px',
              }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#e2e8f0',
                  marginBottom: '4px',
                }}>Sync Gmail</div>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '12px',
                  lineHeight: '1.6',
                }}>
                  Sync your recent emails into NeuralOS.
                  First time will open a browser to authenticate with Google.
                </div>
                <button
                  onClick={async () => {
                    setGmailSyncing(true)
                    setGmailSyncMessage('')
                    try {
                      const res = await fetch('http://localhost:8000/api/sync/gmail', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'X-Api-Key': 'nros_swiftmove_demo_key'
                        },
                        body: JSON.stringify({})
                      })
                      const data = await res.json()
                      setGmailSyncMessage(data.message)
                    } catch (err) {
                      setGmailSyncMessage('Failed to sync. Is the backend running?')
                    }
                    setGmailSyncing(false)
                  }}
                  style={{
                    padding: '7px 14px',
                    background: gmailSyncing ? '#1e2130' : '#7c3aed',
                    border: 'none',
                    borderRadius: '5px',
                    color: gmailSyncing ? '#4a5068' : '#ffffff',
                    fontSize: '12px',
                    cursor: gmailSyncing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {gmailSyncing ? 'Syncing...' : 'Sync Gmail →'}
                </button>
                {gmailSyncMessage && (
                  <div style={{
                    marginTop: '10px',
                    fontSize: '12px',
                    color: '#10b981',
                  }}>
                    {gmailSyncMessage}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  {
                    name: 'Slack — #incidents',
                    desc: 'SLA breaches, escalations, incident threads',
                    count: '9 messages',
                    time: 'Synced just now',
                  },
                  {
                    name: 'Slack — #general',
                    desc: 'Company announcements, onboarding updates',
                    count: '5 messages',
                    time: 'Synced just now',
                  },
                  {
                    name: 'Notion — Flipkart Post-Mortem',
                    desc: 'December 2024 incident analysis and action items',
                    count: '1 page',
                    time: 'Synced just now',
                  },
                  {
                    name: 'Notion — Flipkart Client Account',
                    desc: 'Account health, SLA terms, key contacts',
                    count: '1 page',
                    time: 'Synced just now',
                  },
                  {
                    name: 'Notion — Architecture Overview',
                    desc: 'Tech stack, known issues, improvement plans',
                    count: '1 page',
                    time: 'Synced just now',
                  },
                ].map((src, i) => (
                  <div key={i} style={{
                    padding: '14px 16px',
                    background: '#0d0f18',
                    border: '0.5px solid #1e2130',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '500',
                        color: '#e2e8f0',
                        marginBottom: '3px',
                      }}>{src.name}</div>
                      <div style={{
                        fontSize: '12px',
                        color: '#4a5068',
                      }}>{src.desc}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '24px' }}>
                      <div style={{
                        fontSize: '11px',
                        color: '#10b981',
                        marginBottom: '2px',
                      }}>{src.count}</div>
                      <div style={{
                        fontSize: '11px',
                        color: '#2a2f45',
                      }}>{src.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : active === 'Agent' ? (
            <div>
              <div style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#e2e8f0',
                marginBottom: '4px',
                letterSpacing: '-0.3px',
              }}>Agent execution</div>
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                marginBottom: '24px',
                lineHeight: '1.6',
              }}>
                Give NeuralOS a complex instruction and watch it execute automatically.
              </div>

              {/* Instruction input */}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '24px',
              }}>
                <input
                  value={agentInstruction}
                  onChange={e => setAgentInstruction(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !agentRunning && runAgent()}
                  placeholder="Find all overdue action items and create tasks in Notion..."
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: '#0d0f18',
                    border: '0.5px solid #1e2130',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={runAgent}
                  disabled={agentRunning}
                  style={{
                    padding: '10px 16px',
                    background: agentRunning ? '#1e2130' : '#7c3aed',
                    border: 'none',
                    borderRadius: '6px',
                    color: agentRunning ? '#4a5068' : '#ffffff',
                    fontSize: '13px',
                    cursor: agentRunning ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {agentRunning ? 'Running...' : 'Run agent →'}
                </button>
              </div>

              {/* Suggested instructions */}
              {agentSteps.length === 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  marginBottom: '24px',
                }}>
                  {[
                    'Find all overdue action items and create tasks in Notion for each owner',
                    'Summarize the Flipkart situation and send a briefing to the general channel',
                    'Find technical risks and create tasks for Dev Mehta to fix them',
                  ].map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setAgentInstruction(s)}
                      style={{
                        padding: '10px 12px',
                        background: '#0d0f18',
                        border: '0.5px solid #1e2130',
                        borderRadius: '6px',
                        color: '#6b7280',
                        fontSize: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Agent steps feed */}
              {agentSteps.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}>
                  {agentSteps.map((step, i) => (
                    <div key={i} style={{
                      padding: '10px 14px',
                      background: '#0d0f18',
                      border: `0.5px solid ${
                        step.type === 'error' ? '#3a1010' :
                        step.type === 'done' ? '#0a2a1a' :
                        '#1e2130'
                      }`,
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: step.type === 'error' ? '#ef4444' :
                             step.type === 'done' ? '#10b981' :
                             step.type === 'status' ? '#7c3aed' :
                             step.type === 'step' ? '#a78bfa' :
                             '#c4c9d4',
                      lineHeight: '1.6',
                    }}>
                      <ReactMarkdown>{step.content}</ReactMarkdown>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : active === 'Workflows' ? (
            <div style={{
              margin: 'auto',
              textAlign: 'center',
              maxWidth: '400px',
            }}>
              <div style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#e2e8f0',
                marginBottom: '8px',
                letterSpacing: '-0.3px',
              }}>Workflows</div>
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                lineHeight: '1.6',
              }}>
                Automate actions across your tools.<br/>
                Coming soon.
              </div>
            </div>
          ) : active === 'Settings' ? (
            <div style={{
              maxWidth: '480px',
              width: '100%',
            }}>
              <div style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#e2e8f0',
                marginBottom: '4px',
                letterSpacing: '-0.3px',
              }}>Settings</div>
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                marginBottom: '24px',
              }}>Manage your NeuralOS configuration.</div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '10px',
              }}>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '4px',
                }}>Company</div>
                <div style={{
                  fontSize: '13px',
                  color: '#e2e8f0',
                }}>SwiftMove Logistics</div>
              </div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '10px',
              }}>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '4px',
                }}>AI Model</div>
                <div style={{
                  fontSize: '13px',
                  color: '#e2e8f0',
                }}>Gemini 2.5 Flash</div>
              </div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
              }}>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '4px',
                }}>Vector Database</div>
                <div style={{
                  fontSize: '13px',
                  color: '#e2e8f0',
                }}>Pinecone — neuralos index</div>
              </div>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <div style={{
                  margin: 'auto',
                  textAlign: 'center',
                  maxWidth: '480px',
                }}>
                  <div style={{
                    fontSize: '22px',
                    fontWeight: '600',
                    color: '#e2e8f0',
                    marginBottom: '8px',
                    letterSpacing: '-0.5px',
                  }}>
                    What do you want to know?
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#4a5068',
                    marginBottom: '32px',
                    lineHeight: '1.6',
                  }}>
                    Ask anything about SwiftMove Logistics. NeuralOS searches across Slack and Notion to find answers.
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                  }}>
                    {SUGGESTIONS.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => askQuestion(s)}
                        style={{
                          padding: '10px 12px',
                          background: '#0d0f18',
                          border: '0.5px solid #1e2130',
                          borderRadius: '8px',
                          color: '#6b7280',
                          fontSize: '12px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          lineHeight: '1.5',
                        }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: '8px',
                }}>
                  {msg.role === 'user' ? (
                    <div style={{
                      maxWidth: '60%',
                      padding: '10px 14px',
                      background: '#13151f',
                      border: '0.5px solid #1e2130',
                      borderRadius: '10px',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      color: '#e2e8f0',
                    }}>
                      {msg.text}
                    </div>
                  ) : (
                    <div style={{ maxWidth: '75%' }}>
                      <div style={{
                        fontSize: '11px',
                        color: '#4a5068',
                        marginBottom: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}>
                        <span style={{
                          width: '16px', height: '16px',
                          borderRadius: '4px',
                          background: '#7c3aed20',
                          border: '0.5px solid #7c3aed40',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '9px',
                          color: '#a78bfa',
                          fontWeight: '600',
                        }}>N</span>
                        NeuralOS
                      </div>
                      <div style={{
                        fontSize: '13px',
                        lineHeight: '1.8',
                        color: '#c4c9d4',
                      }}>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                        {loading && i === messages.length - 1 && (
                          <span style={{
                            display: 'inline-block',
                            width: '2px',
                            height: '14px',
                            background: '#7c3aed',
                            marginLeft: '2px',
                            verticalAlign: 'middle',
                            animation: 'blink 1s infinite',
                          }} />
                        )}
                      </div>

                      {/* Feedback buttons */}
                      {msg.role === 'ai' && msg.text && !loading && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginTop: '8px',
                        }}>
                          {msg.feedback ? (
                            <span style={{
                              fontSize: '11px',
                              color: '#4a5068',
                            }}>
                              {msg.feedback === 'good' ? '👍 Helpful' : '👎 Correction saved'}
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleFeedback(i, 'good', msg)}
                                style={{
                                  padding: '3px 8px',
                                  background: 'transparent',
                                  border: '0.5px solid #1e2130',
                                  borderRadius: '4px',
                                  color: '#4a5068',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >👍</button>
                              <button
                                onClick={() => handleFeedback(i, 'bad', msg)}
                                style={{
                                  padding: '3px 8px',
                                  background: 'transparent',
                                  border: '0.5px solid #1e2130',
                                  borderRadius: '4px',
                                  color: '#4a5068',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >👎</button>
                            </>
                          )}
                        </div>
                      )}

                      {/* Correction input */}
                      {msg.showCorrection && (
                        <div style={{
                          marginTop: '8px',
                          display: 'flex',
                          gap: '8px',
                        }}>
                          <input
                            placeholder="What's the correct answer?"
                            style={{
                              flex: 1,
                              padding: '6px 10px',
                              background: '#080b11',
                              border: '0.5px solid #1e2130',
                              borderRadius: '5px',
                              color: '#e2e8f0',
                              fontSize: '12px',
                              outline: 'none',
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                submitCorrection(i, msg, e.target.value)
                              }
                            }}
                          />
                          <button
                            onClick={e => {
                              const input = e.target.previousSibling
                              submitCorrection(i, msg, input.value)
                            }}
                            style={{
                              padding: '6px 10px',
                              background: '#7c3aed',
                              border: 'none',
                              borderRadius: '5px',
                              color: '#ffffff',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >Save</button>
                        </div>
                      )}

                      {msg.sources && msg.sources.length > 0 && (
                        <div style={{
                          marginTop: '10px',
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}>
                          {msg.sources.map((src, j) => (
                            <span key={j} style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: '0.5px solid #1e2130',
                              color: '#4a5068',
                              background: '#0d0f18',
                            }}>
                              {src}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div style={{
          padding: '16px 24px 20px',
          borderTop: '0.5px solid #13151f',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#0d0f18',
            border: '0.5px solid #1e2130',
            borderRadius: '8px',
            padding: '10px 12px',
          }}>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && askQuestion()}
              placeholder="Ask anything about your company..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e2e8f0',
                fontSize: '13px',
              }}
            />
            <button
              onClick={() => askQuestion()}
              disabled={loading}
              style={{
                background: loading ? '#1e2130' : '#7c3aed',
                border: 'none',
                borderRadius: '5px',
                padding: '5px 8px',
                color: loading ? '#4a5068' : '#ffffff',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}>
              <Send size={13} />
            </button>
          </div>
          <div style={{
            fontSize: '11px',
            color: '#2a2f45',
            marginTop: '8px',
            textAlign: 'center',
          }}>
            NeuralOS · SwiftMove Logistics · Slack + Notion
          </div>
        </div>
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  )
}