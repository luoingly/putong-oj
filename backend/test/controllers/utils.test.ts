import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { resolve } from 'node:path'
import test from 'ava'
import supertest from 'supertest'
import app from '../../src/app'
import Files from '../../src/models/Files'
import User from '../../src/models/User'
import { encryptData } from '../../src/services/crypto'
import { deploy } from '../../src/utils/constants'

const server = app.listen()
const request = supertest.agent(server)

const filepath = resolve(__dirname, 'utils.test.ts')
const content = fs.readFileSync(filepath, 'utf8')

test('Server time', async (t) => {
  const res = await request
    .get('/api/servertime')

  t.is(res.status, 200)
  t.truthy(res.body.serverTime)
  t.truthy(Number.isInteger(res.body.serverTime))
})

test.skip('Website information', async (t) => {
  const res = await request
    .get('/api/website')

  t.is(res.status, 200)
  // t.is(res.body.title, websiteConfig.title)
  // t.is(res.body.buildSHA, websiteConfig.buildSHA)
  // t.is(res.body.buildTime, websiteConfig.buildTime)
  t.is(typeof res.body.apiPublicKey, 'string')
})

test('Visitor can not submit file', async (t) => {
  const res = await request
    .post('/api/upload')
    .attach('image', filepath)
  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 401)
})

test('Admin could submit file', async (t) => {
  const res = await request
    .post('/api/account/login')
    .send({
      username: 'admin',
      password: await encryptData(deploy.adminInitPwd),
    })
  t.is(res.status, 200)

  const submit = await request
    .post('/api/upload')
    .attach('image', filepath)

  t.is(submit.status, 200)
  t.true(submit.body.success)

  const { url } = submit.body.data
  t.is(typeof url, 'string')
  const uploaded = url.match(/\/uploads\/(.*)/)[1]

  const uploadedContent = fs.readFileSync(
    resolve(__dirname, '../../public/uploads', uploaded),
    'utf8',
  )
  t.is(uploadedContent, content)

  const record = await Files.findOne({ storageKey: uploaded }).lean()
  t.truthy(record)
  t.is(record?.sizeBytes, Buffer.byteLength(content, 'utf8'))
})

test('Normal user upload should be denied when storage quota is 0', async (t) => {
  const login = await request
    .post('/api/account/login')
    .send({
      username: 'primaryuser',
      password: await encryptData('testtest'),
    })
  t.is(login.status, 200)

  const submit = await request
    .post('/api/upload')
    .attach('image', filepath)

  t.is(submit.status, 200)
  t.false(submit.body.success)
  t.is(submit.body.code, 403)
})

test('Normal user upload should succeed after storage quota is set', async (t) => {
  const user = await User.findOne({ uid: 'primaryuser' })
  t.truthy(user)
  user!.storageQuota = 2 * 1024 * 1024
  await user!.save()

  const login = await request
    .post('/api/account/login')
    .send({
      username: 'primaryuser',
      password: await encryptData('testtest'),
    })
  t.is(login.status, 200)

  const submit = await request
    .post('/api/upload')
    .attach('image', filepath)

  t.is(submit.status, 200)
  t.true(submit.body.success)
  t.is(typeof submit.body.data.url, 'string')
})
