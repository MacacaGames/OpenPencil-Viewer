import { AppError } from './index.ts'
export interface ViewerPage {
  id: string
  name: string
  bounds: { x: number; y: number; width: number; height: number }
}
export interface ViewerManifest {
  version: 1
  pages: ViewerPage[]
}
export interface ViewportRequest {
  page: string
  x: number
  y: number
  scale: number
  width: number
  height: number
}
export const MAX_VIEWPORT_BYTES = 8 * 1024 * 1024
export function parseViewport(query: Record<string, string>): ViewportRequest {
  if (
    Object.keys(query).some(
      (k) => !['page', 'x', 'y', 'scale', 'width', 'height'].includes(k)
    )
  )
    throw new AppError('viewport-invalid', 400)
  const v = {
    page: query.page ?? '',
    x: Number(query.x),
    y: Number(query.y),
    scale: Number(query.scale),
    width: Number(query.width),
    height: Number(query.height)
  }
  if (
    !v.page ||
    v.page.length > 256 ||
    ![v.x, v.y, v.scale, v.width, v.height].every(Number.isFinite) ||
    Math.abs(v.x) > 1e9 ||
    Math.abs(v.y) > 1e9 ||
    v.scale < 0.000001 ||
    v.scale > 32 ||
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    v.width < 1 ||
    v.height < 1 ||
    v.width > 1536 ||
    v.height > 1536 ||
    v.width * v.height > 2097152
  )
    throw new AppError('viewport-invalid', 400)
  return v
}
