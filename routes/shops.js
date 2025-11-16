import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import * as shopController from '../controllers/shopController.js'

const router = express.Router()

// 所有路由都需要认证
router.use(authenticateToken)

// 获取店铺列表
router.get('/', shopController.getShops)

// 获取店铺详情
router.get('/:id', shopController.getShopById)

// 创建店铺
router.post('/', shopController.createShop)

// 更新店铺
router.patch('/:id', shopController.updateShop)

// 删除店铺
router.delete('/:id', shopController.deleteShop)

// 上报 cookies
router.post('/:id/cookies', shopController.reportCookies)

export default router

