import Router from '@koa/router'
import fileController from '../controllers/file'
import authnMiddleware from '../middlewares/authn'

const fileRouter = new Router({
  prefix: '/files',
})

fileRouter.get('/',
  authnMiddleware.loginRequire,
  fileController.findFiles,
)
fileRouter.delete('/:storageKey',
  authnMiddleware.loginRequire,
  fileController.removeFile,
)

export default fileRouter
