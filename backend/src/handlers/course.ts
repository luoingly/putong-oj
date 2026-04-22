import type { Paginated } from '@putongoj/shared'
import type { AppContext, HonoEnv } from '../types/koa'
import type { CourseRole } from '../types'
import type { CourseEntity, CourseEntityItem, CourseEntityPreview, CourseEntityViewWithRole, CourseMemberView } from '../types/entity'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { pick } from 'lodash'
import { adminRequire, loadProfile, loginRequire, rootRequire } from '../middlewares/authn'
import User from '../models/User'
import { loadCourseStateOrThrow } from '../policies/course'
import courseService from '../services/course'
import problemService from '../services/problem'
import { parsePaginateOption, toObjectRecord } from '../utils'
import { encrypt, ERR_INVALID_ID, ERR_NOT_FOUND, ERR_PERM_DENIED } from '../utils/constants'

const findCourses = async (c: AppContext) => {
  const opt = c.req.query()
  const { page, pageSize } = parsePaginateOption(opt, 5, 100)

  const response: Paginated<CourseEntityPreview>
    = await courseService.findCourses({ page, pageSize })
  return c.json(response)
}

const findCourseItems = async (c: AppContext) => {
  const keyword = String(c.req.query('keyword') ?? '').trim()
  const response: CourseEntityItem[]
    = await courseService.findCourseItems(keyword)
  return c.json(response)
}

const getCourse = async (c: AppContext) => {
  const { course, role } = await loadCourseStateOrThrow(c)
  const response: CourseEntityViewWithRole = {
    ...pick(course, [ 'courseId', 'name', 'description', 'encrypt' ]),
    joinCode: role.manageCourse ? course.joinCode : undefined,
    canJoin: (course.joinCode?.length ?? 0) > 0,
    role,
  }

  return c.json(response)
}

const joinCourse = async (c: AppContext) => {
  const opt = toObjectRecord(await c.req.json().catch(() => ({})))
  const { course, role } = await loadCourseStateOrThrow(c)
  const joinCode = String(opt.joinCode ?? '').trim()
  if (!joinCode) {
    throw new HTTPException(400, { message: 'Missing join code' })
  }
  if (course.joinCode.trim() !== joinCode) {
    throw new HTTPException(403, { message: 'Invalid join code' })
  }

  const profile = await loadProfile(c)
  const result = await courseService.updateCourseMember(
    course._id, profile._id,
    { ...role, basic: true },
  )

  const response: { success: boolean } = { success: result }
  return c.json(response)
}

const createCourse = async (c: AppContext) => {
  const opt = toObjectRecord(await c.req.json().catch(() => ({})))
  const profile = await loadProfile(c)
  try {
    const course = await courseService.createCourse({
      name: String(opt.name ?? '').trim(),
      description: String(opt.description ?? '').trim(),
      encrypt: Number(opt.encrypt) === encrypt.Public ? encrypt.Public : encrypt.Private,
    })
    const response: Pick<CourseEntity, 'courseId'>
      = { courseId: course.courseId }
    c.get('auditLog').info(`<Course:${course.courseId}> created by <User:${profile.uid}>`)
    return c.json(response)
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      throw new HTTPException(400, { message: err.message })
    } else {
      throw err
    }
  }
}

const updateCourse = async (c: AppContext) => {
  const { course, role } = await loadCourseStateOrThrow(c)
  if (!role.manageCourse) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const opt = toObjectRecord(await c.req.json().catch(() => ({})))
  const { courseId } = course
  const profile = await loadProfile(c)
  try {
    const course = await courseService.updateCourse(
      courseId,
      {
        name: String(opt.name ?? '').trim(),
        description: String(opt.description ?? '').trim(),
        encrypt: Number(opt.encrypt) === encrypt.Public ? encrypt.Public : encrypt.Private,
        joinCode: String(opt.joinCode ?? '').trim(),
      },
    )
    const response: { success: boolean } = { success: !!course }
    c.get('auditLog').info(`<Course:${courseId}> updated by <User:${profile.uid}>`)
    return c.json(response)
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      throw new HTTPException(400, { message: err.message })
    } else {
      throw err
    }
  }
}

const findCourseMembers = async (c: AppContext) => {
  const { course, role } = await loadCourseStateOrThrow(c)
  if (!role.manageCourse) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const opt = c.req.query()
  const { page, pageSize } = parsePaginateOption(opt, 30, 200)

  const response: Paginated<CourseMemberView>
    = await courseService.findCourseMembers(course._id, { page, pageSize })
  return c.json(response)
}

const getCourseMember = async (c: AppContext) => {
  const { course, role } = await loadCourseStateOrThrow(c)
  if (!role.manageCourse) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { userId } = c.req.param()
  if (!userId) {
    throw new HTTPException(400, { message: 'Missing uid' })
  }

  const member = await courseService.getCourseMember(course._id, userId)
  if (!member) {
    throw new HTTPException(ERR_NOT_FOUND[0] as number as any, { message: ERR_NOT_FOUND[1] as string })
  }

  const response: CourseMemberView = member
  return c.json(response)
}

