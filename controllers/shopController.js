import { ObjectId } from 'mongodb'
import { getDatabase } from '../config/database.js'
import { successResponse, errorResponse } from '../utils/response.js'

/**
 * 获取店铺列表
 */
export async function getShops(req, res) {
  try {
    const db = getDatabase()
    const shopsCollection = db.collection('shops')

    const {
      page = 1,
      pageNo = 1,
      pageSize = 10,
      keyword = '',
      companyId = '',
      shopType = '',
    } = req.query

    // 支持 page 和 pageNo 两种参数名
    const pageNum = parseInt(pageNo || page)
    const size = parseInt(pageSize)
    const skip = (pageNum - 1) * size

    // 构建查询条件
    const query = {}
    if (keyword) {
      query.$or = [
        { shopId: { $regex: keyword, $options: 'i' } },
        { shopName: { $regex: keyword, $options: 'i' } },
      ]
    }
    if (req.query.businessLicense) {
      // 根据营业执照号查找公司主体，然后查询店铺
      const companiesCollection = db.collection('companies')
      const company = await companiesCollection.findOne({
        businessLicense: { $regex: req.query.businessLicense, $options: 'i' },
      })
      if (company) {
        query.companyId = company._id
      }
      else {
        // 如果找不到公司主体，返回空结果（使用一个不存在的 ObjectId）
        query.companyId = new ObjectId('000000000000000000000000')
      }
    }
    if (req.query.platform) {
      query.platform = req.query.platform
    }

    // 查询总数
    const total = await shopsCollection.countDocuments(query)

    // 查询列表
    const shops = await shopsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .toArray()

    // 获取公司主体信息
    const companiesCollection = db.collection('companies')
    // 过滤掉 companyId 为 null 的店铺
    const companyIds = [...new Set(shops.filter(shop => shop.companyId).map(shop => shop.companyId.toString()))]
    const companies = companyIds.length > 0
      ? await companiesCollection
          .find({ _id: { $in: companyIds.map(id => new ObjectId(id)) } })
          .toArray()
      : []
    const companyMap = {}
    companies.forEach(company => {
      companyMap[company._id.toString()] = company.businessLicense || ''
    })

    // 转换 _id 为字符串
    const result = shops.map(shop => ({
      id: shop._id.toString(),
      shopId: shop.shopId,
      shopName: shop.shopName,
      companyId: shop.companyId ? shop.companyId.toString() : null,
      businessLicense: shop.companyId ? (companyMap[shop.companyId.toString()] || '') : '',
      platform: shop.platform || '',
      status: shop.status !== undefined ? shop.status : true,
      remark: shop.remark || '',
      homeUrl: shop.homeUrl || null,
      loginUrl: shop.loginUrl || null,
      cookies: shop.cookies || null,
      browserConfig: shop.browserConfig || null,
      autoConfig: shop.autoConfig || null,
      cookiesUpdatedAt: shop.cookiesUpdatedAt || null,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    }))

    res.json(successResponse({
      pageData: result,
      total,
      page: pageNum,
      pageSize: size,
    }))
  } catch (error) {
    console.error('获取店铺列表错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 获取店铺详情
 */
export async function getShopById(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的店铺ID', 400))
    }

    const db = getDatabase()
    const shopsCollection = db.collection('shops')

    const shop = await shopsCollection.findOne({ _id: new ObjectId(id) })

    if (!shop) {
      return res.status(404).json(errorResponse('店铺不存在', 404))
    }

    // 获取公司主体信息
    let businessLicense = ''
    if (shop.companyId) {
      const companiesCollection = db.collection('companies')
      const company = await companiesCollection.findOne({ _id: shop.companyId })
      if (company) {
        businessLicense = company.businessLicense || ''
      }
    }

    const result = {
      id: shop._id.toString(),
      shopId: shop.shopId,
      shopName: shop.shopName,
      companyId: shop.companyId ? shop.companyId.toString() : null,
      businessLicense,
      platform: shop.platform || '',
      status: shop.status !== undefined ? shop.status : true,
      remark: shop.remark || '',
      homeUrl: shop.homeUrl || null,
      loginUrl: shop.loginUrl || null,
      cookies: shop.cookies || null,
      browserConfig: shop.browserConfig || null,
      autoConfig: shop.autoConfig || null,
      cookiesUpdatedAt: shop.cookiesUpdatedAt || null,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    }

    res.json(successResponse(result))
  } catch (error) {
    console.error('获取店铺详情错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 创建店铺
 */
export async function createShop(req, res) {
  try {
    const {
      shopName,
      businessLicense,
      platform,
      status = true,
      remark,
      homeUrl,
      loginUrl,
      autoConfig,
      browserConfig,
    } = req.body

    if (!shopName) {
      return res.status(400).json(errorResponse('店铺名称不能为空', 400))
    }
    if (!businessLicense) {
      return res.status(400).json(errorResponse('营业执照号不能为空', 400))
    }
    if (!platform) {
      return res.status(400).json(errorResponse('平台不能为空', 400))
    }

    // 验证平台值是否有效
    const validPlatforms = ['douyin', 'taobao', 'jd', 'pdd']
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json(errorResponse('无效的平台类型', 400))
    }

    const db = getDatabase()
    const shopsCollection = db.collection('shops')
    const companiesCollection = db.collection('companies')

    // 根据营业执照号查找公司主体
    const company = await companiesCollection.findOne({ businessLicense })
    if (!company) {
      return res.status(404).json(errorResponse('营业执照号对应的公司主体不存在', 404))
    }

    const now = new Date()
    const userId = req.user?.userId || null

    // 生成店铺ID（使用 MongoDB ObjectId 转字符串）
    const shopId = new ObjectId().toString()

    // 移除 browserConfig 中的 headless 字段（如果存在）
    let cleanBrowserConfig = null
    if (browserConfig && typeof browserConfig === 'object') {
      const { headless, ...rest } = browserConfig
      cleanBrowserConfig = Object.keys(rest).length > 0 ? rest : null
    }

    const shop = {
      shopId,
      shopName,
      companyId: company._id,
      platform: platform || 'douyin',
      status: status !== undefined ? status : true,
      remark: remark || null,
      homeUrl: homeUrl || null,
      loginUrl: loginUrl || null,
      cookies: null,
      browserConfig: cleanBrowserConfig,
      autoConfig: autoConfig || null,
      createdAt: now,
      updatedAt: now,
      createdBy: userId ? new ObjectId(userId) : null,
      updatedBy: userId ? new ObjectId(userId) : null,
    }

    const result = await shopsCollection.insertOne(shop)

    res.status(201).json(successResponse({
      id: result.insertedId.toString(),
    }, '店铺创建成功'))
  } catch (error) {
    console.error('创建店铺错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 更新店铺
 */
export async function updateShop(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的店铺ID', 400))
    }

    const {
      shopName,
      businessLicense,
      platform,
      status,
      remark,
      homeUrl,
      loginUrl,
      autoConfig,
      browserConfig,
    } = req.body

    const db = getDatabase()
    const shopsCollection = db.collection('shops')
    const companiesCollection = db.collection('companies')

    // 检查店铺是否存在
    const existing = await shopsCollection.findOne({ _id: new ObjectId(id) })
    if (!existing) {
      return res.status(404).json(errorResponse('店铺不存在', 404))
    }

    // 如果提供了营业执照号，检查公司主体是否存在
    let companyId = existing.companyId
    if (businessLicense) {
      const company = await companiesCollection.findOne({ businessLicense })
      if (!company) {
        return res.status(404).json(errorResponse('营业执照号对应的公司主体不存在', 404))
      }
      companyId = company._id
    }

    // 验证平台值是否有效
    if (platform !== undefined) {
      const validPlatforms = ['douyin', 'taobao', 'jd', 'pdd']
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json(errorResponse('无效的平台类型', 400))
      }
    }

    const updateData = {
      updatedAt: new Date(),
      updatedBy: req.user?.userId ? new ObjectId(req.user.userId) : null,
    }

    if (shopName !== undefined) updateData.shopName = shopName
    if (businessLicense !== undefined) updateData.companyId = companyId
    if (platform !== undefined) updateData.platform = platform
    if (status !== undefined) updateData.status = status
    if (remark !== undefined) updateData.remark = remark || null
    if (homeUrl !== undefined) updateData.homeUrl = homeUrl || null
    if (loginUrl !== undefined) updateData.loginUrl = loginUrl || null
    if (autoConfig !== undefined) updateData.autoConfig = autoConfig || null
    
    // 处理 browserConfig，移除 headless 字段
    if (browserConfig !== undefined) {
      if (browserConfig && typeof browserConfig === 'object') {
        const { headless, ...rest } = browserConfig
        updateData.browserConfig = Object.keys(rest).length > 0 ? rest : null
      }
      else {
        updateData.browserConfig = browserConfig
      }
    }

    await shopsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    )

    res.json(successResponse(null, '店铺更新成功'))
  } catch (error) {
    console.error('更新店铺错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 删除店铺
 */
export async function deleteShop(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的店铺ID', 400))
    }

    const db = getDatabase()
    const shopsCollection = db.collection('shops')

    // 检查店铺是否存在
    const shop = await shopsCollection.findOne({ _id: new ObjectId(id) })
    if (!shop) {
      return res.status(404).json(errorResponse('店铺不存在', 404))
    }

    await shopsCollection.deleteOne({ _id: new ObjectId(id) })

    res.json(successResponse(null, '店铺删除成功'))
  } catch (error) {
    console.error('删除店铺错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 上报 cookies
 */
export async function reportCookies(req, res) {
  try {
    const { id } = req.params
    const { cookies } = req.body

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的店铺ID', 400))
    }

    if (!cookies) {
      return res.status(400).json(errorResponse('cookies 不能为空', 400))
    }

    const db = getDatabase()
    const shopsCollection = db.collection('shops')

    // 检查店铺是否存在
    const shop = await shopsCollection.findOne({ _id: new ObjectId(id) })
    if (!shop) {
      return res.status(404).json(errorResponse('店铺不存在', 404))
    }

    // 更新 cookies 和 cookies 更新时间
    await shopsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          cookies,
          cookiesUpdatedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: req.user?.userId ? new ObjectId(req.user.userId) : null,
        },
      },
    )

    res.json(successResponse(null, 'Cookies 上报成功'))
  } catch (error) {
    console.error('上报 cookies 错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

