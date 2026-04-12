import path from 'node:path'
import test from 'ava'
import fse from 'fs-extra'
import supertest from 'supertest'
import app from '../../../src/app'
import { encryptData } from '../../../src/services/crypto'
import { deploy, status } from '../../../src/utils/constants'

const server = app.listen()
const request = supertest.agent(server)
const adminRequest = supertest.agent(server)

// Reserved problem — not visible to the regular user at all
let reservedPid: number | null = null

// Available problem — visible to the regular user, but they are not the owner
let availablePid: number | null = null
let availableTestcaseUuid: string | null = null

test.before('Setup - login as admin and create test problems', async (t) => {
  const adminLogin = await adminRequest
    .post('/api/account/login')
    .send({
      username: 'admin',
      password: await encryptData(deploy.adminInitPwd),
    })

  t.is(adminLogin.status, 200)

  // Create a reserved (hidden) problem
  const createReserved = await adminRequest
    .post('/api/problem')
    .send({
      title: 'Test Problem for User Permission Tests',
      description: 'A problem to test user permission denial',
      input: 'Test input',
      output: 'Test output',
      in: '1',
      out: '1',
    })

  t.is(createReserved.status, 200)
  t.truthy(createReserved.body.pid)
  reservedPid = createReserved.body.pid

  // Create an available problem so the user can see it but does not own it
  const createAvailable = await adminRequest
    .post('/api/problem')
    .send({
      title: 'Test Problem (Available) for User Permission Tests',
      description: 'An available problem to test permission on testcase endpoints',
      input: 'Input description',
      output: 'Output description',
      in: '1 2',
      out: '3',
      status: status.Available,
    })

  t.is(createAvailable.status, 200)
  t.truthy(createAvailable.body.pid)
  availablePid = createAvailable.body.pid

  // Add a testcase to the available problem as admin
  const addTestcase = await adminRequest
    .post(`/api/problem/${availablePid}/testcases`)
    .send({ in: '1 2\n', out: '3\n' })

  t.is(addTestcase.status, 200)
  t.true(Array.isArray(addTestcase.body.data))
  t.is(addTestcase.body.data.length, 1)
  availableTestcaseUuid = addTestcase.body.data[0].uuid
})

test.before('Login as regular user', async (t) => {
  const login = await request
    .post('/api/account/login')
    .send({
      username: 'primaryuser',
      password: await encryptData('testtest'),
    })

  t.is(login.status, 200)
})

// ── Reserved problem: user cannot even see the problem ───────────────────────

test('Find testcases - should be denied for non-admin/non-owner (reserved problem)', async (t) => {
  const res = await request
    .get(`/api/problem/${reservedPid}/testcases`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 404)
})

test('Create testcase - should be denied for non-admin/non-owner (reserved problem)', async (t) => {
  const res = await request
    .post(`/api/problem/${reservedPid}/testcases`)
    .send({
      in: '1 2\n',
      out: '3\n',
    })

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 404)
})

test('Export testcases - should be denied for non-admin/non-owner (reserved problem)', async (t) => {
  const res = await request
    .get(`/api/problem/${reservedPid}/testcases/export`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 404)
})

test('Get testcase - should be denied for non-admin/non-owner (reserved problem)', async (t) => {
  const dummyUuid = '00000000-0000-0000-0000-000000000000'
  const res = await request
    .get(`/api/problem/${reservedPid}/testcases/${dummyUuid}.in`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 404)
})

test('Remove testcase - should be denied for non-admin/non-owner (reserved problem)', async (t) => {
  const dummyUuid = '00000000-0000-0000-0000-000000000000'
  const res = await request
    .delete(`/api/problem/${reservedPid}/testcases/${dummyUuid}`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 404)
})

// ── Available problem: user can see the problem but does not own it ──────────

test('Find testcases - should be denied for non-owner on available problem', async (t) => {
  const res = await request
    .get(`/api/problem/${availablePid}/testcases`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 403)
})

test('Create testcase - should be denied for non-owner on available problem', async (t) => {
  const res = await request
    .post(`/api/problem/${availablePid}/testcases`)
    .send({ in: 'foo\n', out: 'bar\n' })

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 403)
})

test('Export testcases - should be denied for non-owner on available problem', async (t) => {
  const res = await request
    .get(`/api/problem/${availablePid}/testcases/export`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 403)
})

test('Get testcase - should be denied for non-owner on available problem', async (t) => {
  t.truthy(availableTestcaseUuid)
  const res = await request
    .get(`/api/problem/${availablePid}/testcases/${availableTestcaseUuid}.in`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 403)
})

test('Remove testcase - should be denied for non-owner on available problem', async (t) => {
  t.truthy(availableTestcaseUuid)
  const res = await request
    .delete(`/api/problem/${availablePid}/testcases/${availableTestcaseUuid}`)

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 403)
})

test.after.always('Cleanup', async (_t) => {
  if (reservedPid) {
    await adminRequest.delete(`/api/problem/${reservedPid}`)
  }
  if (availablePid) {
    await adminRequest.delete(`/api/problem/${availablePid}`)
    const testDir = path.resolve(__dirname, `../../../data/${availablePid}`)
    if (fse.existsSync(testDir)) {
      await fse.remove(testDir)
    }
  }

  server.close()
})

