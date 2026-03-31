import type { Context } from 'koa'
import { loadProfile } from '../middlewares/authn'
import Post from '../models/Post'
import { only } from '../utils'
import { status } from '../utils/constants'

/**
 * Preload post by slug
 */
const preload = async (ctx: Context, next: () => Promise<any>) => {
  const { slug } = ctx.params
  const post = await Post.findOne({ slug })
    .populate('owner', '-_id uid nick')
    .exec()
  if (!post) {
    ctx.throw(400, 'No such a post')
  }
  ctx.state.post = post
  return next()
}

/**
 * List posts
 */
const find = async (ctx: Context) => {
  const opt = ctx.request.query
  const page = Number.parseInt(opt.page as string) || 1
  const pageSize = Number.parseInt(opt.pageSize as string) || 10

  const filter: Record<string, any> = {}
  if (!ctx.state.profile?.isAdmin) {
    filter.status = status.Available
  }

  const list = await Post.paginate(filter, {
    sort: { pin: -1, createdAt: -1 },
    page,
    limit: pageSize,
    lean: true,
    leanWithId: false,
    populate: { path: 'owner', select: '-_id uid nick' },
    select: '-_id slug title status pin owner createdAt',
  })
  ctx.body = { list }
}

/**
 * Get a single post
 */
const findOne = async (ctx: Context) => {
  const post = ctx.state.post
  const obj = post.toObject({ versionKey: false })
  ctx.body = {
    post: only(obj, 'slug title content status pin owner createdAt'),
  }
}

/**
 * Create a post (admin only)
 */
const create = async (ctx: Context) => {
  const opt = ctx.request.body
  const { _id: ownerObjectId, uid } = await loadProfile(ctx)
  const post = new Post(Object.assign(
    only(opt, 'slug title content pin'),
    {
      owner: ownerObjectId,
      status: status.Available,
    },
  ))

  if (opt.status !== undefined) {
    post.status = opt.status
  }

  try {
    await post.save()
    ctx.auditLog.info(`<Post:${post.slug}> created by <User:${uid}>`)
  } catch (e: any) {
    ctx.throw(400, e.message)
  }

  ctx.body = { slug: post.slug }
}

/**
 * Update a post (admin only)
 */
const update = async (ctx: Context) => {
  const opt = ctx.request.body
  const post = ctx.state.post
  const { uid } = await loadProfile(ctx)
  const fields = [ 'title', 'content', 'status', 'pin' ]
  fields.forEach((field) => {
    if (opt[field] !== undefined) {
      post[field] = opt[field]
    }
  })
  // Allow slug rename
  if (opt.slug !== undefined) {
    post.slug = opt.slug
  }
  try {
    await post.save()
    ctx.auditLog.info(`<Post:${post.slug}> updated by <User:${uid}>`)
  } catch (e: any) {
    ctx.throw(400, e.message)
  }

  ctx.body = { slug: post.slug }
}

/**
 * Delete a post (admin only)
 */
const del = async (ctx: Context) => {
  const { slug } = ctx.params
  const { uid } = await loadProfile(ctx)

  try {
    await Post.deleteOne({ slug }).exec()
    ctx.auditLog.info(`<Post:${slug}> deleted by <User:${uid}>`)
  } catch (e: any) {
    ctx.throw(400, e.message)
  }

  ctx.body = {}
}

const postController = {
  preload,
  find,
  findOne,
  create,
  update,
  del,
} as const

export default postController
