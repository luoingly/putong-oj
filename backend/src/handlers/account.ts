import type { AppContext, HonoEnv } from '../types/koa'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import {
  AccountChangePasswordPayloadSchema,
  AccountEditPayloadSchema,
  AccountLoginPayloadSchema,
  AccountProfileQueryResultSchema,
  AccountRegisterPayloadSchema,
  AccountSubmissionListQueryResultSchema,
  AccountSubmissionListQuerySchema,
  ErrorCode,
  SessionListQueryResultSchema,
  SessionRevokeOthersResultSchema,
  UserPrivilege,
} from '@putongoj/shared'
import { checkSession, loadProfile, loginRequire } from '../middlewares/authn'
import { userLoginLimit, userRegisterLimit } from '../middlewares/ratelimit'
import cryptoService from '../services/crypto'
import sessionService from '../services/session'
import { settingsService } from '../services/settings'
import solutionService from '../services/solution'
import userService from '../services/user'
import {
  createEnvelopedResponse,
  createErrorResponse,
  createZodErrorResponse,
  isComplexPwd,
  passwordHash,
  passwordHashBuffer,
} from '../utils'

export async function getProfile (c: AppContext) {
  const profile = await checkSession(c)
  if (!profile) {
    return createErrorResponse(c, ErrorCode.Unauthorized, 'Not logged in')
  }

  const result = AccountProfileQueryResultSchema.encode(profile.toObject())
  return createEnvelopedResponse(c, result)
}

export async function userLogin (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = AccountLoginPayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }
  let password: string
  try {
    password = await cryptoService.decryptData(payload.data.password)
  } catch {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Failed to decrypt password field')
  }
  const pwdHash = passwordHashBuffer(password)

  const user = await userService.getUser(payload.data.username)
  if (!user) {
    return createErrorResponse(c, ErrorCode.Unauthorized, 'Username or password is incorrect')
  }
  if (timingSafeEqual(Buffer.from(user.pwd, 'hex'), pwdHash) === false) {
    return createErrorResponse(c, ErrorCode.Unauthorized, 'Username or password is incorrect')
  }
  if (user.privilege === UserPrivilege.Banned) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Account has been banned, please contact the administrator')
  }

  const userId = user._id.toString()
  const sessionId = await sessionService.createSession(
    userId, c.get('clientIp'), c.req.header('User-Agent') || '',
  )
  const session = c.get('session')
  session.userId = userId
  session.sessionId = sessionId
  session._modified = true

  c.get('auditLog').info(`<User:${user.uid}> logged in successfully`)

  const result = AccountProfileQueryResultSchema.encode(user.toObject())
  return createEnvelopedResponse(c, result)
}

export async function userRegister (c: AppContext) {
  const profile = await checkSession(c)
  if (profile) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Already logged in')
  }

  const body = await c.req.json().catch(() => ({}))
  const payload = AccountRegisterPayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }
  let password: string
  try {
    password = await cryptoService.decryptData(payload.data.password)
  } catch {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Failed to decrypt password field')
  }

  const available = await userService.checkUserAvailable(payload.data.username)
  if (!available) {
    return createErrorResponse(c, ErrorCode.Conflict, 'The username has been registered or reserved')
  }
  if (!isComplexPwd(password)) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Password is not complex enough')
  }

  try {
    const user = await userService.createUser({
      uid: payload.data.username,
      pwd: passwordHash(password),
    })
    const userId = user._id.toString()
    const sessionId = await sessionService.createSession(
      userId, c.get('clientIp'), c.req.header('User-Agent') || '',
    )
    const session = c.get('session')
    session.userId = userId
    session.sessionId = sessionId
    session._modified = true

    c.get('auditLog').info(`<User:${user.uid}> registered successfully`)

    const result = AccountProfileQueryResultSchema.encode(user.toObject())
    return createEnvelopedResponse(c, result)
  } catch (err) {
    c.get('auditLog').error('Failed to register user', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }
}

export async function userLogout (c: AppContext) {
  const profile = c.get('profile')
  const sessionId = c.get('sessionId')

  if (profile && sessionId) {
    await sessionService.revokeSession(profile._id.toString(), sessionId)
    c.get('auditLog').info(`<User:${profile.uid}> logged out`)
  }
  const session = c.get('session')
  delete session.userId
  delete session.sessionId
  session._modified = true

  return createEnvelopedResponse(c, null)
}

