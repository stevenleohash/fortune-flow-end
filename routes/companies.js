import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import * as companyController from '../controllers/companyController.js'

const router = express.Router()

// 所有路由都需要认证
router.use(authenticateToken)

// 获取公司主体列表
router.get('/', companyController.getCompanies)

// 获取公司主体详情
router.get('/:id', companyController.getCompanyById)

// 创建公司主体
router.post('/', companyController.createCompany)

// 更新公司主体
router.patch('/:id', companyController.updateCompany)

// 删除公司主体
router.delete('/:id', companyController.deleteCompany)

// 获取公司主体下的店铺列表
router.get('/:id/shops', companyController.getCompanyShops)

export default router

