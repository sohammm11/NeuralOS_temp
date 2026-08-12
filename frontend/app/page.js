'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { MessageSquare, Database, GitBranch, Settings, Send, Plus, Zap, Bot, Loader2, Network, Clock, LayoutDashboard } from 'lucide-react'
import { tokens, btn, card } from './design'
import { useRouter } from 'next/navigation'
import KnowledgeGraph from './components/KnowledgeGraph'

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: MessageSquare, label: 'Chat' },
  { icon: Zap, label: 'Insights' },
  { icon: Database, label: 'Sources' },
  { icon: Bot, label: 'Agent' },
  { icon: Network, label: 'Graph' },
  { icon: Clock, label: 'Timeline' },
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
  const router = useRouter()
  async function fetchWithRetry(url, options, retries = 1) {
    try {
      return await fetch(url, options)
    } catch (err) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 1000))
        return fetchWithRetry(url, options, retries - 1)
      }
      throw err
    }
  }

  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState('Dashboard')
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
  const [slackToken, setSlackToken] = useState(
    typeof window !== 'undefined'
      ? localStorage.getItem('neuralos_slack_token') || ''
      : ''
  )
  const [slackSyncing, setSlackSyncing] = useState(false)
  const [slackSyncMessage, setSlackSyncMessage] = useState('')
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [gmailSyncMessage, setGmailSyncMessage] = useState('')
  const [driveSyncing, setDriveSyncing] = useState(false)
  const [driveSyncMessage, setDriveSyncMessage] = useState('')
  const [syncStatus, setSyncStatus] = useState([])
  const [agentInstruction, setAgentInstruction] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentSteps, setAgentSteps] = useState([])

  // Meeting Intelligence state
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [meetingTranscript, setMeetingTranscript] = useState('');
  const [meetingFile, setMeetingFile] = useState(null);
  const [meetingProcessing, setMeetingProcessing] = useState(false);
  const [meetingResults, setMeetingResults] = useState(null);
  const [selectedActionItems, setSelectedActionItems] = useState(new Set());
  const [creatingTasks, setCreatingTasks] = useState(false);

  // Chat sessions state
  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [sessionSearch, setSessionSearch] = useState('')
  const [researchMode, setResearchMode] = useState('quick') // 'quick' | 'deep'

  const [pendingActions, setPendingActions] = useState([])
  const [pendingActionsLoading, setPendingActionsLoading] = useState(false)
  const [backendOnline, setBackendOnline] = useState(true)
  const [alerts, setAlerts] = useState([])
  const [scanning, setScanning] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [selectedNode, setSelectedNode] = useState(null)
  const [thinkingSteps, setThinkingSteps] = useState([])
  const [showThinking, setShowThinking] = useState(false)
  const [timelineEvents, setTimelineEvents] = useState([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractMessage, setExtractMessage] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const [schedulerStatus, setSchedulerStatus] = useState(null)
  const [triggeringSyncAll, setTriggeringSyncAll] = useState(false)
  const [syncAllMessage, setSyncAllMessage] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const bottomRef = useRef(null)
  const intervalsRef = useRef([])

  const [chatImage, setChatImage] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)

  async function handleImageUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    
    setChatImage(file)
    
    // Show preview
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target.result)
    reader.readAsDataURL(file)
  }

  async function sendWithImage() {
    if (!question.trim() && !chatImage) return
    
    setLoading(true)
    setMessages(prev => [
      ...prev,
      { role: 'user', text: question, image: imagePreview },
      { role: 'ai', text: '', sources: [] }
    ])
    
    const formData = new FormData()
    if (chatImage) formData.append('file', chatImage)
    formData.append('question', question)
    
    setQuestion('')
    setChatImage(null)
    setImagePreview(null)
    
    try {
      const res = await fetch('http://localhost:8000/api/chat/with-image', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      })
      
      const data = await res.json()
      
      setMessages(prev => prev.map((msg, i) =>
        i === prev.length - 1
          ? { ...msg, text: data.answer, sources: data.sources || [] }
          : msg
      ))
    } catch (err) {
      console.error('Image chat error:', err)
      setMessages(prev => prev.map((msg, i) =>
        i === prev.length - 1
          ? { ...msg, text: 'Backend not reachable or error analyzing image.' }
          : msg
      ))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const savedCompany = localStorage.getItem('neuralos_company')
    if (!savedCompany) {
      window.location.replace('/onboarding')
      return
    }
    setCompany(savedCompany)
    fetchAlerts()
    fetchSyncStatus()
    fetchSchedulerStatus()
    fetchDashboard()
    fetchSessions()
  }, [])

  async function fetchDashboard() {
    setDashboardLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/dashboard', {
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success) setDashboard(data)
    } catch (err) {}
    setDashboardLoading(false)
  }

  async function fetchTimeline() {
    setTimelineLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/timeline', {
        credentials: 'include'
      })
      const data = await res.json()
      setTimelineEvents(data.events || [])
    } catch (err) {}
    setTimelineLoading(false)
  }

  async function fetchSchedulerStatus() {
    try {
      const res = await fetch('http://localhost:8000/api/scheduler/status', {
        credentials: 'include'
      })
      const data = await res.json()
      setSchedulerStatus(data)
    } catch (err) {}
  }

  async function triggerManualSync() {
    setTriggeringSyncAll(true)
    setSyncAllMessage('')
    try {
      const res = await fetch('http://localhost:8000/api/scheduler/trigger', {
        method: 'POST',
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success) {
        setSyncAllMessage('All sources synced successfully.')
        fetchSyncStatus()
        fetchAlerts()
      } else {
        setSyncAllMessage('Sync failed.')
      }
    } catch (err) {
      setSyncAllMessage('Could not reach backend.')
    }
    setTriggeringSyncAll(false)
  }

  async function extractGraph() {
    setExtracting(true)
    setIsExtracting(true)  // pause health checks
    setExtractMessage('')
    try {
      const res = await fetch('http://localhost:8000/api/graph/extract', {
        method: 'POST',
        credentials: 'include'
      })
      const data = await res.json()
      setExtractMessage(data.message)
      if (data.success) {
        setTimeout(() => setActive('Graph'), 1500)
      }
    } catch (err) {
      setExtractMessage('Extraction failed.')
    }
    setExtracting(false)
    setIsExtracting(false)  // resume health checks
    setBackendOnline(true)  // reset banner immediately
  }

  async function handleLogout() {
    try {
      await fetch('http://localhost:8000/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
    } catch (err) {}
    localStorage.clear()
    // Stop all intervals before redirecting
    window.location.replace('/onboarding')
  }


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function askQuestion(q) {
    const userMessage = q || question
    if (!userMessage.trim()) return
    setQuestion('')
    setThinkingSteps([])

    // Create session if none exists
    let sessionId = currentSessionId
    if (!sessionId) {
      sessionId = await createNewSession(userMessage)
    }

    // Save user message to session
    saveMessageToSession(sessionId, 'user', userMessage)

    setMessages(prev => [...prev, { role: 'user', text: userMessage }])
    setLoading(true)
    setMessages(prev => [...prev, { role: 'ai', text: '', sources: [] }])

    // Check if it's an action
    const actionWords = [
      'create task', 'add task', 'create a task',
      'create follow up', 'add follow up', 'remind',
      'schedule', 'send message', 'send a message',
      'message to', 'notify', 'ping', 'send slack',
      'tell the team', 'create a notion', 'create notion',
      'create a doc', 'create doc', 'add to notion',
      'write a doc', 'make a doc', 'create a page'
    ]
    const isAction = actionWords.some(w => userMessage.toLowerCase().includes(w))

    if (isAction) {
      let actionText = ''
      try {
        const notionToken = localStorage.getItem('neuralos_notion_token')
        const slackToken = localStorage.getItem('neuralos_slack_token')
        const res = await fetch('http://localhost:8000/api/workflow', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: userMessage,
            notion_token: notionToken,
            slack_token: slackToken
          })
        })
        const data = await res.json()
        actionText = data.message + (data.url ? `\n\n[View in Notion](${data.url})` : '')
        setMessages(prev => prev.map((msg, i) =>
          i === prev.length - 1
            ? {
                ...msg,
                text: actionText,
                sources: ['Workflow Engine']
              }
            : msg
        ))
      } catch (err) {
        actionText = 'Failed to execute workflow.'
        setMessages(prev => prev.map((msg, i) =>
          i === prev.length - 1
            ? { ...msg, text: actionText }
            : msg
        ))
      }
      if (sessionId) {
        saveMessageToSession(sessionId, 'ai', actionText, ['Workflow Engine'], [])
      }
      setLoading(false)
      return
    }

    if (researchMode === 'deep') {
      let deepText = ''
      let deepSources = []
      let currentThinking = []
      try {
        const res = await fetchWithRetry('http://localhost:8000/api/research/deep', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            question: userMessage
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
                if (data.step === 'retrieving' || data.step === 'clustering') {
                  const stepObj = {
                    type: 'thinking',
                    step: data.step,
                    content: data.status || `Processing ${data.step}...`
                  }
                  setThinkingSteps(prev => [...prev, stepObj])
                  currentThinking.push(stepObj)
                  setShowThinking(true)
                } else if (data.step === 'synthesizing') {
                  const stepObj = {
                    type: 'thinking',
                    step: data.section,
                    content: data.status || `Writing section: ${data.section}`
                  }
                  setThinkingSteps(prev => [...prev, stepObj])
                  currentThinking.push(stepObj)
                  setShowThinking(true)
                  if (data.content) {
                    deepText += `\n\n### ${data.section.toUpperCase()}\n${data.content}`
                    setMessages(prev => prev.map((msg, i) =>
                      i === prev.length - 1 ? { ...msg, text: deepText } : msg
                    ))
                  }
                } else if (data.step === 'done') {
                  deepText = data.answer
                  deepSources = data.sources || []
                  setMessages(prev => prev.map((msg, i) =>
                    i === prev.length - 1 ? { ...msg, text: deepText, sources: deepSources } : msg
                  ))
                  setThinkingSteps(prev => [...prev, {
                    type: 'thinking',
                    step: 'done',
                    content: 'Deep research report complete'
                  }])
                  currentThinking.push({
                    type: 'thinking',
                    step: 'done',
                    content: 'Deep research report complete'
                  })
                }
              } catch (e) { }
            }
          }
        }

        if (sessionId) {
          saveMessageToSession(sessionId, 'ai', deepText, deepSources, currentThinking)
        }
      } catch (err) {
        const errText = 'Deep research failed. Make sure the backend server is running.'
        setMessages(prev => prev.map((msg, i) =>
          i === prev.length - 1 ? { ...msg, text: errText } : msg
        ))
        if (sessionId) {
          saveMessageToSession(sessionId, 'ai', errText, [], [])
        }
      }
      setLoading(false)
      return
    }

    let aiText = ''
    let aiSources = []
    let currentThinking = []
    try {
      const res = await fetchWithRetry('http://localhost:8000/api/chat/stream', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
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
              if (data.type === 'thinking') {
                console.log('THINKING STEP:', data)
                setThinkingSteps(prev => [...prev, data])
                currentThinking.push(data)
                setShowThinking(true)
              } else if (data.type === 'text') {
                aiText += data.content
                setMessages(prev => prev.map((msg, i) =>
                  i === prev.length - 1 ? { ...msg, text: msg.text + data.content } : msg
                ))
              } else if (data.type === 'sources') {
                aiSources = data.sources
                setMessages(prev => prev.map((msg, i) =>
                  i === prev.length - 1 ? { ...msg, sources: data.sources } : msg
                ))
                setThinkingSteps(prev => [...prev, {
                  type: 'thinking',
                  step: 'done',
                  content: 'Answer complete'
                }])
                currentThinking.push({
                  type: 'thinking',
                  step: 'done',
                  content: 'Answer complete'
                })
              }
            } catch (e) { }
          }
        }
      }

      // Save AI response to session on success
      if (sessionId) {
        saveMessageToSession(
          sessionId,
          'ai', 
          aiText,
          aiSources,
          currentThinking
        )
      }
    } catch (err) {
      const errText = 'Backend not reachable. Make sure the server is running.'
      setMessages(prev => prev.map((msg, i) =>
        i === prev.length - 1 ? { ...msg, text: errText } : msg
      ))
      if (sessionId) {
        saveMessageToSession(sessionId, 'ai', errText, [], [])
      }
    }
    setLoading(false)
  }

  async function fetchInsights() {
    setInsightsLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/insights', {
        credentials: 'include'
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
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
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
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
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

  // Meeting Intelligence handlers
  const processMeeting = async () => {
    if (!meetingTranscript.trim() && !meetingFile) {
      alert('Please paste a transcript or upload a file');
      return;
    }
    
    setMeetingProcessing(true);
    setMeetingResults(null);
    
    try {
      let response;
      
      if (meetingFile) {
        // File upload
        const formData = new FormData();
        formData.append('file', meetingFile);
        
        response = await fetchWithRetry('http://localhost:8000/api/meetings/process', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
      } else {
        // Text paste
        response = await fetchWithRetry('http://localhost:8000/api/meetings/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: meetingTranscript }),
          credentials: 'include',
        });
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Processing failed');
      }
      
      const result = await response.json();
      setMeetingResults(result);
      
      // Auto-select all action items
      const allIndices = new Set(
        result.data.action_items.map((_, idx) => idx)
      );
      setSelectedActionItems(allIndices);
      
    } catch (error) {
      console.error('Meeting processing error:', error);
      alert(`Failed to process meeting: ${error.message}`);
    } finally {
      setMeetingProcessing(false);
    }
  };

  const toggleActionItem = (index) => {
    const newSelected = new Set(selectedActionItems);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedActionItems(newSelected);
  };

  const createMeetingTasks = async () => {
    if (selectedActionItems.size === 0) {
      alert('Please select at least one action item');
      return;
    }
    
    setCreatingTasks(true);
    
    try {
      const selectedItems = Array.from(selectedActionItems).map(idx => 
        meetingResults.data.action_items[idx]
      );
      
      const response = await fetchWithRetry('http://localhost:8000/api/meetings/create-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_items: selectedItems,
          meeting_title: meetingResults.data.metadata?.title || 'Meeting',
          notion_token: localStorage.getItem('neuralos_notion_token'),
        }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Task creation failed');
      }
      
      const result = await response.json();
      alert(`✅ ${result.message}`);
      
      // Close modal and reset
      setShowMeetingModal(false);
      setMeetingTranscript('');
      setMeetingFile(null);
      setMeetingResults(null);
      setSelectedActionItems(new Set());
      
      // Optionally refresh workflows tab
      // fetchPendingActions();
      
    } catch (error) {
      console.error('Task creation error:', error);
      alert(`Failed to create tasks: ${error.message}`);
    } finally {
      setCreatingTasks(false);
    }
  };

  const closeMeetingModal = () => {
    setShowMeetingModal(false);
    setMeetingTranscript('');
    setMeetingFile(null);
    setMeetingResults(null);
    setSelectedActionItems(new Set());
  };

  async function runAgent() {
    if (!agentInstruction.trim()) return
    setAgentRunning(true)
    setAgentSteps([])

    try {
      const res = await fetch('http://localhost:8000/api/agent', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
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

  async function fetchPendingActions() {
    setPendingActionsLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/actions/pending', {
        credentials: 'include'
      })
      const data = await res.json()
      setPendingActions(data.actions || [])
    } catch (err) {
      setPendingActions([])
    }
    setPendingActionsLoading(false)
  }

  async function handleActionDecision(actionId, decision) {
    // Mark this specific card as processing
    setPendingActions(prev => prev.map(a =>
      a._id === actionId ? { ...a, processing: true } : a
    ))

    try {
      const res = await fetch(`http://localhost:8000/api/actions/${decision}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action_id: actionId })
      })
      const data = await res.json()

      // Show result state on the card briefly before removing it
      setPendingActions(prev => prev.map(a =>
        a._id === actionId
          ? {
              ...a,
              processing: false,
              resolved: decision,
              resultMessage: data.message + (data.url ? ' — View in Notion' : ''),
              url: data.url
            }
          : a
      ))

      // Remove the card after showing the result for a moment
      setTimeout(() => {
        setPendingActions(prev => prev.filter(a => a._id !== actionId))
      }, 2500)

    } catch (err) {
      setPendingActions(prev => prev.map(a =>
        a._id === actionId
          ? { ...a, processing: false, resolved: 'error', resultMessage: 'Failed to reach backend.' }
          : a
      ))
    }
  }

  async function fetchSyncStatus() {
    try {
      const res = await fetch('http://localhost:8000/api/sync/status', {
        credentials: 'include'
      })
      const data = await res.json()
      setSyncStatus(data.history || [])
    } catch (err) {
      setSyncStatus([])
    }
  }

  function isStale(syncedAt) {
    const daysSince = (Date.now() - new Date(syncedAt).getTime()) / (1000 * 60 * 60 * 24)
    return daysSince > 30
  }

  async function checkBackendHealth() {
    if (isExtracting) return  // skip health check during extraction
    try {
      const res = await fetch('http://localhost:8000/api/health', {
        signal: AbortSignal.timeout(10000)
      })
      setBackendOnline(res.ok)
    } catch (err) {
      setBackendOnline(false)
    }
  }

  async function fetchAlerts() {
    try {
      const res = await fetch('http://localhost:8000/api/alerts', {
        credentials: 'include'
      })
      const data = await res.json()
      setAlerts(data.alerts || [])
    } catch (err) {}
  }

  async function runScan() {
    setScanning(true)
    setScanMessage('')
    try {
      const res = await fetch('http://localhost:8000/api/anomaly/scan', {
        method: 'POST',
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success) {
        setScanMessage(
          data.alerts_found > 0
            ? `⚠️ ${data.alerts_found} anomaly${data.alerts_found > 1 ? 'ies' : ''} detected — check the 🔔 bell icon above.`
            : '✓ Scan complete. No anomalies detected.'
        )
        await fetchAlerts()
      }
    } catch (err) {
      setScanMessage('Scan failed. Is the backend running?')
    }
    setScanning(false)
  }

  async function resolveAlert(alertId) {
    try {
      await fetch('http://localhost:8000/api/alerts/resolve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId })
      })
      setAlerts(prev => prev.filter(a => a._id !== alertId))
    } catch (err) {}
  }

  function formatEventDescription(event) {
    if (event.type === 'action') {
      try {
        const details = typeof event.description === 'string' 
          ? event.description 
          : JSON.stringify(event.description)
        
        if (details.includes('title')) {
          const titleMatch = details.match(/title['":\s]+([^'"]+)/)
          const assigneeMatch = details.match(/assignee['":\s]+([^'"},]+)/)
          const title = titleMatch ? titleMatch[1].replace(/[\\'"]/g, '').trim() : 'Untitled'
          const assignee = assigneeMatch ? assigneeMatch[1].replace(/[\\'"]/g, '').trim() : 'Unassigned'
          return `Title: ${title} · Assignee: ${assignee}`
        }
        if (details.includes('message')) {
          const msgMatch = details.match(/message['":\s]+([^'"]{0,80})/)
          return msgMatch ? `Message: ${msgMatch[1].trim()}` : 'Slack message'
        }
      } catch (e) {}
    }
    return event.description?.slice(0, 100) || ''
  }

  async function fetchSessions() {
    try {
      const res = await fetch('http://localhost:8000/api/sessions', {
        credentials: 'include'
      })
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (err) {}
  }

  async function createNewSession(firstQuestion = 'New chat') {
    try {
      const title = firstQuestion.slice(0, 40) + (firstQuestion.length > 40 ? '...' : '')
      const res = await fetch('http://localhost:8000/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      })
      const data = await res.json()
      if (data.success) {
        setCurrentSessionId(data.session_id)
        fetchSessions()
        return data.session_id
      }
    } catch (err) {}
    return null
  }

  async function saveMessageToSession(sessionId, role, content, sources = [], reasoning = []) {
    if (!sessionId) return
    try {
      await fetch('http://localhost:8000/api/sessions/message', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          role,
          content,
          sources,
          reasoning: reasoning.map(r => r.content || r || '')
        })
      })
    } catch (err) {}
  }

  async function loadSession(sessionId) {
    try {
      const res = await fetch(`http://localhost:8000/api/sessions/${sessionId}`, {
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success && data.session) {
        const msgs = data.session.messages.map(m => ({
          role: m.role,
          text: m.content,
          sources: m.sources || [],
        }))
        setMessages(msgs)
        setCurrentSessionId(sessionId)
        setActive('Chat')
      }
    } catch (err) {}
  }

  async function deleteSessionById(sessionId, e) {
    e.stopPropagation()
    try {
      await fetch(`http://localhost:8000/api/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      setSessions(prev => prev.filter(s => s._id !== sessionId))
      if (currentSessionId === sessionId) {
        setMessages([])
        setCurrentSessionId(null)
      }
    } catch (err) {}
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
      {!backendOnline && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          padding: '8px 16px',
          background: '#2a1010',
          borderBottom: '0.5px solid #3a1010',
          color: '#ef4444',
          fontSize: '12px',
          textAlign: 'center',
        }}>
          Backend is unreachable — answers and actions won't work until it's back online.
        </div>
      )}



      {/* Sidebar */}
      <div style={{
        width: '220px',
        borderRight: `1px solid ${tokens.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: tokens.bg.base,
      }}>
        {/* Logo */}
        <div style={{
          padding: `${tokens.space[5]} ${tokens.space[4]}`,
          borderBottom: `1px solid ${tokens.border.subtle}`,
        }}>
          <div style={{
            fontSize: tokens.font.lg,
            fontWeight: tokens.weight.semibold,
            color: '#a78bfa',
            letterSpacing: '-0.4px',
            marginBottom: tokens.space[1],
          }}>NeuralOS</div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            fontSize: tokens.font.xs,
            color: tokens.text.tertiary,
          }}>
            <span style={{
              width: '5px', height: '5px',
              borderRadius: '50%',
              background: tokens.accent.green,
              flexShrink: 0,
            }}/>
            {company}
          </div>
        </div>

        {/* New chat */}
        <div style={{ padding: `${tokens.space[3]} ${tokens.space[2]}` }}>
          <button
            onClick={() => {
              // Clear current chat
              setMessages([])
              setCurrentSessionId(null)
              setThinkingSteps([])
              setQuestion('')
              
              // Switch to Chat tab if not already there
              setActive('Chat')
            }}
            style={{
              ...btn.secondary,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[2],
              padding: `${tokens.space[2]} ${tokens.space[3]}`,
              justifyContent: 'flex-start',
            }}>
            <Plus size={13} />
            New chat
          </button>
        </div>

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <div style={{ padding: `0 ${tokens.space[2]}`, marginBottom: tokens.space[2] }}>
            <div style={{
              fontSize: tokens.font.xs,
              color: tokens.text.tertiary,
              padding: `${tokens.space[2]} ${tokens.space[3]}`,
              fontWeight: tokens.weight.medium,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>Recent</div>

            {/* Search */}
            <input
              placeholder="Search chats..."
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                background: '#0d0f18',
                border: `0.5px solid ${tokens.border.subtle}`,
                borderRadius: tokens.radius.md,
                color: tokens.text.secondary,
                fontSize: tokens.font.xs,
                outline: 'none',
                marginBottom: tokens.space[2],
                boxSizing: 'border-box',
              }}
            />

            {sessions
              .filter(s => s.title.toLowerCase().includes(sessionSearch.toLowerCase()))
              .slice(0, 8)
              .map(session => (
                <div
                  key={session._id}
                  onClick={() => loadSession(session._id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: `${tokens.space[2]} ${tokens.space[3]}`,
                    borderRadius: tokens.radius.md,
                    marginBottom: '2px',
                    cursor: 'pointer',
                    background: currentSessionId === session._id
                      ? tokens.bg.overlay : 'transparent',
                    group: 'true',
                  }}
                  onMouseEnter={e => {
                    if (currentSessionId !== session._id)
                      e.currentTarget.style.background = tokens.bg.surface
                  }}
                  onMouseLeave={e => {
                    if (currentSessionId !== session._id)
                      e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{
                    fontSize: tokens.font.xs,
                    color: currentSessionId === session._id
                      ? tokens.text.primary : tokens.text.tertiary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {session.title}
                  </div>
                  <button
                    onClick={(e) => deleteSessionById(session._id, e)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: tokens.text.tertiary,
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '0 2px',
                      lineHeight: 1,
                      flexShrink: 0,
                      opacity: 0.5,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => e.target.style.opacity = '1'}
                    onMouseLeave={e => e.target.style.opacity = '0.5'}
                  >×</button>
                </div>
              ))}
          </div>
        )}

        {/* Nav */}
        <nav style={{ padding: `0 ${tokens.space[2]}`, flex: 1 }}>
          {NAV.map(({ icon: Icon, label }) => (
            <div
              key={label}
              onClick={() => {
                setActive(label)
                if (label === 'Dashboard') fetchDashboard()
                if (label === 'Insights' && insights.length === 0) fetchInsights()
                if (label === 'Workflows') fetchPendingActions()
                if (label === 'Sources') {
                  fetchSyncStatus()
                  fetchSchedulerStatus()
                }
                if (label === 'Timeline') fetchTimeline()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[2],
                padding: `${tokens.space[2]} ${tokens.space[3]}`,
                borderRadius: tokens.radius.md,
                marginBottom: '2px',
                cursor: 'pointer',
                color: active === label ? tokens.text.primary : tokens.text.tertiary,
                background: active === label ? tokens.bg.overlay : 'transparent',
                fontSize: tokens.font.base,
                fontWeight: active === label ? tokens.weight.medium : tokens.weight.normal,
                transition: 'all 0.1s',
              }}>
              <Icon size={14} strokeWidth={1.5} />
              {label}
            </div>
          ))}
        </nav>

        {/* Connected sources */}
        <div style={{
          padding: `${tokens.space[3]} ${tokens.space[4]}`,
          borderTop: `1px solid ${tokens.border.subtle}`,
        }}>
          <div style={{
            fontSize: tokens.font.xs,
            color: tokens.text.tertiary,
            marginBottom: tokens.space[2],
            fontWeight: tokens.weight.medium,
          }}>Connected</div>
          {[
            { label: 'Slack', channels: '2 channels' },
            { label: 'Notion', channels: '3 pages' },
          ].map(s => (
            <div key={s.label} style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[2],
              marginBottom: '3px',
              fontSize: tokens.font.xs,
              color: tokens.text.tertiary,
            }}>
              <span style={{
                width: '4px', height: '4px',
                borderRadius: '50%',
                background: tokens.accent.green,
                flexShrink: 0,
              }}/>
              {s.label} — {s.channels}
            </div>
          ))}
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
          padding: '12px 24px',
          borderBottom: `1px solid ${tokens.border.subtle}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: tokens.font.sm,
            color: tokens.text.tertiary,
            fontWeight: tokens.weight.medium,
            letterSpacing: '0.01em',
          }}>
            Company Brain
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[3] }}>
            {/* Alert bell */}
            {alerts.length > 0 && (
              <div
                onClick={() => setShowAlerts(prev => !prev)}
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: tokens.radius.md,
                  background: showAlerts ? tokens.accent.purpleSubtle : 'transparent',
                }}
              >
                <span style={{ fontSize: '14px' }}>🔔</span>
                <span style={{
                  position: 'absolute',
                  top: '0px',
                  right: '0px',
                  width: '14px',
                  height: '14px',
                  background: alerts.some(a => a.severity === 'critical') ? tokens.accent.red : tokens.accent.amber,
                  borderRadius: '50%',
                  fontSize: '9px',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '600',
                }}>{alerts.length}</span>
              </div>
            )}
            <div style={{
              fontSize: tokens.font.xs,
              color: tokens.accent.green,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}>
              <span style={{
                width: '5px', height: '5px',
                borderRadius: '50%',
                background: tokens.accent.green,
                display: 'inline-block',
              }}/>
              5 documents indexed
            </div>
          </div>
        </div>

        {/* Alerts dropdown */}
        {showAlerts && alerts.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '16px',
            width: '380px',
            background: tokens.bg.elevated,
            border: `1px solid ${tokens.border.default}`,
            borderRadius: tokens.radius.xl,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 200,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${tokens.border.subtle}`,
              fontSize: tokens.font.sm,
              color: tokens.text.secondary,
              fontWeight: tokens.weight.medium,
            }}>
              {alerts.length} active alert{alerts.length > 1 ? 's' : ''}
            </div>
            {alerts.map((alert, i) => (
              <div key={alert._id} style={{
                padding: '12px 16px',
                borderBottom: i < alerts.length - 1 ? `1px solid ${tokens.border.subtle}` : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px' }}>
                    {alert.severity === 'critical' ? '🔴' : '⚠️'}
                  </span>
                  <span style={{
                    fontSize: tokens.font.sm,
                    color: tokens.text.primary,
                    fontWeight: tokens.weight.medium,
                  }}>{alert.title}</span>
                </div>
                <div style={{
                  fontSize: tokens.font.xs,
                  color: tokens.text.secondary,
                  lineHeight: '1.5',
                }}>{alert.description}</div>
                <div style={{ display: 'flex', gap: tokens.space[2], marginTop: '2px' }}>
                  <button
                    onClick={() => {
                      setShowAlerts(false)
                      setActive('Chat')
                      const queries = {
                        'client_risk': 'Which clients are at risk right now and what are the recent issues?',
                        'overdue_actions': 'What action items are pending or overdue and who owns them?',
                        'tech_risk': 'What are the current technical risks and known system problems?'
                      }
                      askQuestion(queries[alert.alert_type] || `Tell me more about: ${alert.title}`)
                    }}
                    style={btn.primary}
                  >Investigate →</button>
                  <button
                    onClick={() => resolveAlert(alert._id)}
                    style={btn.secondary}
                  >Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Content Area */}
        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}>
          {/* Messages area */}
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
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '4px',
    }}>
      <div style={{
        fontSize: '15px',
        fontWeight: '600',
        color: '#e2e8f0',
        letterSpacing: '-0.3px',
      }}>Company insights</div>
      <button
        onClick={runScan}
        disabled={scanning}
        style={{
          padding: '5px 12px',
          background: 'transparent',
          border: '0.5px solid #1e2130',
          borderRadius: '5px',
          color: scanning ? '#4a5068' : '#a78bfa',
          fontSize: '11px',
          cursor: scanning ? 'not-allowed' : 'pointer',
        }}
      >
        {scanning ? 'Scanning...' : '⚡ Run anomaly scan'}
      </button>
    </div>
    {scanMessage && (
      <div style={{
        fontSize: '12px',
        color: scanMessage.startsWith('⚠️') ? '#f59e0b' : '#10b981',
        marginTop: '8px',
        textAlign: 'right',
      }}>
        {scanMessage}
      </div>
    )}
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
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <div style={{
              width: '6px', height: '6px',
              borderRadius: '50%',
              background: '#7c3aed',
              animation: 'blink 1s infinite',
              flexShrink: 0,
            }}/>
            <div style={{ fontSize: '12px', color: '#4a5068' }}>
              Analyzing company data...
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {insights
          .filter(insight => 
            insight.answer && 
            !insight.answer.toLowerCase().includes('scripts/ingest') &&
            !insight.answer.toLowerCase().includes('does not provide') &&
            !insight.answer.toLowerCase().includes('no information') &&
            insight.answer.length > 50
          )
          .map((insight, i) => (
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
              {syncStatus.some(s => isStale(s.synced_at)) && (
                <div style={{
                  padding: '10px 14px',
                  background: '#2a2010',
                  border: '0.5px solid #4a3a10',
                  borderRadius: '6px',
                  color: '#f59e0b',
                  fontSize: '12px',
                  marginBottom: '16px',
                }}>
                  Some sources haven't synced in 30+ days. Consider refreshing your tokens and re-syncing for up-to-date answers.
                </div>
              )}
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                marginBottom: '24px',
              }}>NeuralOS is reading from these sources in real time.</div>

              {/* Auto-sync status */}
              <div style={{
                padding: '12px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#e2e8f0',
                    marginBottom: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <span style={{
                      width: '6px', height: '6px',
                      borderRadius: '50%',
                      background: schedulerStatus?.running ? '#10b981' : '#4a5068',
                      display: 'inline-block',
                    }}/>
                    Auto-sync {schedulerStatus?.running ? 'active' : 'inactive'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#4a5068' }}>
                    {schedulerStatus?.next_sync
                      ? `Next sync: ${new Date(schedulerStatus.next_sync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Syncs every hour automatically'}
                  </div>
                </div>
                <button
                  onClick={triggerManualSync}
                  disabled={triggeringSyncAll}
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    border: '0.5px solid #1e2130',
                    borderRadius: '5px',
                    color: triggeringSyncAll ? '#4a5068' : '#a78bfa',
                    fontSize: '11px',
                    cursor: triggeringSyncAll ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {triggeringSyncAll ? 'Syncing...' : '↻ Sync now'}
                </button>
              </div>
              {syncAllMessage && (
                <div style={{
                  fontSize: '11px',
                  color: '#10b981',
                  marginBottom: '10px',
                  marginTop: '-10px',
                }}>
                  {syncAllMessage}
                </div>
              )}

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
                        credentials: 'include',
                        headers: {
                          'Content-Type': 'application/json'
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
                  disabled={slackSyncing}
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
                        credentials: 'include',
                        headers: {
                          'Content-Type': 'application/json'
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
                        credentials: 'include',
                        headers: {
                          'Content-Type': 'application/json'
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

              {/* Drive Connect */}
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
                }}>Sync Google Drive</div>
                <div style={{
                  fontSize: '12px',
                  color: '#4a5068',
                  marginBottom: '12px',
                }}>
                  Index your Google Docs and Sheets.
                </div>
                <button
                  onClick={async () => {
                    setDriveSyncing(true)
                    setDriveSyncMessage('')
                    try {
                      const res = await fetch('http://localhost:8000/api/sync/drive', {
                        method: 'POST',
                        credentials: 'include',
                      })
                      const data = await res.json()
                      setDriveSyncMessage(data.message)
                    } catch (err) {
                      setDriveSyncMessage('Failed to sync. Is the backend running?')
                    }
                    setDriveSyncing(false)
                  }}
                  style={{
                    padding: '7px 14px',
                    background: driveSyncing ? '#1e2130' : '#7c3aed',
                    border: 'none',
                    borderRadius: '5px',
                    color: driveSyncing ? '#4a5068' : '#ffffff',
                    fontSize: '12px',
                    cursor: driveSyncing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {driveSyncing ? 'Syncing...' : 'Sync Drive →'}
                </button>
                {driveSyncMessage && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#10b981' }}>
                    {driveSyncMessage}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {syncStatus.length === 0 ? (
                  <div style={{
                    fontSize: '12px',
                    color: '#2a2f45',
                    padding: '16px',
                    textAlign: 'center',
                    border: '0.5px solid #1e2130',
                    borderRadius: '8px',
                  }}>
                    No sync history yet. Sync your tools above.
                  </div>
                ) : (
                  syncStatus.map((src, i) => (
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
                        }}>{src.source?.charAt(0).toUpperCase() + src.source?.slice(1)} — synced</div>
                        <div style={{
                          fontSize: '12px',
                          color: '#4a5068',
                        }}>{src.items_synced} items · {src.chunks_indexed} chunks indexed</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '24px' }}>
                        <div style={{
                          fontSize: '11px',
                          color: '#10b981',
                          marginBottom: '2px',
                        }}>{src.chunks_indexed} chunks</div>
                        <div style={{
                          fontSize: '11px',
                          color: '#2a2f45',
                        }}>
                          {new Date(src.synced_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
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

              {/* Meeting Intelligence Button */}
              <div style={{ marginBottom: '16px' }}>
                <button
                  onClick={() => setShowMeetingModal(true)}
                  style={{
                    padding: '10px 16px',
                    background: '#0d0f18',
                    border: '0.5px solid #7c3aed',
                    borderRadius: '6px',
                    color: '#a78bfa',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  📋 Process Meeting Transcript
                </button>
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
                        step.type === 'approval_needed' ? '#4a3010' :
                        step.type === 'done' ? '#0a2a1a' :
                        '#1e2130'
                      }`,
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: step.type === 'error' ? '#ef4444' :
                             step.type === 'approval_needed' ? '#f59e0b' :
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

              {/* Meeting Intelligence Modal */}
              {showMeetingModal && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.85)',  // Darker overlay
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  padding: '20px',
                  backdropFilter: 'blur(4px)',  // Blur background
                }}>
                  <div style={{
                    background: '#0a0c14',
                    border: '1px solid #2a2f45',  // Stronger border
                    borderRadius: '12px',  // More rounded
                    maxWidth: '800px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    padding: '32px',  // More padding
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',  // Drop shadow
                  }}>
                    {/* Modal Header */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '24px',
                      paddingBottom: '20px',
                      borderBottom: '1px solid #1e2130',
                    }}>
                      <div>
                        <div style={{
                          fontSize: '18px',  // Larger
                          fontWeight: '600',
                          color: '#e2e8f0',
                          marginBottom: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}>
                          <span style={{ fontSize: '20px' }}>📋</span>
                          Process Meeting Transcript
                        </div>
                        <div style={{
                          fontSize: '13px',  // Larger
                          color: '#8b92a8',  // More readable
                          lineHeight: '1.5',
                        }}>
                          Extract decisions, action items, and open questions from any meeting
                        </div>
                      </div>
                      <button
                        onClick={closeMeetingModal}
                        style={{
                          background: '#0d0f18',
                          border: '1px solid #1e2130',
                          color: '#8b92a8',
                          fontSize: '18px',
                          cursor: 'pointer',
                          padding: '0',
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#1e2130';
                          e.currentTarget.style.color = '#e2e8f0';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#0d0f18';
                          e.currentTarget.style.color = '#8b92a8';
                        }}
                      >
                        ×
                      </button>
                    </div>

                    {/* Input Section - shown when no results yet */}
                    {!meetingResults && (
                      <div>
                        {/* File Upload */}
                        <div style={{ marginBottom: '24px' }}>
                          <label style={{
                            display: 'block',
                            fontSize: '13px',  // Larger
                            fontWeight: '500',
                            color: '#c4c9d4',  // More readable
                            marginBottom: '10px',
                          }}>
                            Upload transcript file
                          </label>
                          <div style={{
                            padding: '16px',
                            background: '#0d0f18',
                            border: '1px dashed #2a2f45',  // Dashed for drag-drop feel
                            borderRadius: '8px',
                            textAlign: 'center',
                          }}>
                            <input
                              type="file"
                              accept=".txt,.md"
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  setMeetingFile(file);
                                  setMeetingTranscript('');
                                }
                              }}
                              id="meeting-file-upload"
                              style={{ display: 'none' }}
                            />
                            <label
                              htmlFor="meeting-file-upload"
                              style={{
                                display: 'inline-block',
                                padding: '8px 16px',
                                background: '#1e2130',
                                border: '1px solid #2a2f45',
                                borderRadius: '6px',
                                color: '#c4c9d4',
                                fontSize: '13px',
                                cursor: 'pointer',
                                fontWeight: '500',
                              }}
                            >
                              Choose File
                            </label>
                            {meetingFile ? (
                              <div style={{
                                marginTop: '12px',
                                fontSize: '13px',
                                color: '#10b981',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                              }}>
                                ✓ {meetingFile.name}
                              </div>
                            ) : (
                              <div style={{
                                marginTop: '12px',
                                fontSize: '12px',
                                color: '#6b7280',
                              }}>
                                or drag and drop .txt, .md files
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Divider */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          margin: '24px 0',
                          gap: '12px',
                        }}>
                          <div style={{ flex: 1, height: '1px', background: '#1e2130' }} />
                          <div style={{
                            fontSize: '11px',
                            color: '#4a5068',
                            fontWeight: '500',
                            letterSpacing: '0.5px',
                          }}>
                            OR
                          </div>
                          <div style={{ flex: 1, height: '1px', background: '#1e2130' }} />
                        </div>

                        {/* Text Paste */}
                        <div style={{ marginBottom: '24px' }}>
                          <label style={{
                            display: 'block',
                            fontSize: '13px',
                            fontWeight: '500',
                            color: '#c4c9d4',
                            marginBottom: '10px',
                          }}>
                            Paste transcript text
                          </label>
                          <textarea
                            value={meetingTranscript}
                            onChange={(e) => {
                              setMeetingTranscript(e.target.value);
                              setMeetingFile(null);
                            }}
                            disabled={!!meetingFile}
                            placeholder="Paste your meeting transcript here...&#10;&#10;Example:&#10;John: We need to launch by Friday&#10;Sarah: I'll handle the marketing&#10;Mike: I'll do the technical setup"
                            style={{
                              width: '100%',
                              minHeight: '220px',
                              padding: '14px',
                              background: '#0d0f18',
                              border: '1px solid #1e2130',
                              borderRadius: '8px',
                              color: '#e2e8f0',
                              fontSize: '13px',
                              outline: 'none',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                              opacity: meetingFile ? 0.5 : 1,
                              lineHeight: '1.6',
                            }}
                          />
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: '8px',
                          }}>
                            <div style={{
                              fontSize: '12px',
                              color: meetingTranscript.length > 45000 ? '#f59e0b' : '#6b7280',
                            }}>
                              {meetingTranscript.length.toLocaleString()} / 50,000 characters
                            </div>
                            {meetingTranscript.length > 0 && (
                              <button
                                onClick={() => setMeetingTranscript('')}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#6b7280',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  padding: '2px 6px',
                                }}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Process Button */}
                        <button
                          onClick={processMeeting}
                          disabled={meetingProcessing || (!meetingTranscript.trim() && !meetingFile)}
                          style={{
                            width: '100%',
                            padding: '14px',
                            background: meetingProcessing ? '#1e2130' : '#7c3aed',
                            border: 'none',
                            borderRadius: '8px',
                            color: meetingProcessing ? '#4a5068' : '#ffffff',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: meetingProcessing ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            if (!meetingProcessing && (meetingTranscript.trim() || meetingFile)) {
                              e.currentTarget.style.background = '#6d28d9';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!meetingProcessing) {
                              e.currentTarget.style.background = '#7c3aed';
                            }
                          }}
                        >
                          {meetingProcessing ? (
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                              <span style={{
                                display: 'inline-block',
                                width: '14px',
                                height: '14px',
                                border: '2px solid #4a5068',
                                borderTopColor: '#a78bfa',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                              }} />
                              Processing...
                            </span>
                          ) : (
                            'Extract Information'
                          )}
                        </button>
                      </div>
                    )}

                    {/* Results Section */}
                    {meetingResults && (
                      <div>
                        {/* Metadata */}
                        {meetingResults.data.metadata?.title && (
                          <div style={{
                            padding: '16px',
                            background: '#0d0f18',
                            border: '1px solid #1e2130',
                            borderRadius: '8px',
                            marginBottom: '20px',
                          }}>
                            <div style={{
                              fontSize: '15px',
                              fontWeight: '600',
                              color: '#e2e8f0',
                              marginBottom: '6px',
                            }}>
                              {meetingResults.data.metadata.title}
                            </div>
                            {meetingResults.data.metadata.date && (
                              <div style={{ fontSize: '13px', color: '#8b92a8' }}>
                                📅 {meetingResults.data.metadata.date}
                              </div>
                            )}
                            {meetingResults.data.metadata.attendees?.length > 0 && (
                              <div style={{ fontSize: '13px', color: '#8b92a8', marginTop: '6px' }}>
                                👥 {meetingResults.data.metadata.attendees.join(', ')}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Stats */}
                        <div style={{
                          display: 'flex',
                          gap: '12px',
                          marginBottom: '24px',
                        }}>
                          <div style={{
                            flex: 1,
                            padding: '12px',
                            background: '#0d0f18',
                            border: '1px solid #1e2130',
                            borderRadius: '8px',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#7c3aed', lineHeight: '1' }}>
                              {meetingResults.stats.decisions}
                            </div>
                            <div style={{ fontSize: '11px', color: '#8b92a8', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Decisions
                            </div>
                          </div>
                          <div style={{
                            flex: 1,
                            padding: '12px',
                            background: '#0d0f18',
                            border: '1px solid #1e2130',
                            borderRadius: '8px',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981', lineHeight: '1' }}>
                              {meetingResults.stats.action_items}
                            </div>
                            <div style={{ fontSize: '11px', color: '#8b92a8', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Action Items
                            </div>
                          </div>
                          <div style={{
                            flex: 1,
                            padding: '12px',
                            background: '#0d0f18',
                            border: '1px solid #1e2130',
                            borderRadius: '8px',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b', lineHeight: '1' }}>
                              {meetingResults.stats.open_questions}
                            </div>
                            <div style={{ fontSize: '11px', color: '#8b92a8', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Questions
                            </div>
                          </div>
                        </div>

                        {/* Decisions */}
                        {meetingResults.data.decisions.length > 0 && (
                          <div style={{ marginBottom: '24px' }}>
                            <div style={{
                              fontSize: '13px',
                              fontWeight: '600',
                              color: '#a78bfa',
                              marginBottom: '10px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}>
                              ✓ Decisions
                            </div>
                            {meetingResults.data.decisions.map((d, i) => (
                              <div key={i} style={{
                                padding: '12px 14px',
                                background: '#0d0f18',
                                border: '1px solid #1e2130',
                                borderRadius: '8px',
                                marginBottom: '8px',
                                fontSize: '13px',
                                color: '#c4c9d4',
                                lineHeight: '1.6',
                              }}>
                                <div style={{ color: '#e2e8f0', marginBottom: '4px', fontWeight: '500' }}>
                                  {d.decision}
                                </div>
                                {d.context && (
                                  <div style={{ fontSize: '12px', color: '#8b92a8', marginTop: '6px' }}>
                                    {d.context}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Action Items (with checkboxes) */}
                        {meetingResults.data.action_items.length > 0 && (
                          <div style={{ marginBottom: '24px' }}>
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '10px',
                            }}>
                              <div style={{
                                fontSize: '13px',
                                fontWeight: '600',
                                color: '#10b981',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                              }}>
                                ✓ Action Items
                              </div>
                              <div style={{
                                fontSize: '12px',
                                color: '#8b92a8',
                              }}>
                                {selectedActionItems.size} of {meetingResults.data.action_items.length} selected
                              </div>
                            </div>
                            {meetingResults.data.action_items.map((item, i) => (
                              <div key={i} style={{
                                padding: '12px 14px',
                                background: '#0d0f18',
                                border: `1px solid ${selectedActionItems.has(i) ? '#10b981' : '#1e2130'}`,
                                borderRadius: '8px',
                                marginBottom: '8px',
                                fontSize: '13px',
                                color: '#c4c9d4',
                                lineHeight: '1.6',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                              }}
                              onClick={() => toggleActionItem(i)}
                              >
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedActionItems.has(i)}
                                    onChange={() => toggleActionItem(i)}
                                    style={{ marginTop: '3px', cursor: 'pointer' }}
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ color: '#e2e8f0', marginBottom: '6px', fontWeight: '500' }}>
                                      {item.task}
                                    </div>
                                    {(item.assignee || item.due_date) && (
                                      <div style={{ fontSize: '12px', color: '#8b92a8', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                        {item.assignee && (
                                          <span>👤 {item.assignee}</span>
                                        )}
                                        {item.due_date && (
                                          <span>📅 {item.due_date}</span>
                                        )}
                                      </div>
                                    )}
                                    {item.context && (
                                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px', fontStyle: 'italic' }}>
                                        {item.context}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Open Questions */}
                        {meetingResults.data.open_questions.length > 0 && (
                          <div style={{ marginBottom: '24px' }}>
                            <div style={{
                              fontSize: '13px',
                              fontWeight: '600',
                              color: '#f59e0b',
                              marginBottom: '10px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}>
                              ❓ Open Questions
                            </div>
                            {meetingResults.data.open_questions.map((q, i) => (
                              <div key={i} style={{
                                padding: '12px 14px',
                                background: '#0d0f18',
                                border: '1px solid #1e2130',
                                borderRadius: '8px',
                                marginBottom: '8px',
                                fontSize: '13px',
                                color: '#c4c9d4',
                                lineHeight: '1.6',
                              }}>
                                <div style={{ color: '#e2e8f0', marginBottom: '4px', fontWeight: '500' }}>
                                  {q.question}
                                </div>
                                {q.raised_by && (
                                  <div style={{ fontSize: '12px', color: '#8b92a8', marginTop: '6px' }}>
                                    Raised by: {q.raised_by}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{
                          display: 'flex',
                          gap: '10px',
                          marginTop: '24px',
                          paddingTop: '20px',
                          borderTop: '1px solid #1e2130',
                        }}>
                          <button
                            onClick={() => {
                              setMeetingResults(null);
                              setSelectedActionItems(new Set());
                            }}
                            style={{
                              flex: 1,
                              padding: '12px',
                              background: '#0d0f18',
                              border: '1px solid #1e2130',
                              borderRadius: '8px',
                              color: '#8b92a8',
                              fontSize: '13px',
                              fontWeight: '500',
                              cursor: 'pointer',
                            }}
                          >
                            Process Another
                          </button>
                          <button
                            onClick={createMeetingTasks}
                            disabled={creatingTasks || selectedActionItems.size === 0}
                            style={{
                              flex: 2,
                              padding: '12px',
                              background: (creatingTasks || selectedActionItems.size === 0) ? '#1e2130' : '#7c3aed',
                              border: 'none',
                              borderRadius: '8px',
                              color: (creatingTasks || selectedActionItems.size === 0) ? '#4a5068' : '#ffffff',
                              fontSize: '13px',
                              fontWeight: '600',
                              cursor: (creatingTasks || selectedActionItems.size === 0) ? 'not-allowed' : 'pointer',
                              transition: 'all 0.2s',
                            }}
                          >
                            {creatingTasks ? 'Creating...' : `Create ${selectedActionItems.size} Notion Task${selectedActionItems.size !== 1 ? 's' : ''}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : active === 'Dashboard' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {dashboardLoading || !dashboard ? (
                <div style={{ fontSize: '12px', color: '#4a5068' }}>Loading dashboard...</div>
              ) : (
                <>
                  {/* Header */}
                  <div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: '#e2e8f0',
                      letterSpacing: '-0.3px',
                      marginBottom: '4px',
                    }}>Company dashboard</div>
                    <div style={{ fontSize: '12px', color: '#4a5068' }}>
                      Real-time intelligence for {company}
                    </div>
                  </div>

                  {/* Top row — vitals */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '12px',
                  }}>
                    {[
                      {
                        label: 'Health score',
                        value: `${dashboard.health_score}/100`,
                        color: dashboard.health_score >= 80 ? '#10b981' :
                               dashboard.health_score >= 60 ? '#f59e0b' : '#ef4444',
                        sub: dashboard.health_score >= 80 ? 'Excellent' :
                             dashboard.health_score >= 60 ? 'Needs attention' : 'Critical'
                      },
                      {
                        label: 'Active alerts',
                        value: dashboard.alerts.total,
                        color: dashboard.alerts.critical > 0 ? '#ef4444' : '#f59e0b',
                        sub: `${dashboard.alerts.critical} critical`
                      },
                      {
                        label: 'Docs indexed',
                        value: dashboard.knowledge.total_chunks,
                        color: '#7c3aed',
                        sub: `${dashboard.knowledge.sources_count} sources`
                      },
                      {
                        label: 'Last sync',
                        value: dashboard.knowledge.last_sync
                          ? new Date(dashboard.knowledge.last_sync).toLocaleTimeString('en-IN', {
                              hour: '2-digit', minute: '2-digit'
                            })
                          : 'Never',
                        color: '#10b981',
                        sub: 'Auto-syncs hourly'
                      },
                    ].map((item, i) => (
                      <div key={i} style={{
                        padding: '16px',
                        background: '#0d0f18',
                        border: '0.5px solid #1e2130',
                        borderRadius: '8px',
                      }}>
                        <div style={{
                          fontSize: '11px',
                          color: '#4a5068',
                          marginBottom: '8px',
                          fontWeight: '500',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>{item.label}</div>
                        <div style={{
                          fontSize: '22px',
                          fontWeight: '600',
                          color: item.color,
                          marginBottom: '4px',
                          letterSpacing: '-0.5px',
                        }}>{item.value}</div>
                        <div style={{
                          fontSize: '11px',
                          color: '#4a5068',
                        }}>{item.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Second row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                  }}>
                    {/* Client health */}
                    <div style={{
                      padding: '16px',
                      background: '#0d0f18',
                      border: '0.5px solid #1e2130',
                      borderRadius: '8px',
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#e2e8f0',
                        marginBottom: '14px',
                      }}>Client health</div>
                      {dashboard.graph.clients.length === 0 ? (
                        <div style={{ fontSize: '11px', color: '#4a5068' }}>
                          No clients in graph. Run auto-extract.
                        </div>
                      ) : (
                        dashboard.graph.clients.map((client, i) => (
                          <div key={i} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '10px',
                          }}>
                            <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{client.name}</div>
                            <div style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: '500',
                              background: client.health === 'at_risk' ? 'rgba(239,68,68,0.1)' :
                                         client.health === 'onboarding' ? 'rgba(245,158,11,0.1)' :
                                         'rgba(16,185,129,0.1)',
                              color: client.health === 'at_risk' ? '#ef4444' :
                                     client.health === 'onboarding' ? '#f59e0b' : '#10b981',
                            }}>
                              {client.health?.replace('_', ' ')}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Knowledge graph stats */}
                    <div style={{
                      padding: '16px',
                      background: '#0d0f18',
                      border: '0.5px solid #1e2130',
                      borderRadius: '8px',
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#e2e8f0',
                        marginBottom: '14px',
                      }}>Knowledge graph</div>
                      {[
                        { label: 'Total entities', value: dashboard.graph.nodes, color: '#a78bfa' },
                        { label: 'Relationships', value: dashboard.graph.relationships, color: '#7c3aed' },
                        { label: 'Team members', value: dashboard.people_count, color: '#3b82f6' },
                        { label: 'Pending approvals', value: dashboard.pending_actions, color: '#f59e0b' },
                      ].map((item, i) => (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '10px',
                        }}>
                          <div style={{ fontSize: '12px', color: '#4a5068' }}>{item.label}</div>
                          <div style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: item.color,
                          }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Third row — knowledge growth */}
                  <div style={{
                    padding: '16px',
                    background: '#0d0f18',
                    border: '0.5px solid #1e2130',
                    borderRadius: '8px',
                  }}>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: '500',
                      color: '#e2e8f0',
                      marginBottom: '14px',
                    }}>Knowledge growth</div>
                    {dashboard.knowledge.growth.length === 0 ? (
                      <div style={{ fontSize: '11px', color: '#4a5068' }}>
                        No sync history yet.
                      </div>
                    ) : (
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '8px',
                        height: '80px',
                      }}>
                        {dashboard.knowledge.growth.map((item, i) => {
                          const maxChunks = Math.max(...dashboard.knowledge.growth.map(g => g.chunks))
                          const height = maxChunks > 0 ? (item.chunks / maxChunks) * 70 : 4
                          return (
                            <div key={i} style={{
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              <div style={{
                                fontSize: '9px',
                                color: '#4a5068',
                              }}>{item.chunks}</div>
                              <div style={{
                                width: '100%',
                                height: `${Math.max(height, 4)}px`,
                                background: '#7c3aed',
                                borderRadius: '2px',
                                opacity: 0.7,
                              }}/>
                              <div style={{
                                fontSize: '9px',
                                color: '#4a5068',
                                textAlign: 'center',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                width: '100%',
                              }}>{item.source?.slice(0, 6)}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Fourth row — feedback + sources */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                  }}>
                    {/* AI feedback */}
                    <div style={{
                      padding: '16px',
                      background: '#0d0f18',
                      border: '0.5px solid #1e2130',
                      borderRadius: '8px',
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#e2e8f0',
                        marginBottom: '14px',
                      }}>AI feedback loop</div>
                      <div style={{
                        display: 'flex',
                        gap: '16px',
                      }}>
                        <div>
                          <div style={{
                            fontSize: '22px',
                            fontWeight: '600',
                            color: '#10b981',
                            letterSpacing: '-0.5px',
                          }}>{dashboard.feedback.confirmed}</div>
                          <div style={{ fontSize: '11px', color: '#4a5068' }}>Confirmed</div>
                        </div>
                        <div>
                          <div style={{
                            fontSize: '22px',
                            fontWeight: '600',
                            color: '#f59e0b',
                            letterSpacing: '-0.5px',
                          }}>{dashboard.feedback.corrections}</div>
                          <div style={{ fontSize: '11px', color: '#4a5068' }}>Corrections</div>
                        </div>
                      </div>
                    </div>

                    {/* Connected sources */}
                    <div style={{
                      padding: '16px',
                      background: '#0d0f18',
                      border: '0.5px solid #1e2130',
                      borderRadius: '8px',
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#e2e8f0',
                        marginBottom: '14px',
                      }}>Connected sources</div>
                      {dashboard.knowledge.sources.map((src, i) => (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '8px',
                        }}>
                          <span style={{
                            width: '5px', height: '5px',
                            borderRadius: '50%',
                            background: '#10b981',
                            flexShrink: 0,
                          }}/>
                          <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                            {src.charAt(0).toUpperCase() + src.slice(1)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : active === 'Timeline' ? (
            <div>
              <div style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#e2e8f0',
                marginBottom: '4px',
                letterSpacing: '-0.3px',
              }}>Company timeline</div>
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                marginBottom: '24px',
              }}>
                Everything NeuralOS knows, in chronological order.
              </div>

              {timelineLoading ? (
                <div style={{ fontSize: '12px', color: '#2a2f45' }}>Loading timeline...</div>
              ) : timelineEvents.length === 0 ? (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: '#2a2f45',
                  fontSize: '12px',
                  border: '0.5px solid #1e2130',
                  borderRadius: '8px',
                }}>
                  No events yet. Sync your tools and run anomaly scans to populate the timeline.
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  {/* Vertical line */}
                  <div style={{
                    position: 'absolute',
                    left: '15px',
                    top: '8px',
                    bottom: '8px',
                    width: '1px',
                    background: '#1e2130',
                  }}/>

                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}>
                    {timelineEvents.map((event, i) => (
                      <div
                        key={event.id}
                        style={{
                          display: 'flex',
                          gap: '16px',
                          alignItems: 'flex-start',
                          padding: '10px 0',
                          cursor: event.type === 'sync' ? 'default' : 'pointer',
                        }}
                        onClick={() => {
                          if (event.type === 'sync') return
                          setActive('Chat')
                          askQuestion(`Tell me about this event: ${event.title}. ${event.description}`)
                        }}
                      >
                        {/* Dot */}
                        <div style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: event.color,
                          flexShrink: 0,
                          marginTop: '4px',
                          zIndex: 1,
                          boxShadow: `0 0 6px ${event.color}60`,
                          marginLeft: '11px',
                        }}/>

                        {/* Content */}
                        <div style={{
                          flex: 1,
                          padding: '10px 14px',
                          background: '#0d0f18',
                          border: '0.5px solid #1e2130',
                          borderRadius: '6px',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = event.color + '60'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = '#1e2130'}
                        >
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '4px',
                          }}>
                            <div style={{
                              fontSize: '13px',
                              fontWeight: '500',
                              color: '#e2e8f0',
                            }}>{event.title}</div>
                            <div style={{
                              fontSize: '10px',
                              color: '#4a5068',
                              flexShrink: 0,
                              marginLeft: '12px',
                            }}>
                              {new Date(event.timestamp).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                          <div style={{
                            fontSize: '11px',
                            color: '#4a5068',
                            lineHeight: '1.5',
                          }}>{formatEventDescription(event)}</div>
                          <div style={{
                            marginTop: '6px',
                            fontSize: '10px',
                            color: event.color,
                            opacity: 0.7,
                          }}>
                            {event.type.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : active === 'Graph' ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}>
                <div>
                  <div style={{
                    fontSize: '15px',
                    fontWeight: '600',
                    color: '#e2e8f0',
                    letterSpacing: '-0.3px',
                  }}>Knowledge graph</div>
                  <div style={{ fontSize: '12px', color: '#4a5068', marginTop: '2px' }}>
                    Auto-extracted from your company data. Click any node to investigate.
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                  <button
                    onClick={extractGraph}
                    disabled={extracting}
                    style={{
                      padding: '6px 14px',
                      background: extracting ? '#1e2130' : 'transparent',
                      border: '0.5px solid #7c3aed',
                      borderRadius: '5px',
                      color: extracting ? '#4a5068' : '#a78bfa',
                      fontSize: '11px',
                      cursor: extracting ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {extracting ? 'Extracting...' : '⚡ Auto-extract from data'}
                  </button>
                  {extractMessage && (
                    <div style={{
                      fontSize: '11px',
                      color: '#10b981',
                      textAlign: 'right',
                      maxWidth: '200px',
                    }}>{extractMessage}</div>
                  )}
                </div>
              </div>
                {selectedNode && (
                  <div style={{
                    padding: '8px 14px',
                    background: '#0d0f18',
                    border: '0.5px solid #1e2130',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}>
                    <span style={{ color: '#4a5068' }}>Selected:</span>
                    <strong>{selectedNode.id}</strong>
                    <span style={{
                      padding: '2px 6px',
                      background: selectedNode.color + '20',
                      border: `0.5px solid ${selectedNode.color}40`,
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: selectedNode.color,
                    }}>{selectedNode.group}</span>
                    <button
                      onClick={() => {
                        setActive('Chat')
                        askQuestion(`Tell me everything about ${selectedNode.id} — their role, relationships, and recent activity.`)
                      }}
                      style={{
                        padding: '4px 10px',
                        background: '#7c3aed',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >Ask NeuralOS →</button>
                  </div>
                )}

              {/* Legend */}
              <div style={{
                display: 'flex',
                gap: '16px',
                fontSize: '11px',
                color: '#4a5068',
              }}>
                {[
                  { color: '#a78bfa', label: 'People' },
                  { color: '#ef4444', label: 'At-risk client' },
                  { color: '#10b981', label: 'Healthy client' },
                  { color: '#f59e0b', label: 'Onboarding' },
                  { color: '#f97316', label: 'Incidents' },
                  { color: '#3b82f6', label: 'Projects' },
                ].map(item => (
                  <div key={item.label} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}>
                    <span style={{
                      width: '8px', height: '8px',
                      borderRadius: '50%',
                      background: item.color,
                      flexShrink: 0,
                    }}/>
                    {item.label}
                  </div>
                ))}
              </div>

              {/* Graph */}
              <div style={{
                flex: 1,
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                overflow: 'hidden',
                minHeight: '400px',
              }}>
                <KnowledgeGraph onNodeClick={(node) => setSelectedNode({...node})} />
              </div>
            </div>
          ) : active === 'Workflows' ? (
            <div>
              <div style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#e2e8f0',
                marginBottom: '4px',
                letterSpacing: '-0.3px',
              }}>Pending approvals</div>
              <div style={{
                fontSize: '12px',
                color: '#4a5068',
                marginBottom: '24px',
              }}>
                Review and approve actions NeuralOS wants to take.
              </div>

              {pendingActionsLoading ? (
                <div style={{ fontSize: '12px', color: '#2a2f45' }}>
                  Loading pending actions...
                </div>
              ) : pendingActions.length === 0 ? (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: '#2a2f45',
                  fontSize: '12px',
                  border: '0.5px solid #1e2130',
                  borderRadius: '8px',
                }}>
                  No pending actions. Run the agent to generate some.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {pendingActions.map((action, i) => (
                    <div key={action._id} style={{
                      padding: '16px',
                      background: '#0d0f18',
                      border: '0.5px solid #1e2130',
                      borderRadius: '8px',
                    }}>
                      <div style={{
                        fontSize: '11px',
                        color: '#f59e0b',
                        fontWeight: '500',
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {action.action_type === 'SEND_SLACK' ? 'Send Slack message' : 'Create Notion task'}
                      </div>

                      {action.action_type === 'SEND_SLACK' ? (
                        <div style={{
                          fontSize: '13px',
                          color: '#c4c9d4',
                          lineHeight: '1.6',
                          marginBottom: '12px',
                          whiteSpace: 'pre-wrap',
                        }}>
                          <strong style={{ color: '#e2e8f0' }}>Channel:</strong> #{action.details.channel}
                          <br/>
                          <strong style={{ color: '#e2e8f0' }}>Message:</strong> {action.details.message}
                        </div>
                      ) : (
                        <div style={{
                          fontSize: '13px',
                          color: '#c4c9d4',
                          lineHeight: '1.6',
                          marginBottom: '12px',
                        }}>
                          <strong style={{ color: '#e2e8f0' }}>Title:</strong> {action.details.title}
                          <br/>
                          <strong style={{ color: '#e2e8f0' }}>Assignee:</strong> {action.details.assignee || 'Unassigned'}
                        </div>
                      )}

                      {action.resolved ? (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 12px',
                          background: action.resolved === 'approve' ? '#0a2a1a' :
                                      action.resolved === 'error' ? '#2a1010' : '#1a1a1a',
                          border: `0.5px solid ${
                            action.resolved === 'approve' ? '#10b981' :
                            action.resolved === 'error' ? '#ef4444' : '#4a5068'
                          }`,
                          borderRadius: '5px',
                          fontSize: '12px',
                          color: action.resolved === 'approve' ? '#10b981' :
                                 action.resolved === 'error' ? '#ef4444' : '#9ca3af',
                        }}>
                          {action.resolved === 'approve' ? '✓' : action.resolved === 'error' ? '✕' : '–'}
                          {' '}{action.resultMessage}
                          {action.url && (
                            <a 
                              href={action.url} 
                              target="_blank" 
                              rel="noreferrer"
                              style={{ color: '#7c3aed', marginLeft: '8px', fontSize: '11px' }}
                            >
                              Open →
                            </a>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => handleActionDecision(action._id, 'approve')}
                            disabled={action.processing}
                            style={{
                              padding: '6px 14px',
                              background: action.processing ? '#1e2130' : '#10b981',
                              border: 'none',
                              borderRadius: '5px',
                              color: action.processing ? '#4a5068' : '#ffffff',
                              fontSize: '12px',
                              cursor: action.processing ? 'not-allowed' : 'pointer',
                            }}
                          >{action.processing ? 'Sending...' : 'Approve'}</button>
                          <button
                            onClick={() => handleActionDecision(action._id, 'reject')}
                            disabled={action.processing}
                            style={{
                              padding: '6px 14px',
                              background: 'transparent',
                              border: '0.5px solid #3a1010',
                              borderRadius: '5px',
                              color: action.processing ? '#4a5068' : '#ef4444',
                              fontSize: '12px',
                              cursor: action.processing ? 'not-allowed' : 'pointer',
                            }}
                          >Reject</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
                <div style={{ fontSize: '12px', color: '#4a5068', marginBottom: '4px' }}>Company</div>
                <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{company}</div>
              </div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '10px',
              }}>
                <div style={{ fontSize: '12px', color: '#4a5068', marginBottom: '4px' }}>AI Model</div>
                <div style={{ fontSize: '13px', color: '#e2e8f0' }}>Gemini 2.5 Flash</div>
              </div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '10px',
              }}>
                <div style={{ fontSize: '12px', color: '#4a5068', marginBottom: '4px' }}>Vector Database</div>
                <div style={{ fontSize: '13px', color: '#e2e8f0' }}>
                  Pinecone — {localStorage.getItem('neuralos_pinecone_index') || 'neuralos'} index
                </div>
              </div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
                marginBottom: '10px',
              }}>
                <div style={{ fontSize: '12px', color: '#4a5068', marginBottom: '4px' }}>Knowledge graph</div>
                <div style={{ fontSize: '13px', color: '#e2e8f0' }}>
                  MongoDB Atlas — {syncStatus.length} sync events recorded
                </div>
              </div>

              <div style={{
                padding: '14px 16px',
                background: '#0d0f18',
                border: '0.5px solid #1e2130',
                borderRadius: '8px',
              }}>
                <div style={{ fontSize: '12px', color: '#4a5068', marginBottom: '4px' }}>Connected sources</div>
                <div style={{ fontSize: '13px', color: '#e2e8f0' }}>
                  {[...new Set(syncStatus.map(s => s.source))].join(', ') || 'None synced yet'}
                </div>
              </div>

              <div style={{
                marginTop: '24px',
                paddingTop: '16px',
                borderTop: '0.5px solid #1e2130',
              }}>
                <button
                  onClick={handleLogout}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '0.5px solid #3a1010',
                    borderRadius: '6px',
                    color: '#ef4444',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
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
                      {msg.image && (
                        <img 
                          src={msg.image} 
                          alt="User upload"
                          style={{ maxWidth: '200px', borderRadius: '6px', marginBottom: '8px', display: 'block' }} 
                        />
                      )}
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

          {/* Thinking panel */}
          {showThinking && thinkingSteps.length > 0 && (
            <div style={{
              width: '260px',
              borderLeft: '0.5px solid #1e2130',
              padding: '16px',
              overflowY: 'auto',
              flexShrink: 0,
              background: '#080b11',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}>
                <div style={{
                  fontSize: '11px',
                  color: '#4a5068',
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>Reasoning trace</div>
                <button
                  onClick={() => setShowThinking(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#4a5068',
                    cursor: 'pointer',
                    fontSize: '16px',
                    lineHeight: 1,
                  }}
                >×</button>
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}>
                {thinkingSteps.map((step, i) => (
                  <div key={i} style={{
                    padding: '10px 12px',
                    background: '#0d0f18',
                    border: '0.5px solid #1e2130',
                    borderRadius: '6px',
                  }}>
                    <div style={{
                      fontSize: '11px',
                      color: step.step === 'searching' ? '#7c3aed' :
                             step.step === 'retrieved' ? '#10b981' :
                             step.step === 'quality' ? (
                               step.quality?.quality === 'high' ? '#10b981' :
                               step.quality?.quality === 'medium' ? '#f59e0b' : '#ef4444'
                             ) :
                             step.step === 'reasoning' ? '#f59e0b' :
                             step.step === 'done' ? '#10b981' : '#4a5068',
                      fontWeight: '500',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}>
                      {step.step === 'searching' ? '🔍' :
                       step.step === 'retrieved' ? '📄' :
                       step.step === 'quality' ? (
                         step.quality?.quality === 'high' ? '✓' :
                         step.quality?.quality === 'medium' ? '~' : '!'
                       ) :
                       step.step === 'reasoning' ? '🧠' :
                       step.step === 'done' ? '✓' : '✓'}
                      {step.step.charAt(0).toUpperCase() + step.step.slice(1)}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#6b7280',
                      lineHeight: '1.5',
                    }}>{step.content}</div>
                    {step.step === 'quality' && step.quality && (
                      <div style={{
                        marginTop: '4px',
                        fontSize: '10px',
                        color: '#4a5068',
                        display: 'flex',
                        gap: '8px',
                      }}>
                        <span>Max: {Math.round(step.quality.max_score * 100)}%</span>
                        <span>Avg: {Math.round(step.quality.avg_score * 100)}%</span>
                      </div>
                    )}

                    {step.sources && step.sources.length > 0 && (
                      <div style={{
                        marginTop: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}>
                        {step.sources.map((s, j) => (
                          <div key={j} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '10px',
                          }}>
                            <span style={{
                              color: '#4a5068',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '160px',
                            }}>{s.source}</span>
                            <span style={{
                              color: s.score > 75 ? '#10b981' :
                                     s.score > 60 ? '#f59e0b' : '#4a5068',
                              fontWeight: '500',
                              flexShrink: 0,
                            }}>{s.score}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{
          padding: '16px 24px 20px',
          borderTop: '0.5px solid #13151f',
        }}>
          {/* Image preview */}
          {imagePreview && (
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: '8px' }}>
                  <img 
                      src={imagePreview} 
                      alt="Upload preview" 
                      style={{ maxHeight: '100px', borderRadius: '6px', border: '1px solid #1e2130' }} 
                  />
                  <button
                      onClick={() => {
                          setChatImage(null);
                          setImagePreview(null);
                      }}
                      style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          background: '#0a0c14',
                          border: '1px solid #1e2130',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          cursor: 'pointer',
                          color: '#e2e8f0'
                      }}
                  >×</button>
              </div>
          )}

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#0d0f18',
            border: '0.5px solid #1e2130',
            borderRadius: '8px',
            padding: '10px 12px',
          }}>
            <button
              onClick={() => setResearchMode(prev => prev === 'quick' ? 'deep' : 'quick')}
              title="Toggle Deep Research Mode"
              style={{
                padding: '4px 8px',
                background: researchMode === 'deep' ? '#7c3aed25' : 'transparent',
                border: researchMode === 'deep' ? '1px solid #7c3aed' : '0.5px solid #1e2130',
                borderRadius: '5px',
                color: researchMode === 'deep' ? '#a78bfa' : '#6b7280',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              🔬 {researchMode === 'deep' ? 'Deep Research ON' : 'Deep Research'}
            </button>

            {/* Image upload button */}
            <label style={{
                padding: '4px 8px',
                background: 'transparent',
                border: '0.5px solid #1e2130',
                borderRadius: '5px',
                cursor: 'pointer',
                color: '#6b7280',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
            }}>
                📎
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                />
            </label>

            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && (chatImage ? sendWithImage() : askQuestion())}
              placeholder={chatImage ? "Ask about this image..." : "Ask anything about your company..."}
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
              onClick={chatImage ? sendWithImage : askQuestion}
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