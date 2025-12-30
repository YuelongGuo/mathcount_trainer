export type AuthStatus =
  | { status: 'signed_out' }
  | { status: 'signed_in'; uid: string; email: string | null }

export type AuthStatusResponse = AuthStatus & { queuedCount: number }

export type ProblemLogPayload = {
  url: string
  pageTitle?: string
  problemText?: string
  problemId?: string
  userAnswer?: string
  correctAnswer?: string
  resultText?: string
  capturedAt: string
}

export type LogProblemResponse =
  | { ok: true; queued: boolean; queuedCount: number }
  | { ok: false; error: string; queuedCount: number }

export type AuthResponse =
  | { ok: true; status: AuthStatusResponse }
  | { ok: false; error: string }

export type BackgroundMessage =
  | { type: 'AUTH_STATUS' }
  | { type: 'LOG_WRONG_PROBLEM'; payload: ProblemLogPayload }
