import { onAuthStateChanged, type User } from 'firebase/auth'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase'
import type {
  AuthResponse,
  AuthStatus,
  AuthStatusResponse,
  BackgroundMessage,
  LogProblemResponse,
  ProblemLogPayload,
} from './messages'

const AUTH_STATE_KEY = 'authState'
const QUEUED_LOGS_KEY = 'queuedProblemLogs'
const MAX_QUEUE_SIZE = 200

const storageGet = async <T,>(key: string): Promise<T | undefined> =>
  new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] as T | undefined)
    })
  })

const storageSet = async (value: Record<string, unknown>): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve())
  })

const normalizeAuthStatus = (user: User | null): AuthStatus =>
  user
    ? { status: 'signed_in', uid: user.uid, email: user.email ?? null }
    : { status: 'signed_out' }

const loadQueue = async (): Promise<ProblemLogPayload[]> =>
  (await storageGet<ProblemLogPayload[]>(QUEUED_LOGS_KEY)) ?? []

const saveQueue = async (queue: ProblemLogPayload[]): Promise<void> =>
  storageSet({ [QUEUED_LOGS_KEY]: queue })

const enqueueProblemLog = async (payload: ProblemLogPayload): Promise<number> => {
  const queue = await loadQueue()
  queue.push(payload)
  while (queue.length > MAX_QUEUE_SIZE) {
    queue.shift()
  }
  await saveQueue(queue)
  return queue.length
}

const getAuthStatus = async (): Promise<AuthStatusResponse> => {
  const stored =
    (await storageGet<AuthStatus>(AUTH_STATE_KEY)) ??
    normalizeAuthStatus(auth.currentUser)
  const queuedCount = (await loadQueue()).length
  return { ...stored, queuedCount }
}

const writeProblemLog = async (payload: ProblemLogPayload, user: User) => {
  await addDoc(collection(db, 'users', user.uid, 'wrongProblems'), {
    ...payload,
    source: 'aops-mathcounts-trainer',
    extensionVersion: chrome.runtime.getManifest().version,
    createdAt: serverTimestamp(),
  })
}

let flushInFlight: Promise<void> | null = null

const flushQueuedLogs = async (user: User) => {
  if (flushInFlight) {
    await flushInFlight
    return
  }

  flushInFlight = (async () => {
    const queue = await loadQueue()
    if (queue.length === 0) {
      return
    }

    const remaining: ProblemLogPayload[] = []
    for (const payload of queue) {
      try {
        await writeProblemLog(payload, user)
      } catch (error) {
        console.error('Failed to flush queued log', error)
        remaining.push(payload)
      }
    }

    await saveQueue(remaining)
  })()

  try {
    await flushInFlight
  } finally {
    flushInFlight = null
  }
}

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unexpected error'
}

onAuthStateChanged(auth, async (user) => {
  const status = normalizeAuthStatus(user)
  await storageSet({ [AUTH_STATE_KEY]: status })
  if (user) {
    await flushQueuedLogs(user)
  }
})

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, _sender, sendResponse) => {
    if (message.type === 'AUTH_STATUS') {
      getAuthStatus()
        .then((status) => sendResponse({ ok: true, status } satisfies AuthResponse))
        .catch((error) =>
          sendResponse({ ok: false, error: formatError(error) } satisfies AuthResponse),
        )
      return true
    }

    if (message.type === 'LOG_WRONG_PROBLEM') {
      const payload = message.payload
      const currentUser = auth.currentUser
      if (!currentUser) {
        enqueueProblemLog(payload)
          .then((queuedCount) =>
            sendResponse({ ok: true, queued: true, queuedCount } satisfies LogProblemResponse),
          )
          .catch((error) =>
            sendResponse({
              ok: false,
              error: formatError(error),
              queuedCount: 0,
            } satisfies LogProblemResponse),
          )
        return true
      }

      writeProblemLog(payload, currentUser)
        .then(async () => {
          const queuedCount = (await loadQueue()).length
          sendResponse({ ok: true, queued: false, queuedCount } satisfies LogProblemResponse)
        })
        .catch(async (error) => {
          const queuedCount = await enqueueProblemLog(payload)
          sendResponse({
            ok: false,
            error: formatError(error),
            queuedCount,
          } satisfies LogProblemResponse)
        })

      return true
    }

    return false
  },
)
