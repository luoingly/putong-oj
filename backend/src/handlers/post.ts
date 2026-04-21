import type { Hono } from 'hono'
import type { AppContext, HonoEnv } from '../types/koa'
import {
  ErrorCode,
  PostDetailQueryResultSchema,
  PostListQueryResultSchema,
  PostListQuerySchema,
} from '@putongoj/shared'
import { loadPost } from '../policies/post'
import { postService } from '../services/post'
import {
  createEnvelopedResponse,
  createErrorResponse,
  createZodErrorResponse,
} from '../utils'

async function findPosts (c: AppContext) {
  const query = PostListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const { page, pageSize } = query.data
  const posts = await postService.findPosts(
    { page, pageSize, sortBy: 'publishesAt', sort: -1 },
    { isPublished: true, isHidden: false })
  const result = PostListQueryResultSchema.encode(posts)
  return createEnvelopedResponse(c, result)
}

async function getPost (c: AppContext) {
  const postState = await loadPost(c)
  if (!postState) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Post not found')
  }

  const result = PostDetailQueryResultSchema.encode(postState.post)
  return createEnvelopedResponse(c, result)
}

function registerPostHandlers (app: Hono<HonoEnv>) {
  app.get('/posts', findPosts)
  app.get('/posts/:slug', getPost)
}

export default registerPostHandlers
