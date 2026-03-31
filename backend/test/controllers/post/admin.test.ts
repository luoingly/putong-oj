import test from 'ava'
import supertest from 'supertest'
import app from '../../../src/app'
import { encryptData } from '../../../src/services/crypto'
import { deploy } from '../../../src/utils/constants'

const server = app.listen()
const request = supertest.agent(server)

// slugs used in tests:
// delete: to-be-deleted
// update: to-be-updated

test.before('Login', async (t) => {
  const login = await request
    .post('/api/account/login')
    .send({
      username: 'admin',
      password: await encryptData(deploy.adminInitPwd),
    })

  t.is(login.status, 200)
})

test('Admin can delete a post', async (t) => {
  const res = await request
    .delete('/api/post/to-be-deleted')

  t.is(res.status, 200)
  t.is(res.body.success, true)

  const find = await request
    .get('/api/post/to-be-deleted')

  t.is(find.status, 200)
  t.is(find.body.success, false)
  t.is(find.body.code, 400)
})

test('Admin fails to create a post without slug', async (t) => {
  const res = await request
    .post('/api/post')
    .send({
      title: 'abcdefg',
      content: 'xxx',
    })

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 400)
})

test('Admin fails to create a post with invalid title', async (t) => {
  const res = await request
    .post('/api/post')
    .send({
      slug: 'short',
      content: 'xxx',
    })

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 400)
})

test('Admin can create a post', async (t) => {
  const res = await request
    .post('/api/post')
    .send({
      slug: 'test-create-post',
      title: 'Test Create Post',
      content: 'This is the content of the test post.',
    })

  t.is(res.status, 200)
  t.is(res.body.success, true)

  const { slug } = res.body
  t.is(slug, 'test-create-post')

  const find = await request
    .get(`/api/post/${slug}`)

  t.is(find.status, 200)
  t.is(find.body.post.slug, slug)
  t.is(find.body.post.title, 'Test Create Post')
  t.is(find.body.post.content, 'This is the content of the test post.')
})

test('Admin can update a post', async (t) => {
  const res = await request
    .put('/api/post/to-be-updated')
    .send({
      title: 'Updated Title Here',
      content: 'Updated content here.',
    })

  t.is(res.status, 200)
  t.is(res.body.success, true)

  const find = await request
    .get('/api/post/to-be-updated')

  t.is(find.status, 200)
  t.is(find.body.post.slug, 'to-be-updated')
  t.is(find.body.post.title, 'Updated Title Here')
  t.is(find.body.post.content, 'Updated content here.')
})

test('Admin can rename slug when updating a post', async (t) => {
  const res = await request
    .put('/api/post/ranklist-updated')
    .send({
      slug: 'ranklist-updated-renamed',
      title: 'Ranklist Updated',
      content: 'The ranklist has been updated.',
    })

  t.is(res.status, 200)
  t.is(res.body.success, true)
  t.is(res.body.slug, 'ranklist-updated-renamed')

  const findNew = await request
    .get('/api/post/ranklist-updated-renamed')

  t.is(findNew.status, 200)
  t.is(findNew.body.post.slug, 'ranklist-updated-renamed')
})

test('Admin can toggle pin on a post', async (t) => {
  const initial = await request
    .get('/api/post/contest-rules')

  t.is(initial.status, 200)
  const originalPin = initial.body.post.pin

  const res = await request
    .put('/api/post/contest-rules')
    .send({ pin: !originalPin })

  t.is(res.status, 200)
  t.is(res.body.success, true)

  const find = await request
    .get('/api/post/contest-rules')

  t.is(find.status, 200)
  t.is(find.body.post.pin, !originalPin)
})

test.after.always('close server', () => {
  server.close()
})
