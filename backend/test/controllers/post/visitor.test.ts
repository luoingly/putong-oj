import test from 'ava'
import supertest from 'supertest'
import app from '../../../src/app'

const server = app.listen()
const request = supertest.agent(server)

test('Post list is accessible to visitors', async (t) => {
  const res = await request
    .get('/api/post/list')

  t.plan(3)

  t.is(res.status, 200)
  t.truthy(Array.isArray(res.body.list.docs))

  if (res.body.list.docs.length > 0) {
    t.truthy(res.body.list.docs[0].title)
  } else {
    t.pass('Post list is empty')
  }
})

test('Post fails to find one because slug does not exist', async (t) => {
  const res = await request
    .get('/api/post/this-slug-does-not-exist')

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 400)
})

test('Post finds one by slug', async (t) => {
  const res = await request
    .get('/api/post/welcome-to-putong-oj')

  t.is(res.status, 200)
  t.is(res.body.post.slug, 'welcome-to-putong-oj')
  t.truthy(res.body.post.title)
  t.truthy(res.body.post.content)
})

test('Visitor cannot create a post', async (t) => {
  const res = await request
    .post('/api/post')
    .send({
      slug: 'visitor-post',
      title: 'abcdefg',
      content: 'xxx',
    })

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 401)
})

test('Visitor cannot update a post', async (t) => {
  const res = await request
    .put('/api/post/to-be-updated')
    .send({
      title: 'changed title',
      content: 'changed content',
    })

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 401)
})

test('Visitor cannot delete a post', async (t) => {
  const res = await request
    .delete('/api/post/to-be-deleted')

  t.is(res.status, 200)
  t.is(res.body.success, false)
  t.is(res.body.code, 401)
})

test.after.always('close server', () => {
  server.close()
})
