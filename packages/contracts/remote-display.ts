export interface RemoteDisplay {
  cssWidth: number
  cssHeight: number
  width: number
  height: number
  density: number
  uiScale: number
  dpi: number
}
export function remoteDisplay(
  value: unknown,
  limits: {
    maxWidth: number
    maxHeight: number
    maxPixels: number
    maxDpi: number
  }
): RemoteDisplay {
  const raw = value as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('invalid-display')
  const { width, height, dpr, uiScale } = raw
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 64 ||
    width > 8192 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 64 ||
    height > 8192 ||
    typeof dpr !== 'number' ||
    !Number.isFinite(dpr) ||
    dpr < 0.5 ||
    dpr > 4 ||
    typeof uiScale !== 'number' ||
    ![1, 1.25, 1.5, 1.75].includes(uiScale)
  )
    throw new Error('invalid-display')
  const density = Math.min(
    dpr,
    limits.maxDpi / 96,
    limits.maxWidth / width,
    limits.maxHeight / height,
    Math.sqrt(limits.maxPixels / (width * height))
  )
  const w = Math.max(64, Math.floor((width * density) / 2) * 2)
  const h = Math.max(64, Math.floor((height * density) / 2) * 2)
  return {
    cssWidth: width,
    cssHeight: height,
    width: w,
    height: h,
    density: Math.min(w / width, h / height),
    uiScale,
    dpi: Math.max(96, Math.min(limits.maxDpi, Math.round(density * 96)))
  }
}
