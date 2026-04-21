import type { MiddlewareHandler } from 'hono'
import type { AppContext, HonoEnv } from '../types/koa'
import type { UserDocument } from '../models/User'
import { HTTPException } from 'hono/http-exception'
import User from '../models/User'
import sessionService from '../services/session'
import { ERR_LOGIN_REQUIRE, ERR_PERM_DENIED } from '../utils/constants'

export async function checkSession (c: AppContext): Promise<UserDocument | undefined> {
  if (c.get('authnChecked')) {
    return c.get('profile')
  }
  c.set('authnChecked', true)

  const session = c.get('session')
  const { userId, sessionId } = session
  if (!userId || !sessionId) {
    return
  }

  const sessionInfo = await sessionService.accessSession(userId, sessionId)
  if (!sessionInfo) {
    c.get('auditLog').warn(`Session ${sessionId} not found in Redis, clearing cookie`)
    delete session.userId
    delete session.sessionId
    session._modified = true
    return
  }

  const user = await User.findById(userId)
  if (!user) {
    c.get('auditLog').warn(`User ${userId} not found, revoking <Session:${sessionId}>`)
    await sessionService.revokeSession(userId, sessionId)
    delete session.userId
    delete session.sessionId
    session._modified = true
    return
  }
  if (user.isBanned) {
    c.get('auditLog').warn(`<User:${user.uid}> is banned, revoking <Session:${sessionId}>`)
    await sessionService.revokeSession(userId, sessionId)
    delete session.userId
    delete session.sessionId
    session._modified = true
    return
  }

  if ((user.lastVisitedAt?.getTime() ?? 0) < Date.now() - 5 * 1000) {
    user.lastRequestId = c.get('requestId')
    user.lastVisitedAt = new Date()
    await user.save()
  }

  c.set('profile', user)
  c.set('sessionId', sessionId)
  return user
}

export async function loadProfile (c: AppContext): Promise<UserDocument> {
  const profile = await checkSession(c)
  if (!profile) {
    throw new HTTPException(ERR_LOGIN_REQUIRE[0] as number, { message: ERR_LOGIN_REQUIRE[1] })
  }
  return profile
}

export const loginRequire: MiddlewareHandler<HonoEnv> = async (c, next) => {
  await loadProfile(c)
  await next()
}

export const adminRequire: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const profile = await loadProfile(c)
  if (!profile.isAdmin) {
    throw new HTTPException(ERR_PERM_DENIED[0] as number, { message: ERR_PERM_DENIED[1] })
  }
  await next()
}

export const rootRequire: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const profile = await loadProfile(c)
  if (!profile.isRoot) {
    throw new HTTPException(ERR_PERM_DENIED[0] as number, { message: ERR_PERM_DENIED[1] })
  }
  await next()
}

const authnMiddleware = {
  checkSession,
  loadProfile,
  loginRequire,
  adminRequire,
  rootRequire,
}

export default authnMiddleware
