import Router from '@koa/router'
import postController from '../controllers/post'
import authnMiddleware from '../middlewares/authn'

const postRouter = new Router({
  prefix: '/post',
})

postRouter.get('/list',
  authnMiddleware.checkSession,
  postController.find,
)
postRouter.get('/:slug',
  authnMiddleware.checkSession,
  postController.preload,
  postController.findOne,
)
postRouter.post('/',
  authnMiddleware.adminRequire,
  postController.create,
)
postRouter.put('/:slug',
  authnMiddleware.adminRequire,
  postController.preload,
  postController.update,
)
postRouter.del('/:slug',
  authnMiddleware.adminRequire,
  postController.preload,
  postController.del,
)

export default postRouter
