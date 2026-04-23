import type { Types } from 'mongoose'
import type { CourseRole, WithId } from '../types'
import type { CourseEntity } from '../types/entity'
import type { AppContext } from '../types/koa'
import { HTTPException } from 'hono/http-exception'
import Course from '../models/Course'
import courseService from '../services/course'
import { ERR_NOT_FOUND } from '../utils/constants'

export interface CourseState {
  course: WithId<CourseEntity>
  role: CourseRole
}

async function _loadCourseState (c: AppContext, query: { _id: Types.ObjectId } | { courseId: number }) {
  const course = await Course.findOne(query).lean()
  if (!course) {
    return null
  }

  const profile = c.get('profile')
  const role = await courseService.getUserRole(profile, course)
  const state: CourseState = { course, role }

  c.set('course', state)
  return state
}

export async function loadCourseState (c: AppContext, inputId?: number | string) {
  const courseId = Number(inputId ?? c.req.param('courseId'))
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return null
  }
  if (c.get('course')?.course.courseId === courseId) {
    return c.get('course')!
  }
  return await _loadCourseState(c, { courseId })
}

export async function loadCourseStateById (c: AppContext, objectId: Types.ObjectId | null) {
  if (!objectId) {
    return null
  }
  if (c.get('course')?.course._id.equals(objectId)) {
    return c.get('course')!
  }
  return await _loadCourseState(c, { _id: objectId })
}

export async function loadCourseById (c: AppContext, objectId: Types.ObjectId | null) {
  const state = await loadCourseStateById(c, objectId)
  return state?.course ?? null
}

export async function loadCourseRoleById (c: AppContext, objectId: Types.ObjectId | null) {
  const state = await loadCourseStateById(c, objectId)
  return state?.role ?? null
}

/**
 * @deprecated Controller should handle error throwing
 */
export async function loadCourseStateOrThrow (c: AppContext, inputId?: number | string) {
  const state = await loadCourseState(c, inputId)
  if (!state) {
    throw new HTTPException(ERR_NOT_FOUND[0] as any, { message: ERR_NOT_FOUND[1] })
  }
  return state
}