export async function updateProfile (c: AppContext) {
  const profile = await loadProfile(c)
  const body = await c.req.json().catch(() => ({}))
  const payload = AccountEditPayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }

  try {
    const { nick, avatar, motto, mail, school } = payload.data

    if (avatar !== undefined && avatar !== '') {
      // Allow keeping current avatar (e.g. admin-set custom avatar)
      if (avatar !== profile.avatar) {
        const presets = await settingsService.getAvatarPresets()
        if (!presets.includes(avatar)) {
          return createErrorResponse(c, ErrorCode.Forbidden, 'Avatar is not in the allowed presets')
        }
      }
    }

    const updatedUser = await userService.updateUser(profile, {
      nick, avatar, motto, mail, school,
    })
    const result = AccountProfileQueryResultSchema.encode(updatedUser.toObject())
    c.get('auditLog').info(`<User:${profile.uid}> updated profile`)
    return createEnvelopedResponse(c, result)
  } catch (err) {
    c.get('auditLog').error('Failed to update profile', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }
}

export async function updatePassword (c: AppContext) {
  const profile = await loadProfile(c)
  const body = await c.req.json().catch(() => ({}))
  const payload = AccountChangePasswordPayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }
  let oldPassword: string | undefined
  let newPassword: string | undefined
  try {
    oldPassword = await cryptoService.decryptData(payload.data.oldPassword)
    newPassword = await cryptoService.decryptData(payload.data.newPassword)
  } catch {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Failed to decrypt password field')
  }

  if (!isComplexPwd(newPassword)) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'New password is not complex enough')
  }
  const oldPwdHash = passwordHashBuffer(oldPassword)
  if (timingSafeEqual(Buffer.from(profile.pwd, 'hex'), oldPwdHash) === false) {
    return createErrorResponse(c, ErrorCode.Unauthorized, 'Old password is incorrect')
  }
  const pwd = passwordHash(newPassword)

  try {
    await userService.updateUser(profile, { pwd })
    const userId = profile._id.toString()
    const revoked = await sessionService.revokeOtherSessions(userId, c.get('sessionId')!)
    c.get('auditLog').info(`<User:${profile.uid}> changed password, revoked ${revoked} other session(s)`)
    return createEnvelopedResponse(c, null)
  } catch (err) {
    c.get('auditLog').error('Failed to update password', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }
}

export async function findSubmissions (c: AppContext) {
  const profile = await loadProfile(c)
  const query = AccountSubmissionListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const solutions = await solutionService
    .findSolutions({ ...query.data, user: profile.uid })
  const result = AccountSubmissionListQueryResultSchema.encode(solutions)
  return createEnvelopedResponse(c, result)
}

export async function listSessions (c: AppContext) {
  const profile = await loadProfile(c)
  const userId = profile._id.toString()
  const sessions = await sessionService.listSessions(userId)

  const currentSessionId = c.get('sessionId')
  const result = SessionListQueryResultSchema.parse(sessions.map(s => ({
    sessionId: s.sessionId,
    current: s.sessionId === currentSessionId,
    lastAccessAt: s.lastAccessAt,
    loginAt: s.info.loginAt,
    loginIp: s.info.loginIp,
    userAgent: s.info.userAgent,
  })))
  return createEnvelopedResponse(c, result)
}

export async function revokeSession (c: AppContext) {
  const profile = await loadProfile(c)
  const sessionId = c.req.param('sessionId')
  if (!sessionId || typeof sessionId !== 'string') {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Invalid session ID')
  }
  if (sessionId === c.get('sessionId')) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Cannot revoke current session, use logout instead')
  }

  await sessionService.revokeSession(profile._id.toString(), sessionId)
  c.get('auditLog').info(`<User:${profile.uid}> revoked <Session:${sessionId}>`)
  return createEnvelopedResponse(c, null)
}

export async function revokeOtherSessions (c: AppContext) {
  const profile = await loadProfile(c)
  const currentSessionId = c.get('sessionId')
  if (!currentSessionId) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'No active session')
  }

  const removed = await sessionService.revokeOtherSessions(
    profile._id.toString(), currentSessionId,
  )
  c.get('auditLog').info(`<User:${profile.uid}> revoked ${removed} other session(s)`)
  const result = SessionRevokeOthersResultSchema.parse({ removed })
  return createEnvelopedResponse(c, result)
}

function registerAccountHandlers (app: Hono<HonoEnv>) {
  const accountApp = new Hono<HonoEnv>()

  accountApp.get('/profile', getProfile)
  accountApp.post('/login', userLoginLimit, userLogin)
  accountApp.post('/register', userRegisterLimit, userRegister)
  accountApp.post('/logout', loginRequire, userLogout)
  accountApp.put('/profile', loginRequire, updateProfile)
  accountApp.put('/password', loginRequire, updatePassword)
  accountApp.get('/submissions', loginRequire, findSubmissions)

  accountApp.get('/sessions', loginRequire, listSessions)
  accountApp.delete('/sessions', loginRequire, revokeOtherSessions)
  accountApp.delete('/sessions/:sessionId', loginRequire, revokeSession)

  app.route('/account', accountApp)
}

export default registerAccountHandlers
