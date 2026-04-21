import type { AppContext, HonoEnv } from '../types/koa'
import type { Types } from 'mongoose'
import type { DiscussionQueryFilters } from '../services/discussion'
import { Hono } from 'hono'
import {
  CommentCreatePayloadSchema,
  DiscussionCreatePayloadSchema,
  DiscussionDetailQueryResultSchema,
  DiscussionListQueryResultSchema,
  DiscussionListQuerySchema,
  DiscussionType,
  ErrorCode,
} from '@putongoj/shared'
import { loadProfile, loginRequire } from '../middlewares/authn'
import { commentCreateLimit, discussionCreateLimit } from '../middlewares/ratelimit'
import { loadContestState } from '../policies/contest'
import { loadCourseRoleById } from '../policies/course'
import { loadDiscussion, publicDiscussionTypes } from '../policies/discussion'
import { loadProblemOrThrow } from '../policies/problem'
import discussionService from '../services/discussion'
import { getUser } from '../services/user'
import {
  createEnvelopedResponse,
  createErrorResponse,
  createZodErrorResponse,
} from '../utils'

async function findDiscussions (c: AppContext) {
  const query = DiscussionListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const profile = c.get('profile')
  const { page, pageSize, sort, sortBy, type, author } = query.data

  const queryFilter: DiscussionQueryFilters = {}
  if (type) {
    queryFilter.type = type
  }
  if (author) {
    const authorUser = await getUser(author)
    if (authorUser) {
      queryFilter.author = authorUser._id
    }
  }
  const visibilityFilters: DiscussionQueryFilters[] = [ {
    problem: null,
    contest: null,
    type: { $in: publicDiscussionTypes },
  } ]
  if (profile) {
    visibilityFilters.push({ author: profile._id })
  }
  const filters: DiscussionQueryFilters[] = [ queryFilter ]
  if (!(profile?.isAdmin)) {
    filters.push({ $or: visibilityFilters })
  }

  const discussions = await discussionService.findDiscussions(
    { page, pageSize, sort, sortBy },
    { $and: filters },
    [ 'discussionId', 'author', 'problem', 'contest', 'type', 'pinned', 'title', 'createdAt', 'lastCommentAt', 'comments' ],
    { author: [ 'uid', 'avatar' ], problem: [ 'pid' ], contest: [ 'contestId' ] },
  )
  const result = DiscussionListQueryResultSchema.encode(discussions)
  return createEnvelopedResponse(c, result)
}

async function getDiscussion (c: AppContext) {
  const discussionState = await loadDiscussion(c)
  if (!discussionState) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Discussion not found or access denied')
  }

  const profile = c.get('profile')
  const { discussion, isJury } = discussionState
  const comments = await discussionService.getComments(discussion._id, {
    showHidden: profile?.isAdmin ?? false,
    exceptUsers: profile ? [ profile._id ] : [],
  })
  const result = DiscussionDetailQueryResultSchema.encode({
    ...discussion, comments, isJury,
  })
  return createEnvelopedResponse(c, result)
}

async function createDiscussion (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = DiscussionCreatePayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }

  const profile = await loadProfile(c)
  let isManaged = profile.isAdmin ?? false

  let problem: Types.ObjectId | null = null
  if (payload.data.problem) {
    const problemDoc = await loadProblemOrThrow(c, payload.data.problem, payload.data.contest)

    problem = problemDoc._id
    if (!isManaged && problemDoc.owner?.equals(profile._id) === true) {
      isManaged = true
    }
  }

  let contest: Types.ObjectId | null = null
  if (payload.data.contest) {
    const contestState = await loadContestState(c, payload.data.contest)
    if (!contestState || !contestState.accessible) {
      return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
    }

    contest = contestState.contest._id || null
    if (contestState.contest.course) {
      const role = await loadCourseRoleById(c, contestState.contest.course)
      if (role?.manageContest) {
        isManaged = true
      }
    }
  }

  const { type, title, content } = payload.data
  const author = profile._id

  if (publicDiscussionTypes.includes(type) && !isManaged) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Insufficient privileges to create this type of discussion')
  }

  try {
    const discussion = await discussionService.createDiscussion({
      author, problem, contest, type, title, content,
    })
    c.get('auditLog').info(`<Discussion:${discussion.discussionId}> created by <User:${profile.uid}>`)
    return createEnvelopedResponse(c, { discussionId: discussion.discussionId })
  } catch (err) {
    c.get('auditLog').error('Failed to create discussion', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }
}

async function createComment (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = CommentCreatePayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }

  const discussionState = await loadDiscussion(c)
  if (!discussionState) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Discussion not found or access denied')
  }

  const { discussion, isJury } = discussionState
  const isAnnouncement = discussion.type === DiscussionType.PublicAnnouncement
  const isArchived = discussion.type === DiscussionType.ArchivedDiscussion
  if (isArchived || (isAnnouncement && !isJury)) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Comments are not allowed for this discussion')
  }

  const profile = await loadProfile(c)
  try {
    const comment = await discussionService.createComment(
      discussion._id, { author: profile._id, content: payload.data.content },
    )
    c.get('auditLog').info(`<Comment:${comment.commentId}> created in <Discussion:${discussion.discussionId}> by <User:${profile.uid}>`)
    return createEnvelopedResponse(c, null)
  } catch (err) {
    c.get('auditLog').error('Failed to create comment', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }
}

function registerDiscussionHandlers (app: Hono<HonoEnv>) {
  const discussionApp = new Hono<HonoEnv>()

  discussionApp.get('/', findDiscussions)
  discussionApp.post('/', loginRequire, discussionCreateLimit, createDiscussion)

  discussionApp.get('/:discussionId', getDiscussion)
  discussionApp.post('/:discussionId/comments', loginRequire, commentCreateLimit, createComment)

  app.route('/discussions', discussionApp)
}

export default registerDiscussionHandlers
