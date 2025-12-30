import type { BackgroundMessage, ProblemLogPayload } from './messages'

const PLAY_BUTTON_SELECTOR = '.mc-btn.mc-blue-btn.mc-thin-btn.mc-home-btn'
const SUBMIT_BUTTON_SELECTOR = '.mc-btn.mc-blue-btn.mc-soln-submit-btn'
const PROBLEM_TEXT_SELECTOR = '.mc-prob-text'
const RESULT_ICON_SELECTOR = 'span.aops-font'

const MAX_TEXT_LENGTH = 2000
const RESULT_TIMEOUT_MS = 12000
const RESULT_SCAN_DELAY_MS = 250
const MAX_RECENT_LOGS = 50

type ResultState = 'correct' | 'wrong'

type PendingSubmission = {
  problemText?: string
  problemId?: string
  userAnswer?: string
  submittedAt: string
}

let pendingSubmission: PendingSubmission | null = null
let scanTimeout: number | undefined
let pendingTimeout: number | undefined

const recentSignatures = new Set<string>()
const observedDocuments = new WeakSet<Document>()
const trackedIframes = new WeakSet<HTMLIFrameElement>()

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim()

const safeAccessFrameDocument = (frame: HTMLIFrameElement): Document | null => {
  try {
    return frame.contentDocument
  } catch {
    return null
  }
}

const getAllCandidateDocuments = (): Document[] => {
  const docs = new Set<Document>([document])
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))
  for (const frame of frames) {
    const frameDoc = safeAccessFrameDocument(frame)
    if (frameDoc) {
      docs.add(frameDoc)
    }
  }
  return Array.from(docs)
}

const getProblemDocument = (): Document | null => {
  if (document.querySelector(PROBLEM_TEXT_SELECTOR)) {
    return document
  }

  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))
  for (const frame of frames) {
    const frameDoc = safeAccessFrameDocument(frame)
    if (frameDoc?.querySelector(PROBLEM_TEXT_SELECTOR)) {
      return frameDoc
    }
  }

  return null
}

const getProblemText = (doc?: Document | null): string | undefined => {
  if (!doc) {
    return undefined
  }
  const element = doc.querySelector<HTMLElement>(PROBLEM_TEXT_SELECTOR)
  const text = element?.textContent ? normalizeText(element.textContent) : ''
  if (text.length > 0) {
    return text.slice(0, MAX_TEXT_LENGTH)
  }
  return undefined
}

const getProblemId = (doc?: Document | null): string | undefined => {
  const url = new URL(window.location.href)
  return (
    url.searchParams.get('problem_id') ??
    url.searchParams.get('problem') ??
    doc?.querySelector<HTMLElement>('[data-problem-id]')?.dataset.problemId
  )
}

const getUserAnswer = (doc?: Document | null): string | undefined => {
  if (!doc) {
    return undefined
  }
  const inputs = Array.from(
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="number"], textarea',
    ),
  )
  for (const input of inputs) {
    const value = input.value?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

const getResultState = (): ResultState | null => {
  const docs = getAllCandidateDocuments()
  for (const doc of docs) {
    const spans = Array.from(doc.querySelectorAll<HTMLElement>(RESULT_ICON_SELECTOR))
    for (const span of spans) {
      const value = span.textContent?.trim()
      if (value === 'J') {
        return 'wrong'
      }
      if (value === 'q') {
        return 'correct'
      }
    }
  }
  return null
}

const buildPayload = (pending: PendingSubmission): ProblemLogPayload => {
  const problemDoc = getProblemDocument()
  return {
    url: window.location.href,
    pageTitle: document.title,
    problemText: pending.problemText ?? getProblemText(problemDoc),
    problemId: pending.problemId ?? getProblemId(problemDoc),
    userAnswer: pending.userAnswer ?? getUserAnswer(problemDoc),
    correctAnswer: undefined,
    resultText: 'incorrect (J)',
    capturedAt: pending.submittedAt,
  }
}

const shouldLog = (payload: ProblemLogPayload) => {
  const signature = JSON.stringify({
    url: payload.url,
    problemText: payload.problemText,
    userAnswer: payload.userAnswer,
    resultText: payload.resultText,
  })

  if (recentSignatures.has(signature)) {
    return false
  }

  recentSignatures.add(signature)
  if (recentSignatures.size > MAX_RECENT_LOGS) {
    const first = recentSignatures.values().next().value
    if (first) {
      recentSignatures.delete(first)
    }
  }

  return true
}

const sendLog = (payload: ProblemLogPayload) => {
  const message: BackgroundMessage = {
    type: 'LOG_WRONG_PROBLEM',
    payload,
  }

  chrome.runtime.sendMessage(message, () => {
    const error = chrome.runtime.lastError
    if (error) {
      console.error('Failed to send log to background', error.message)
    }
  })
}

const clearPending = () => {
  pendingSubmission = null
  if (pendingTimeout) {
    window.clearTimeout(pendingTimeout)
    pendingTimeout = undefined
  }
}

const scheduleResultScan = () => {
  if (!pendingSubmission || scanTimeout) {
    return
  }
  scanTimeout = window.setTimeout(() => {
    scanTimeout = undefined
    checkForResult()
  }, RESULT_SCAN_DELAY_MS)
}

const startPendingTimeout = () => {
  if (pendingTimeout) {
    window.clearTimeout(pendingTimeout)
  }
  pendingTimeout = window.setTimeout(() => {
    clearPending()
  }, RESULT_TIMEOUT_MS)
}

const checkForResult = () => {
  if (!pendingSubmission) {
    return
  }

  const result = getResultState()
  if (!result) {
    return
  }

  const pending = pendingSubmission
  clearPending()

  if (result === 'wrong') {
    const payload = buildPayload(pending)
    if (shouldLog(payload)) {
      sendLog(payload)
    }
  }
}

const handleSubmitClick = () => {
  const problemDoc = getProblemDocument()
  pendingSubmission = {
    problemText: getProblemText(problemDoc),
    problemId: getProblemId(problemDoc),
    userAnswer: getUserAnswer(problemDoc),
    submittedAt: new Date().toISOString(),
  }
  startPendingTimeout()
  scheduleResultScan()
}

const observeDocument = (doc: Document) => {
  if (observedDocuments.has(doc)) {
    return
  }
  const root = doc.documentElement
  if (!root) {
    return
  }

  const observer = new MutationObserver(() => {
    scheduleResultScan()
    if (doc === document) {
      trackIframes()
    }
  })

  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  observedDocuments.add(doc)
}

const trackIframes = () => {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))
  for (const frame of frames) {
    if (trackedIframes.has(frame)) {
      continue
    }
    trackedIframes.add(frame)

    const tryObserve = () => {
      const frameDoc = safeAccessFrameDocument(frame)
      if (frameDoc) {
        observeDocument(frameDoc)
      }
    }

    tryObserve()
    frame.addEventListener('load', tryObserve)
  }
}

if (window.location.href.includes('mathcounts_trainer')) {
  observeDocument(document)
  trackIframes()

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null
    if (!target) {
      return
    }

    if (target.closest(SUBMIT_BUTTON_SELECTOR)) {
      handleSubmitClick()
      return
    }

    if (target.closest(PLAY_BUTTON_SELECTOR)) {
      trackIframes()
    }
  })
}
