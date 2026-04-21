import type { Context } from 'hono'
import type { UserDocument } from '../models/User'
import type { ContestState } from '../policies/contest'
import type { CourseState } from '../policies/course'
import type { DiscussionState } from '../policies/discussion'
import type { PostState } from '../policies/post'
import type { ProblemState } from '../policies/problem'

export interface SessionData {
  userId?: string
  sessionId?: string
  _modified?: boolean
}

export interface AuditLog {
  info: (message: string) => void
  error: (message: string, error?: any) => void
  warn: (message: string) => void
}

export type HonoEnv = {
  Variables: {
    clientIp: string
    requestId: string
    authnChecked?: boolean
    profile?: UserDocument
    sessionId?: string
    session: SessionData
    auditLog: AuditLog

    contest?: ContestState
    course?: CourseState
    discussion?: DiscussionState
    post?: PostState
    problem?: ProblemState
    user?: UserDocument
  }
}

export type AppContext = Context<HonoEnv>
