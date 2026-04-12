/**
 * Regression tests for CVE-style authorization bypass in testcase handlers.
 *
 * Vulnerability (fixed): In handlers/testcase.ts, the permission guard inside
 * `exportTestcases` and `getTestcase` called `courseService.hasProblemRole()`
 * without `await`.  Because an un-awaited Promise is always truthy, the
 * short-circuit evaluation meant the `ctx.throw(ERR_PERM_DENIED)` branch was
 * **never** reached, letting any authenticated user export or view testcases
 * for any Available problem they could see – regardless of whether they owned
 * the problem or had the `viewTestcase` course role.
 *
 * Fix: added `await` before both `courseService.hasProblemRole(...)` calls.
 */

import path from 'node:path'
import test from 'ava'
import fse from 'fs-extra'
import supertest from 'supertest'
import app from '../../../src/app'
import { encryptData } from '../../../src/services/crypto'
import { deploy, status } from '../../../src/utils/constants'

const server = app.listen()
const adminReq = supertest.agent(server)
const userReq = supertest.agent(server)

let availPid: number | null = null
let testcaseUuid: string | null = null

test.before('Login as admin', async (t) => {
  const res = await adminReq.post('/api/account/login').send({
    username: 'admin',
    password: await encryptData(deploy.adminInitPwd),
  })
  t.is(res.status, 200)
})

test.before('Login as regular user (non-owner, no course role)', async (t) => {
  const res = await userReq.post('/api/account/login').send({
    username: 'primaryuser',
    password: await encryptData('testtest'),
  })
  t.is(res.status, 200)
})

test.before('Admin creates an Available problem and adds a testcase', async (t) => {
  // status.Available = 2 – visible to all authenticated users
  const create = await adminReq.post('/api/problem').send({
    title: 'PoC – Available problem for authorization regression test',
    description: 'Used to verify that the missing-await bug is fixed.',
    status: status.Available,
    in: 'secret input',
    out: 'secret output',
  })
  t.is(create.status, 200)
  t.truthy(create.body.pid)
  availPid = create.body.pid

  const tc = await adminReq
    .post(`/api/problem/${availPid}/testcases`)
    .send({ in: 'secret input data', out: 'secret output data' })
  t.is(tc.status, 200)
  t.true(Array.isArray(tc.body.data))
  t.is(tc.body.data.length, 1)
  testcaseUuid = tc.body.data[0].uuid
  t.truthy(testcaseUuid)
})

// Confirm the regular user can actually view the problem (it's Available)
test('Regular user can view the Available problem', async (t) => {
  const res = await userReq.get(`/api/problem/${availPid}`)
  t.is(res.status, 200)
  t.truthy(res.body.pid ?? res.body.title)
})

// ── Core regression: export must be denied ──────────────────────────────────

test('Export testcases must be denied (403) for non-owner/non-admin users', async (t) => {
  const res = await userReq.get(`/api/problem/${availPid}/testcases/export`)
  // Before the fix: Promise was truthy → guard skipped → ZIP returned (200)
  // After the fix:  await resolves to false → guard fires → 403 Forbidden
  t.is(res.status, 200, 'HTTP layer always returns 200 (enveloped API)')
  t.is(res.body.success, false, 'Response must indicate failure')
  t.is(res.body.code, 403, 'Error code must be 403 Forbidden')
})

// ── Core regression: get testcase content must be denied ────────────────────

test('Get testcase content must be denied (403) for non-owner/non-admin users', async (t) => {
  t.truthy(testcaseUuid, 'testcaseUuid must be set by before hook')
  const res = await userReq.get(
    `/api/problem/${availPid}/testcases/${testcaseUuid}.in`,
  )
  // Before the fix: secret testcase content was returned directly
  // After the fix:  403 Forbidden
  t.is(res.status, 200, 'HTTP layer always returns 200 (enveloped API)')
  t.is(res.body.success, false, 'Response must indicate failure')
  t.is(res.body.code, 403, 'Error code must be 403 Forbidden')
})

test('Get testcase output content must be denied (403) for non-owner/non-admin users', async (t) => {
  t.truthy(testcaseUuid, 'testcaseUuid must be set by before hook')
  const res = await userReq.get(
    `/api/problem/${availPid}/testcases/${testcaseUuid}.out`,
  )
  t.is(res.status, 200, 'HTTP layer always returns 200 (enveloped API)')
  t.is(res.body.success, false, 'Response must indicate failure')
  t.is(res.body.code, 403, 'Error code must be 403 Forbidden')
})

// ── Sanity: admin (owner) still has access ──────────────────────────────────

test('Admin can still export testcases', async (t) => {
  const res = await adminReq.get(`/api/problem/${availPid}/testcases/export`)
  t.is(res.status, 200)
  t.is(res.type, 'application/zip')
})

test('Admin can still get testcase content', async (t) => {
  t.truthy(testcaseUuid)
  const res = await adminReq.get(
    `/api/problem/${availPid}/testcases/${testcaseUuid}.in`,
  )
  t.is(res.status, 200)
  t.is(res.type, 'text/plain')
  t.is(res.text, 'secret input data')
})

test.after.always('Cleanup', async (_t) => {
  if (availPid) {
    await adminReq.delete(`/api/problem/${availPid}`)
    const testDir = path.resolve(__dirname, `../../../data/${availPid}`)
    if (fse.existsSync(testDir)) {
      await fse.remove(testDir)
    }
  }
  server.close()
})
