import type { Paginated } from '@putongoj/shared'
import type { Types } from 'mongoose'
import type { DiscussionQueryFilters } from '../services/discussion'
import type { WithId } from '../types'
import type { CourseEntity, ProblemEntity, ProblemEntityItem, ProblemEntityPreview, ProblemEntityView } from '../types/entity'
import type { AppContext, HonoEnv } from '../types/koa'
import {
  DiscussionListQueryResultSchema,
  DiscussionListQuerySchema,
  JudgeStatus,
  ProblemSolutionListQueryResultSchema,
  ProblemSolutionListQuerySchema,
  ProblemStatisticsQueryResultSchema,
} from '@putongoj/shared'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { pick } from 'lodash'
import { loadProfile, loginRequire, rootRequire } from '../middlewares/authn'
import Solution from '../models/Solution'
import User from '../models/User'
import { loadCourseStateOrThrow } from '../policies/course'
import { publicDiscussionTypes } from '../policies/discussion'
import { loadProblemOrThrow } from '../policies/problem'
import courseService from '../services/course'
import discussionService from '../services/discussion'
import problemService from '../services/problem'
import solutionService from '../services/solution'
import tagService from '../services/tag'
import { getUser } from '../services/user'
import { createEnvelopedResponse, createZodErrorResponse, parsePaginateOption, toObjectRecord } from '../utils'
import { ERR_PERM_DENIED, problemType, status } from '../utils/constants'

/*
 * Some temporary helper functions, to be removed after use zod schema for request body validation.
 */

