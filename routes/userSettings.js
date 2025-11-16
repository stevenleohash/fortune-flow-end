import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import * as userSettingsController from '../controllers/userSettingsController.js'

const router = express.Router()

// 获取用户设置（需要认证）
router.get('/', authenticateToken, userSettingsController.getUserSettings)

// 更新用户设置（需要认证）
router.patch('/', authenticateToken, userSettingsController.updateUserSettings)

export default router

