import test from 'ava'
import supertest from 'supertest'
import app from '../../../src/app'
import { encryptData } from '../../../src/services/crypto'
import { deploy } from '../../../src/utils/constants'
import { userSeeds } from '../../seeds/user'

const server = app.listen()
const adminRequest = supertest.agent(server)
const userRequest = supertest.agent(server)

const user = userSeeds.ugordon

// courseId 1 is a public course (encrypt: Public) from the seeds
const COURSE_ID = 1
// pid 1004 is the reserved problem from the seeds
const RESERVED_PID = 1004

test.before('Login as admin', async (t) => {
  const login = await adminRequest
    .post('/api/account/login')
    .send({
      username: 'admin',
      password: await encryptData(deploy.adminInitPwd),
    })
  t.is(login.status, 200)
})

test.before('Login as user', async (t) => {
  const login = await userRequest
    .post('/api/account/login')
    .send({
      username: user.uid,
      password: await encryptData(user.pwd!),
    })
  t.is(login.status, 200)
})

test.serial('Admin can add reserved problem to a course', async (t) => {
  const res = await adminRequest
    .post(`/api/course/${COURSE_ID}/problem`)
    .send({ problemIds: [RESERVED_PID] })

  t.is(res.status, 200)
  t.true(res.body.success)
})

// Admin can see reserved problem in the course problem list
test.serial('Admin can see reserved problem in course problem list', async (t) => {
  const res = await adminRequest
    .get('/api/problem')
    .query({ course: COURSE_ID })

  t.is(res.status, 200)
  t.true(Array.isArray(res.body.list.docs))
  const pids = res.body.list.docs.map((p: { pid: number }) => p.pid)
  t.true(pids.includes(RESERVED_PID), 'Admin should see reserved problem in course')
})

// Non-admin member of a public course should NOT see reserved problems
test.serial('Non-admin user cannot see reserved problem in course problem list', async (t) => {
  // courseId 1 is public so the user automatically has basic access
  const res = await userRequest
    .get('/api/problem')
    .query({ course: COURSE_ID })

  t.is(res.status, 200)
  t.true(Array.isArray(res.body.list.docs))
  const pids = res.body.list.docs.map((p: { pid: number }) => p.pid)
  t.false(pids.includes(RESERVED_PID), 'Non-admin user should NOT see reserved problem in course')
})

test.after.always('close server', () => {
  server.close()
})
