import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import * as userController from '../controllers/userController.js'

const router = express.Router()

// 获取用户详情（需要认证）
router.get('/detail', authenticateToken, userController.getUserDetail)

export default router

