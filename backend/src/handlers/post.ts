import type Router from '@koa/router'
import type { Context } from 'koa'
import {
  ErrorCode,
  PostCreatePayloadSchema,
  PostDetailQueryResultSchema,
  PostListQueryResultSchema,
  PostListQuerySchema,
  PostUpdatePayloadSchema,
} from '@putongoj/shared'
import { adminRequire, loadProfile, rootRequire } from '../middlewares/authn'
import { loadPost } from '../policies/post'
import { postService } from '../services/post'
import {
  createEnvelopedResponse,
  createErrorResponse,
  createZodErrorResponse,
} from '../utils'

async function findPosts (ctx: Context) {
  const query = PostListQuerySchema.safeParse(ctx.request.query)
  if (!query.success) {
    return createZodErrorResponse(ctx, query.error)
  }

  const { page, pageSize } = query.data
  const { profile } = ctx.state

  const showAll = Boolean(profile?.isAdmin)
  const posts = await postService.findPosts({
    page, pageSize, showAll,
  })
  const result = PostListQueryResultSchema.encode(posts)
  return createEnvelopedResponse(ctx, result)
}

async function getPost (ctx: Context) {
  const postState = await loadPost(ctx)
  if (!postState) {
    return createErrorResponse(ctx, ErrorCode.NotFound, 'Post not found')
  }

  const result = PostDetailQueryResultSchema.encode(postState.post)
  return createEnvelopedResponse(ctx, result)
}

async function createPost (ctx: Context) {
  const payload = PostCreatePayloadSchema.safeParse(ctx.request.body)
  if (!payload.success) {
    return createZodErrorResponse(ctx, payload.error)
  }

  const profile = await loadProfile(ctx)
  const { title } = payload.data

  try {
    const post = await postService.createPost({ title })

    ctx.auditLog.info(`<Post:${post.slug}> created by <User:${profile.uid}>`)
    return createEnvelopedResponse(ctx, { slug: post.slug })
  } catch (err: any) {
    ctx.auditLog.error('Failed to create post', err)
    if (err.code === 11000) {
      return createErrorResponse(ctx, ErrorCode.BadRequest, 'Slug already exists')
    }
    return createErrorResponse(ctx, ErrorCode.InternalServerError)
  }
}

async function updatePost (ctx: Context) {
  const payload = PostUpdatePayloadSchema.safeParse(ctx.request.body)
  if (!payload.success) {
    return createZodErrorResponse(ctx, payload.error)
  }

  const profile = await loadProfile(ctx)
  const postState = await loadPost(ctx)
  if (!postState) {
    return createErrorResponse(ctx, ErrorCode.NotFound, 'Post not found')
  }
  const { slug } = payload.data
  const post = postState.post

  try {
    // Check slug uniqueness if slug is being changed
    if (slug && slug !== post.slug) {
      const exists = await postService.isSlugTaken(slug, post._id)
      if (exists) {
        return createErrorResponse(ctx, ErrorCode.BadRequest, 'Slug already exists')
      }
    }

    const updated = await postService.updatePostById(post._id, payload.data)
    if (!updated) {
      return createErrorResponse(ctx, ErrorCode.NotFound, 'Post not found')
    }

    ctx.auditLog.info(`<Post:${updated.slug}> updated by <User:${profile.uid}>`)
    return createEnvelopedResponse(ctx, { slug: updated.slug })
  } catch (err: any) {
    ctx.auditLog.error('Failed to update post', err)
    if (err.code === 11000) {
      return createErrorResponse(ctx, ErrorCode.BadRequest, 'Slug already exists')
    }
    return createErrorResponse(ctx, ErrorCode.InternalServerError)
  }
}

async function deletePost (ctx: Context) {
  const profile = await loadProfile(ctx)
  const postState = await loadPost(ctx)
  if (!postState) {
    return createErrorResponse(ctx, ErrorCode.NotFound, 'Post not found')
  }
  const post = postState.post
  const slug = post.slug

  try {
    await postService.deletePostById(post._id)
    ctx.auditLog.info(`<Post:${slug}> deleted by <User:${profile.uid}>`)
    return createEnvelopedResponse(ctx, null)
  } catch (err: any) {
    ctx.auditLog.error('Failed to delete post', err)
    return createErrorResponse(ctx, ErrorCode.InternalServerError)
  }
}

function registerPostHandlers (router: Router) {
  router.get('/posts', findPosts)
  router.post('/posts', adminRequire, createPost)

  router.get('/post/:slug', getPost)
  router.put('/post/:slug', adminRequire, updatePost)
  router.delete('/post/:slug', rootRequire, deletePost)
}

export default registerPostHandlers
