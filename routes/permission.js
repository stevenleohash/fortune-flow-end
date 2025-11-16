import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import * as permissionController from '../controllers/permissionController.js'

const router = express.Router()

// 所有路由都需要认证
router.use(authenticateToken)

// 获取角色权限树
router.get('/tree', permissionController.getRolePermissionsTree)

// 验证菜单路径
router.get('/menu/validate', permissionController.validateMenuPath)

export default router

