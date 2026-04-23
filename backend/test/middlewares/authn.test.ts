import type { UserDocument } from '../../src/models/User'
import test from 'ava'
import { HTTPException } from 'hono/http-exception'
import authnMiddleware from '../../src/middlewares/authn'
import User from '../../src/models/User'
import sessionService from '../../src/services/session'
import { ERR_LOGIN_REQUIRE, ERR_PERM_DENIED } from '../../src/utils/constants'
import { userSeeds } from '../seeds/user'
import '../../src/config/db'

const noopLog = { info () {}, warn () {}, error () {} }
const nonExistUserId = '000000000000000000000000'

// Resolved after test.before – populated with real Mongo _id strings
const testUsers: Record<string, { _id: string, user: UserDocument }> = {} as any

test.before('resolve user ids', async () => {
  for (const key of [ 'MauthnBanned', 'MauthnNormal', 'MauthnAdmin', 'MauthnRoot' ] as const) {
    const user = await User.findOne({ uid: userSeeds[key].uid })
    if (!user) { throw new Error(`Seed user ${key} not found`) }
    testUsers[key] = { _id: user._id.toString(), user }
  }
})

/** Create a minimal Hono-style context mock for authn tests. */
function makeMockCtx (initial: Record<string, any> = {}) {
  const store: Record<string, any> = {
    auditLog: noopLog,
    session: {},
    ...initial,
  }
  return {
    get: (key: string) => store[key],
    set: (key: string, val: any) => { store[key] = val },
    _store: store,
  } as any
}

// ─── checkSession ──────────────────────────────────────────────────────────

test('checkSession (no session)', async (t) => {
  const c = makeMockCtx()

  const result = await authnMiddleware.checkSession(c)
  t.is(result, undefined)
  t.is(c.get('profile'), undefined)
})

test('checkSession (already checked)', async (t) => {
  const fakeProfile = { uid: 'already' } as any
  const c = makeMockCtx({ authnChecked: true, profile: fakeProfile })

  const result = await authnMiddleware.checkSession(c)
  t.is(result, fakeProfile)
  t.is(c.get('authnChecked'), true)
})

test('checkSession (session not in Redis)', async (t) => {
  const { _id } = testUsers.MauthnNormal
  const c = makeMockCtx({
    session: { userId: _id, sessionId: 'nonexistent_session_id' },
  })

  const result = await authnMiddleware.checkSession(c)
  t.is(result, undefined)
  t.is(c.get('profile'), undefined)
  t.is(c.get('session').userId, undefined)
  t.is(c.get('session').sessionId, undefined)
})

test('checkSession (non-existent user)', async (t) => {
  // Create a session for a userId that doesn't exist in MongoDB
  const sessionId = await sessionService.createSession(nonExistUserId, '127.0.0.1', 'test')
  const c = makeMockCtx({
    session: { userId: nonExistUserId, sessionId },
  })

  const result = await authnMiddleware.checkSession(c)
  t.is(result, undefined)
  t.is(c.get('profile'), undefined)
  t.is(c.get('session').userId, undefined)
  t.is(c.get('session').sessionId, undefined)
})

test('checkSession (banned user)', async (t) => {
  const { _id } = testUsers.MauthnBanned
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({
    session: { userId: _id, sessionId },
  })

  const result = await authnMiddleware.checkSession(c)
  t.is(result, undefined)
  t.is(c.get('profile'), undefined)
  t.is(c.get('session').userId, undefined)
  t.is(c.get('session').sessionId, undefined)
})

test('checkSession (normal user)', async (t) => {
  const { _id } = testUsers.MauthnNormal
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({
    session: { userId: _id, sessionId },
  })

  const result = await authnMiddleware.checkSession(c)
  t.truthy(result)
  t.is(result?.uid, userSeeds.MauthnNormal.uid)
  t.is(c.get('profile')?.uid, userSeeds.MauthnNormal.uid)
  t.is(c.get('sessionId'), sessionId)
})

// ─── loginRequire ──────────────────────────────────────────────────────────

test('loginRequire (no session)', async (t) => {
  const c = makeMockCtx()

  const err = await t.throwsAsync(
    authnMiddleware.loginRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_LOGIN_REQUIRE[0] as any)
  t.is(err?.message, ERR_LOGIN_REQUIRE[1])
})

test('loginRequire (banned user)', async (t) => {
  const { _id } = testUsers.MauthnBanned
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  const err = await t.throwsAsync(
    authnMiddleware.loginRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_LOGIN_REQUIRE[0] as any)
  t.is(err?.message, ERR_LOGIN_REQUIRE[1])
})

test('loginRequire (valid user)', async (t) => {
  const { _id } = testUsers.MauthnNormal
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  let nextCalled = false
  await authnMiddleware.loginRequire(c, async () => { nextCalled = true })
  t.true(nextCalled)
})

// ─── adminRequire ──────────────────────────────────────────────────────────

test('adminRequire (no session)', async (t) => {
  const c = makeMockCtx()

  const err = await t.throwsAsync(
    async () => authnMiddleware.adminRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_LOGIN_REQUIRE[0] as any)
  t.is(err?.message, ERR_LOGIN_REQUIRE[1])
})

test('adminRequire (normal user)', async (t) => {
  const { _id } = testUsers.MauthnNormal
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  const err = await t.throwsAsync(
    async () => authnMiddleware.adminRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_PERM_DENIED[0] as any)
  t.is(err?.message, ERR_PERM_DENIED[1])
})

test('adminRequire (admin user)', async (t) => {
  const { _id } = testUsers.MauthnAdmin
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  let nextCalled = false
  await authnMiddleware.adminRequire(c, async () => { nextCalled = true })
  t.true(nextCalled)
})

test('adminRequire (root user)', async (t) => {
  const { _id } = testUsers.MauthnRoot
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  let nextCalled = false
  await authnMiddleware.adminRequire(c, async () => { nextCalled = true })
  t.true(nextCalled)
})

// ─── rootRequire ───────────────────────────────────────────────────────────

test('rootRequire (no session)', async (t) => {
  const c = makeMockCtx()

  const err = await t.throwsAsync(
    async () => authnMiddleware.rootRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_LOGIN_REQUIRE[0] as any)
  t.is(err?.message, ERR_LOGIN_REQUIRE[1])
})

test('rootRequire (normal user)', async (t) => {
  const { _id } = testUsers.MauthnNormal
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  const err = await t.throwsAsync(
    async () => authnMiddleware.rootRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_PERM_DENIED[0] as any)
  t.is(err?.message, ERR_PERM_DENIED[1])
})

test('rootRequire (admin user)', async (t) => {
  const { _id } = testUsers.MauthnAdmin
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  const err = await t.throwsAsync(
    async () => authnMiddleware.rootRequire(c, async () => {}),
    { instanceOf: HTTPException },
  )
  t.is(err?.status, ERR_PERM_DENIED[0] as any)
  t.is(err?.message, ERR_PERM_DENIED[1])
})

test('rootRequire (root user)', async (t) => {
  const { _id } = testUsers.MauthnRoot
  const sessionId = await sessionService.createSession(_id, '127.0.0.1', 'test')
  const c = makeMockCtx({ session: { userId: _id, sessionId } })

  let nextCalled = false
  await authnMiddleware.rootRequire(c, async () => { nextCalled = true })
  t.true(nextCalled)
})
