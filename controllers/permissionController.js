import { successResponse } from '../utils/response.js'

/**
 * 获取角色权限树
 * 返回空数组，因为权限菜单已经在 basePermissions 中配置
 */
export async function getRolePermissionsTree(req, res) {
  try {
    // 返回空数组，前端会合并 basePermissions
    res.json(successResponse([]))
  } catch (error) {
    console.error('获取权限树错误:', error)
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null,
    })
  }
}

/**
 * 验证菜单路径
 */
export async function validateMenuPath(req, res) {
  try {
    const { path } = req.query
    
    // 允许所有路径，因为路由已经在 basePermissions 中配置
    res.json(successResponse(true))
  } catch (error) {
    console.error('验证菜单路径错误:', error)
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null,
    })
  }
}

