/**
 * 统一响应格式
 */
export function successResponse(data = null, message = '操作成功') {
  return {
    code: 200,
    message,
    data,
  }
}

export function errorResponse(message = '操作失败', code = 400, data = null) {
  return {
    code,
    message,
    data,
  }
}

