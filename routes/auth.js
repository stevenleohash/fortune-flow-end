import express from 'express'
import * as authController from '../controllers/authController.js'

const router = express.Router()

// 登录（不需要认证）
router.post('/login', authController.login)

// 登出（需要认证）
router.post('/logout', authController.logout)

// 刷新 Token（需要认证）
router.get('/refresh/token', authController.refreshToken)

export default router

