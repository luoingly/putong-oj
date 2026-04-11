import { z } from 'zod'
import { PostModelSchema } from '../model/index.js'
import { PaginatedSchema, PaginationSchema } from './utils.js'

export const PostListQuerySchema = z.object({
  page: PaginationSchema.shape.page,
  pageSize: PaginationSchema.shape.pageSize.default(10),
})

export type PostListQuery = z.infer<typeof PostListQuerySchema>

export const PostListQueryResultSchema = PaginatedSchema(z.object({
  slug: PostModelSchema.shape.slug,
  title: PostModelSchema.shape.title,
  isPublished: PostModelSchema.shape.isPublished,
  isPinned: PostModelSchema.shape.isPinned,
  isHidden: PostModelSchema.shape.isHidden,
  createdAt: PostModelSchema.shape.createdAt,
  updatedAt: PostModelSchema.shape.updatedAt,
}))

export type PostListQueryResult = z.input<typeof PostListQueryResultSchema>

export const PostDetailQueryResultSchema = z.object({
  slug: PostModelSchema.shape.slug,
  title: PostModelSchema.shape.title,
  content: PostModelSchema.shape.content,
  isPublished: PostModelSchema.shape.isPublished,
  isPinned: PostModelSchema.shape.isPinned,
  isHidden: PostModelSchema.shape.isHidden,
  createdAt: PostModelSchema.shape.createdAt,
  updatedAt: PostModelSchema.shape.updatedAt,
})

export type PostDetailQueryResult = z.input<typeof PostDetailQueryResultSchema>

export const PostCreatePayloadSchema = z.object({
  title: PostModelSchema.shape.title,
})

export type PostCreatePayload = z.infer<typeof PostCreatePayloadSchema>

export const PostUpdatePayloadSchema = z.object({
  title: PostModelSchema.shape.title.optional(),
  content: PostModelSchema.shape.content.optional(),
  slug: PostModelSchema.shape.slug.optional(),
  isPublished: PostModelSchema.shape.isPublished.optional(),
  isPinned: PostModelSchema.shape.isPinned.optional(),
  isHidden: PostModelSchema.shape.isHidden.optional(),
})

export type PostUpdatePayload = z.infer<typeof PostUpdatePayloadSchema>
