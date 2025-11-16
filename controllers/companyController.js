import { ObjectId } from 'mongodb'
import { getDatabase } from '../config/database.js'
import { successResponse, errorResponse } from '../utils/response.js'

/**
 * 获取公司主体列表
 */
export async function getCompanies(req, res) {
  try {
    const db = getDatabase()
    const companiesCollection = db.collection('companies')

    const {
      page = 1,
      pageNo = 1,
      pageSize = 10,
      keyword = '',
    } = req.query

    // 支持 page 和 pageNo 两种参数名
    const pageNum = parseInt(pageNo || page)
    const size = parseInt(pageSize)
    const skip = (pageNum - 1) * size

    // 构建查询条件
    const query = {}
    if (keyword) {
      query.$or = [
        { companyName: { $regex: keyword, $options: 'i' } },
        { businessLicense: { $regex: keyword, $options: 'i' } },
      ]
    }

    // 查询总数
    const total = await companiesCollection.countDocuments(query)

    // 查询列表
    const companies = await companiesCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .toArray()

    // 转换 _id 为字符串
    const result = companies.map(company => ({
      id: company._id.toString(),
      companyName: company.companyName,
      businessLicense: company.businessLicense || '',
      remark: company.remark || '',
      status: company.status !== undefined ? company.status : true,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    }))

    res.json(successResponse({
      pageData: result,
      total,
      page: pageNum,
      pageSize: size,
    }))
  } catch (error) {
    console.error('获取公司主体列表错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 获取公司主体详情
 */
export async function getCompanyById(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的公司主体ID', 400))
    }

    const db = getDatabase()
    const companiesCollection = db.collection('companies')

    const company = await companiesCollection.findOne({ _id: new ObjectId(id) })

    if (!company) {
      return res.status(404).json(errorResponse('公司主体不存在', 404))
    }

    const result = {
      id: company._id.toString(),
      companyName: company.companyName,
      businessLicense: company.businessLicense || '',
      remark: company.remark || '',
      status: company.status !== undefined ? company.status : true,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    }

    res.json(successResponse(result))
  } catch (error) {
    console.error('获取公司主体详情错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 创建公司主体
 */
export async function createCompany(req, res) {
  try {
    const {
      companyName,
      businessLicense,
      remark,
    } = req.body

    if (!companyName) {
      return res.status(400).json(errorResponse('公司名称不能为空', 400))
    }

    const db = getDatabase()
    const companiesCollection = db.collection('companies')

    // 检查公司名称是否重复
    const existingByName = await companiesCollection.findOne({ companyName })
    if (existingByName) {
      return res.status(400).json(errorResponse(`公司名称"${companyName}"已存在，不能重复添加`, 400))
    }

    // 检查营业执照号是否重复
    if (businessLicense) {
      const existing = await companiesCollection.findOne({ businessLicense })
      if (existing) {
        return res.status(400).json(errorResponse('营业执照号已存在', 400))
      }
    }

    const now = new Date()
    const userId = req.user?.userId || null

    const company = {
      companyName,
      businessLicense: businessLicense || null,
      remark: remark || null,
      status: true, // 默认启用
      createdAt: now,
      updatedAt: now,
      createdBy: userId ? new ObjectId(userId) : null,
      updatedBy: userId ? new ObjectId(userId) : null,
    }

    const result = await companiesCollection.insertOne(company)

    res.status(201).json(successResponse({
      id: result.insertedId.toString(),
    }, '公司主体创建成功'))
  } catch (error) {
    console.error('创建公司主体错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 更新公司主体
 */
export async function updateCompany(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的公司主体ID', 400))
    }

    const {
      companyName,
      businessLicense,
      remark,
      status,
    } = req.body

    const db = getDatabase()
    const companiesCollection = db.collection('companies')

    // 检查公司是否存在
    const existing = await companiesCollection.findOne({ _id: new ObjectId(id) })
    if (!existing) {
      return res.status(404).json(errorResponse('公司主体不存在', 404))
    }

    // 检查公司名称是否重复（排除自己）
    if (companyName && companyName !== existing.companyName) {
      const duplicateByName = await companiesCollection.findOne({
        companyName,
        _id: { $ne: new ObjectId(id) }, // 排除当前公司
      })
      if (duplicateByName) {
        return res.status(400).json(errorResponse(`公司名称"${companyName}"已存在，不能重复添加`, 400))
      }
    }

    // 检查营业执照号是否重复（排除自己）
    if (businessLicense && businessLicense !== existing.businessLicense) {
      const duplicate = await companiesCollection.findOne({ businessLicense })
      if (duplicate) {
        return res.status(400).json(errorResponse('营业执照号已存在', 400))
      }
    }

    const updateData = {
      updatedAt: new Date(),
      updatedBy: req.user?.userId ? new ObjectId(req.user.userId) : null,
    }

    if (companyName !== undefined) updateData.companyName = companyName
    if (businessLicense !== undefined) updateData.businessLicense = businessLicense || null
    if (remark !== undefined) updateData.remark = remark || null
    if (status !== undefined) updateData.status = status

    await companiesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    )

    res.json(successResponse(null, '公司主体更新成功'))
  } catch (error) {
    console.error('更新公司主体错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 删除公司主体
 */
export async function deleteCompany(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的公司主体ID', 400))
    }

    const db = getDatabase()
    const companiesCollection = db.collection('companies')
    const shopsCollection = db.collection('shops')

    // 检查公司是否存在
    const company = await companiesCollection.findOne({ _id: new ObjectId(id) })
    if (!company) {
      return res.status(404).json(errorResponse('公司主体不存在', 404))
    }

    // 查找所有关联的店铺，移除它们的 companyId（即移除营业执照号关联）
    const shopCount = await shopsCollection.countDocuments({ companyId: new ObjectId(id) })
    if (shopCount > 0) {
      // 移除所有关联店铺的 companyId
      const updateResult = await shopsCollection.updateMany(
        { companyId: new ObjectId(id) },
        {
          $unset: { companyId: '' },
          $set: { updatedAt: new Date() },
        }
      )
      console.log(`[删除公司主体] 已移除 ${updateResult.modifiedCount} 个店铺的营业执照号关联`)
    }

    // 删除公司主体
    await companiesCollection.deleteOne({ _id: new ObjectId(id) })

    res.json(successResponse(null, '公司主体删除成功'))
  } catch (error) {
    console.error('删除公司主体错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 获取公司主体下的店铺列表
 */
export async function getCompanyShops(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的公司主体ID', 400))
    }

    const db = getDatabase()
    const shopsCollection = db.collection('shops')

    const shops = await shopsCollection
      .find({ companyId: new ObjectId(id) })
      .sort({ createdAt: -1 })
      .toArray()

    const result = shops.map(shop => ({
      id: shop._id.toString(),
      shopId: shop.shopId,
      shopName: shop.shopName,
      companyId: shop.companyId.toString(),
      shopType: shop.shopType || '',
      platform: shop.platform || '',
      status: shop.status !== undefined ? shop.status : true,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    }))

    res.json(successResponse(result))
  } catch (error) {
    console.error('获取公司主体店铺列表错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

