import express from 'express'
import permissionRouter from './permission.js'

const router = express.Router()

// 权限相关路由
router.use('/permissions', permissionRouter)

export default router