const updateCourseMember = async (c: AppContext) => {
  const { course, role } = await loadCourseStateOrThrow(c)
  if (!role.manageCourse) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { userId } = c.req.param()
  const body = toObjectRecord(await c.req.json().catch(() => ({})))
  const hasRole = body.role != null
  const newRole = toObjectRecord(body.role) as Record<string, boolean>
  if (!userId || !hasRole) {
    throw new HTTPException(400, { message: 'Missing uid or role' })
  }
  const user = await User.findOne({ uid: userId })
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }
  const profile = await loadProfile(c)
  if (profile.uid === userId) {
    throw new HTTPException(400, { message: 'Cannot change your own role' })
  }

  const roleFields: Array<keyof CourseRole> = [
    'basic',
    'viewTestcase',
    'viewSolution',
    'manageProblem',
    'manageContest',
    'manageCourse',
  ]
  const invalidField = roleFields.find(field => typeof newRole[field] !== 'boolean')
  if (invalidField) {
    throw new HTTPException(400, { message: `Invalid role field: ${invalidField}` })
  }
  if (!newRole.basic) {
    throw new HTTPException(400, { message: 'Basic permission is required, remove member if not needed' })
  }

  const result = await courseService.updateCourseMember(
    course._id,
    user._id,
    {
      basic: newRole.basic,
      viewTestcase: newRole.viewTestcase,
      viewSolution: newRole.viewSolution,
      manageProblem: newRole.manageProblem,
      manageContest: newRole.manageContest,
      manageCourse: newRole.manageCourse,
    },
  )
  c.get('auditLog').info(`<Course:${course.courseId}> member <User:${userId}> updated by <User:${profile.uid}>`)
  const response: { success: boolean } = { success: result }
  return c.json(response)
}

const removeCourseMember = async (c: AppContext) => {
  const { course, role } = await loadCourseStateOrThrow(c)
  if (!role.manageCourse) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { userId } = c.req.param()
  if (!userId) {
    throw new HTTPException(400, { message: 'Missing uid' })
  }
  const profile = await loadProfile(c)
  if (profile.uid === userId) {
    throw new HTTPException(400, { message: 'Cannot remove yourself from the course' })
  }

  const result = await courseService.removeCourseMember(course._id, userId)
  const response: { success: boolean } = { success: result }
  c.get('auditLog').info(`<Course:${course.courseId}> member <User:${userId}> removed by <User:${profile.uid}>`)
  return c.json(response)
}

const addCourseProblems = async (c: AppContext) => {
  const { course } = await loadCourseStateOrThrow(c)
  const body = toObjectRecord(await c.req.json().catch(() => ({})))
  const problemIds = body.problemIds
  if (!Array.isArray(problemIds) || problemIds.length === 0) {
    throw new HTTPException(400, { message: 'problemIds must be a non-empty array' })
  }

  const result = await Promise.all(problemIds.map(async (pid: any) => {
    const problem = await problemService.getProblem(pid)
    if (!problem) {
      return false
    }
    return await courseService.addCourseProblem(course._id, problem._id)
  }))

  const successCount = result.filter(v => v).length
  const response: { success: boolean, added: number } = {
    success: successCount === problemIds.length,
    added: successCount,
  }
  const profile = await loadProfile(c)
  c.get('auditLog').info(`<Course:${course.courseId}> added ${successCount} problems by <User:${profile.uid}>`)
  return c.json(response)
}

const moveCourseProblem = async (c: AppContext) => {
  const { course } = await loadCourseStateOrThrow(c)
  const body = toObjectRecord(await c.req.json().catch(() => ({})))
  const beforePos = Number(body.beforePos ?? 1)
  const problemId = c.req.param('problemId')
  const problem = await problemService.getProblem(problemId)
  if (!problem) {
    throw new HTTPException(ERR_INVALID_ID[0] as number as any, { message: ERR_INVALID_ID[1] as string })
  }
  const result = await courseService.moveCourseProblem(
    course._id, problem._id, beforePos,
  )
  return c.json({ success: result })
}

const rearrangeCourseProblem = async (c: AppContext) => {
  const { course } = await loadCourseStateOrThrow(c)
  try {
    await courseService.rearrangeCourseProblem(course._id)
    return c.json({ success: true })
  } catch (e: any) {
    throw new HTTPException(500, { message: `Failed to rearrange course problems: ${e.message}` })
  }
}

const removeCourseProblem = async (c: AppContext) => {
  const { course } = await loadCourseStateOrThrow(c)
  const problemId = c.req.param('problemId')
  const problem = await problemService.getProblem(problemId)
  if (!problem) {
    throw new HTTPException(ERR_INVALID_ID[0] as number as any, { message: ERR_INVALID_ID[1] as string })
  }
  const result = await courseService.removeCourseProblem(course._id, problem._id)
  const profile = await loadProfile(c)
  c.get('auditLog').info(`<Course:${course.courseId}> removed <Problem:${problemId}> by <User:${profile.uid}>`)
  return c.json({ success: result })
}

function registerCourseHandlers (app: Hono<HonoEnv>) {
  const courseApp = new Hono<HonoEnv>()

  courseApp.get('/', findCourses)
  courseApp.get('/items', loginRequire, findCourseItems)
  courseApp.post('/', rootRequire, createCourse)
  courseApp.get('/:courseId', loginRequire, getCourse)
  courseApp.post('/:courseId', loginRequire, joinCourse)
  courseApp.put('/:courseId', loginRequire, updateCourse)
  courseApp.get('/:courseId/member', loginRequire, findCourseMembers)
  courseApp.get('/:courseId/member/:userId', loginRequire, getCourseMember)
  courseApp.post('/:courseId/member/:userId', loginRequire, updateCourseMember)
  courseApp.delete('/:courseId/member/:userId', loginRequire, removeCourseMember)
  courseApp.post('/:courseId/problem', adminRequire, addCourseProblems)
  courseApp.put('/:courseId/problem/:problemId', adminRequire, moveCourseProblem)
  courseApp.post('/:courseId/problem/rearrange', rootRequire, rearrangeCourseProblem)
  courseApp.delete('/:courseId/problem/:problemId', adminRequire, removeCourseProblem)

  app.route('/course', courseApp)
}

export default registerCourseHandlers
