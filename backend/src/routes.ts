import type { HonoEnv } from './types/koa'
import { Hono } from 'hono'

import registerAccountHandlers from './handlers/account'
import registerAdminHandlers from './handlers/admin'
import registerContestHandlers from './handlers/contest'
import registerCourseHandlers from './handlers/course'
import registerDiscussionHandlers from './handlers/discussion'
import registerFileHandlers from './handlers/file'
import registerGroupHandlers from './handlers/group'
import registerOAuthHandlers from './handlers/oauth'
import registerPostHandlers from './handlers/post'
import registerProblemHandlers from './handlers/problem'
import registerSolutionHandlers from './handlers/solution'
import registerTagHandlers from './handlers/tag'
import registerTestcaseHandlers from './handlers/testcase'
import registerUserHandlers from './handlers/user'
import registerUtilsHandlers from './handlers/utils'

const apiApp = new Hono<HonoEnv>()

registerAccountHandlers(apiApp)
registerAdminHandlers(apiApp)
registerContestHandlers(apiApp)
registerCourseHandlers(apiApp)
registerDiscussionHandlers(apiApp)
registerFileHandlers(apiApp)
registerPostHandlers(apiApp)
registerOAuthHandlers(apiApp)
registerProblemHandlers(apiApp)
registerSolutionHandlers(apiApp)
registerTagHandlers(apiApp)
registerGroupHandlers(apiApp)
registerTestcaseHandlers(apiApp)
registerUserHandlers(apiApp)
registerUtilsHandlers(apiApp)

export default apiApp