function toNumberOrDefault (value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toStringOrDefault (value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toProblemStatus (
  value: unknown,
  fallback: typeof status[keyof typeof status],
): typeof status[keyof typeof status] {
  const parsed = Number(value)
  return (parsed === status.Reserve || parsed === status.Available)
    ? parsed
    : fallback
}

function toProblemType (
  value: unknown,
  fallback: typeof problemType[keyof typeof problemType],
): typeof problemType[keyof typeof problemType] {
  const parsed = Number(value)
  return (parsed === problemType.Traditional
    || parsed === problemType.Interaction
    || parsed === problemType.SpecialJudge)
    ? parsed
    : fallback
}

const findProblems = async (c: AppContext) => {
  const opt = c.req.query()
  const profile = c.get('profile')
  const showReserved: boolean = !!profile?.isAdmin

  /** @todo [ TO BE DEPRECATED ] 要有专门的 Endpoint 来获取所有题目 */
  if (Number(opt.page) === -1 && profile?.isAdmin) {
    const docs = await problemService.getProblemItems()
    return c.json({ list: { docs, total: docs.length }, solved: [] })
  }

  let courseDocId: Types.ObjectId | undefined
  if (typeof opt.course === 'string') {
    const { course, role } = await loadCourseStateOrThrow(c, opt.course)
    if (!role.basic) {
      throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
    }
    courseDocId = course._id
  }

  const paginateOption = parsePaginateOption(opt, 30, 100)
  const filterOption = {
    type: typeof opt.type === 'string' ? opt.type : undefined,
    content: typeof opt.content === 'string' ? opt.content : undefined,
  }

  let list: Paginated<ProblemEntityPreview & { owner?: Types.ObjectId | null }>
  if (courseDocId) {
    list = await problemService.findCourseProblems(
      courseDocId,
      {
        ...paginateOption,
        ...filterOption,
      },
    )
  } else {
    list = await problemService.findProblems(
      {
        ...paginateOption,
        ...filterOption,
        showReserved,
        includeOwner: profile?._id ?? null,
      },
    )
  }
  list.docs = list.docs.map(doc => ({
    ...doc,
    isOwner: profile?._id && doc.owner
      ? doc.owner.equals(profile._id)
      : false,
    owner: undefined,
  }))

  let solved: number[] = []
  if (profile && list.total > 0) {
    solved = await Solution
      .find({
        uid: profile.uid,
        pid: { $in: list.docs.map(p => p.pid) },
        judge: JudgeStatus.Accepted,
      })
      .distinct('pid')
      .lean()
  }

  return c.json({ list, solved } as {
    list: Paginated<ProblemEntityPreview>
    solved: number[]
  })
}

const findProblemItems = async (c: AppContext) => {
  const opt = c.req.query()
  const profile = await loadProfile(c)

  let courseDocId: Types.ObjectId | undefined
  if (typeof opt.course === 'string') {
    const { course, role } = await loadCourseStateOrThrow(c, opt.course)
    if (!role.manageContest) {
      throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
    }
    courseDocId = course._id
  }

  if (!courseDocId && !profile.isAdmin) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const keyword = String(opt.keyword).trim()
  let response: ProblemEntityItem[] | undefined

  if (courseDocId) {
    response = await problemService.findCourseProblemItems(
      courseDocId, keyword,
    )
  } else {
    response = await problemService.findProblemItems(keyword)
  }

  return c.json(response)
}

const getProblem = async (c: AppContext) => {
  const problem = await loadProblemOrThrow(c)
  const profile = c.get('profile')

  const isOwner = (profile?._id && problem.owner)
    ? problem.owner.equals(profile._id)
    : false
  const canManage = profile?.isAdmin ?? isOwner

  const response: ProblemEntityView = {
    ...pick(problem, [ 'pid', 'title', 'time', 'memory', 'status',
      'description', 'input', 'output', 'in', 'out', 'hint' ]),
    type: canManage ? problem.type : undefined,
    code: canManage ? problem.code : undefined,
    tags: problem.tags.map(tag => ({
      tagId: tag.tagId,
      name: tag.name,
      color: tag.color,
    })),
    isOwner,
  }
  return c.json(response)
}

const createProblem = async (c: AppContext) => {
  const opt = toObjectRecord(await c.req.json().catch(() => ({})))
  const profile = await loadProfile(c)
  const courseInput = (typeof opt.course === 'string' || typeof opt.course === 'number')
    ? opt.course
    : undefined
  const hasPermission = async (): Promise<boolean> => {
    if (profile.isAdmin) {
      return true
    }
    if (courseInput != null) {
      const { role } = await loadCourseStateOrThrow(c, courseInput)
      return role.manageProblem
    }
    return false
  }
  if (!await hasPermission()) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const owner = profile._id
  let course: WithId<CourseEntity> | undefined
  if (courseInput != null) {
    course = (await loadCourseStateOrThrow(c, courseInput)).course
  }

  try {
    const problem = await problemService.createProblem({
      title: toStringOrDefault(opt.title),
      time: toNumberOrDefault(opt.time, 1000),
      memory: toNumberOrDefault(opt.memory, 32768),
      status: toProblemStatus(opt.status, status.Reserve),
      description: toStringOrDefault(opt.description),
      input: toStringOrDefault(opt.input),
      output: toStringOrDefault(opt.output),
      in: toStringOrDefault(opt.in),
      out: toStringOrDefault(opt.out),
      hint: toStringOrDefault(opt.hint),
      type: toProblemType(opt.type, problemType.Traditional),
      code: toStringOrDefault(opt.code),
      owner,
    })
    if (course) {
      await courseService.addCourseProblem(course._id, problem._id)
    }
    c.get('auditLog').info(`<Problem:${problem.pid}> created by <User:${profile.uid}>`)
    const response: Pick<ProblemEntity, 'pid'>
      = pick(problem, [ 'pid' ])
    return c.json(response)
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      throw new HTTPException(400, { message: err.message })
    } else {
      throw err
    }
  }
}

const updateProblem = async (c: AppContext) => {
  const opt = toObjectRecord(await c.req.json().catch(() => ({})))
  const problem = await loadProblemOrThrow(c)
  const profile = await loadProfile(c)
  let canManage = profile?.isAdmin ?? false
  if (profile && !canManage && problem.owner) {
    const owner = await User.findById(problem.owner).lean()
    if (owner && owner.uid === profile.uid) {
      canManage = true
    }
  }
  if (!canManage) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const pid = problem.pid
  const uid = profile.uid
  try {
    const problem = await problemService.updateProblem(pid, {
      title: typeof opt.title === 'string' ? opt.title : undefined,
      time: Number.isFinite(Number(opt.time)) ? Number(opt.time) : undefined,
      memory: Number.isFinite(Number(opt.memory)) ? Number(opt.memory) : undefined,
      status: opt.status == null ? undefined : toProblemStatus(opt.status, status.Reserve),
      description: typeof opt.description === 'string' ? opt.description : undefined,
      input: typeof opt.input === 'string' ? opt.input : undefined,
      output: typeof opt.output === 'string' ? opt.output : undefined,
      in: typeof opt.in === 'string' ? opt.in : undefined,
      out: typeof opt.out === 'string' ? opt.out : undefined,
      hint: typeof opt.hint === 'string' ? opt.hint : undefined,
      type: opt.type == null ? undefined : toProblemType(opt.type, problemType.Traditional),
      code: typeof opt.code === 'string' ? opt.code : undefined,
      tags: Array.isArray(opt.tags)
        ? await tagService.getTagObjectIds(
            opt.tags.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0),
          )
        : undefined,
    })
    c.get('auditLog').info(`<Problem:${pid}> updated by <User:${uid}>`)
    const response: Pick<ProblemEntity, 'pid'> & { success: boolean }
      = { pid: problem?.pid ?? -1, success: !!problem }
    return c.json(response)
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      throw new HTTPException(400, { message: err.message })
    } else {
      throw err
    }
  }
}

const removeProblem = async (c: AppContext) => {
  const pid = c.req.param('pid')
  const profile = await loadProfile(c)

  try {
    await problemService.removeProblem(Number(pid))
    c.get('auditLog').info(`<Problem:${pid}> removed by <User:${profile.uid}>`)
  } catch (e: any) {
    throw new HTTPException(400, { message: e.message })
  }
  return c.json({})
}

const getStatistics = async (c: AppContext) => {
  const problem = await loadProblemOrThrow(c)
  const statistics = await problemService.getStatistics(problem._id)
  const result = ProblemStatisticsQueryResultSchema.encode(statistics)
  return createEnvelopedResponse(c, result)
}

export async function findSolutions (c: AppContext) {
  const query = ProblemSolutionListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const problem = await loadProblemOrThrow(c)
  const solutions = await solutionService.findSolutions({
    ...query.data,
    problem: problem.pid,
  })
  const result = ProblemSolutionListQueryResultSchema.encode(solutions)
  return createEnvelopedResponse(c, result)
}

export async function findProblemDiscussions (c: AppContext) {
  const problem = await loadProblemOrThrow(c)
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

  const filters: DiscussionQueryFilters[] = [
    { problem: problem._id, contest: null }, queryFilter,
  ]
  if (!(profile?.isAdmin)) {
    const visibilityFilters: DiscussionQueryFilters[] = [ {
      type: { $in: publicDiscussionTypes },
    } ]
    if (profile) {
      visibilityFilters.push({ author: profile._id })
    }
    filters.push({ $or: visibilityFilters })
  }

  const discussions = await discussionService.findDiscussions(
    { page, pageSize, sort, sortBy },
    { $and: filters },
    [ 'discussionId', 'author', 'type', 'pinned', 'title', 'createdAt', 'lastCommentAt', 'comments' ],
    { author: [ 'uid', 'avatar' ] },
  )
  const result = DiscussionListQueryResultSchema.encode({
    ...discussions,
    docs: discussions.docs.map(discussion => ({
      ...discussion, contest: null, problem: { pid: problem.pid },
    })),
  })
  return createEnvelopedResponse(c, result)
}

function registerProblemHandlers (app: Hono<HonoEnv>) {
  const problemApp = new Hono<HonoEnv>()

  problemApp.get('/', findProblems)
  problemApp.get('/items', loginRequire, findProblemItems)
  problemApp.post('/', loginRequire, createProblem)

  problemApp.get('/:pid', getProblem)
  problemApp.put('/:pid', loginRequire, updateProblem)
  problemApp.delete('/:pid', rootRequire, removeProblem)

  problemApp.get('/:pid/statistics', loginRequire, getStatistics)
  problemApp.get('/:pid/solutions', loginRequire, findSolutions)

  problemApp.get('/:pid/discussions', findProblemDiscussions)

  app.route('/problem', problemApp)
}

export default registerProblemHandlers
