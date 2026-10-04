import type { Config } from './config.ts'

/** Selkies 2.0.0 text input protocol. Never forward commands/binary uploads. */
export function remoteInput(
  input: string,
  limits: NonNullable<Config['remote']>
): string | undefined {
  if (Buffer.byteLength(input) > 16384) return
  const [op, ...args] = input.split(',')
  const number = (value: string) =>
    /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))
  const dimensions = (w: unknown, h: unknown) => {
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      Number(w) < 64 ||
      Number(h) < 64
    )
      return
    const scale = Math.min(
      1,
      limits.maxWidth / Number(w),
      limits.maxHeight / Number(h),
      Math.sqrt(limits.maxPixels / (Number(w) * Number(h)))
    )
    return [
      Math.max(64, Math.floor((Number(w) * scale) / 2) * 2),
      Math.max(64, Math.floor((Number(h) * scale) / 2) * 2)
    ]
  }
  if (op === 'SETTINGS') {
    try {
      const raw = JSON.parse(input.slice(9))
      if (!raw || Array.isArray(raw) || typeof raw !== 'object') return
      const size = dimensions(raw.initialClientWidth, raw.initialClientHeight)
      const finite = (value: unknown, fallback: number) =>
        Number.isFinite(Number(value)) ? Number(value) : fallback
      const safe: Record<string, unknown> = {
        displayId: 'primary',
        useCssScaling: false,
        manual_resolution: false,
        encoder: 'h264enc',
        framerate: 30,
        video_fullcolor: false,
        enable_binary_clipboard: false,
        scaling_dpi: Math.max(
          96,
          Math.min(
            limits.maxDpi,
            Math.round(finite(raw.scaling_dpi ?? 96, 96) / 24) * 24
          )
        ),
        displayScale: Math.max(1, Math.min(2, finite(raw.displayScale ?? 1, 1)))
      }
      if (size) {
        safe.initialClientWidth = size[0]
        safe.initialClientHeight = size[1]
      }
      return 'SETTINGS,' + JSON.stringify(safe)
    } catch {
      return
    }
  }
  if (op === 'r') {
    const match = /^(\d+)x(\d+)$/.exec(args[0] ?? '')
    if (!match || (args[1] && args[1] !== 'primary')) return
    const size = dimensions(Number(match[1]), Number(match[2]))
    return size ? `r,${size[0]}x${size[1]},primary` : undefined
  }
  if (op === 's') {
    const dpi = Number(args[0])
    return Number.isInteger(dpi)
      ? `s,${Math.max(96, Math.min(limits.maxDpi, Math.round(dpi / 24) * 24))}`
      : undefined
  }
  // Only navigation/zoom/pan keys. Browser shortcuts cannot open files/devtools/print.
  const keys = new Set([
    32, 43, 45, 48, 49, 50, 61, 65505, 65506, 65507, 65508, 65513, 65514, 65307,
    65360, 65361, 65362, 65363, 65364, 65365, 65366
  ])
  if (op === 'kd' || op === 'ku')
    return args.length === 1 && keys.has(Number(args[0])) ? input : undefined
  if (op === 'kh')
    return 'kh,' + args.filter((k) => keys.has(Number(k))).join(',')
  if (op === 'kr' && args.length === 0) return input
  if (
    ['m', 'm2', 'vp'].includes(op) &&
    args.length >= 4 &&
    args.length <= 5 &&
    args.every(number) &&
    args.every((a) => Math.abs(Number(a)) <= 65536)
  )
    return input
  if (['START_VIDEO', 'STOP_VIDEO', 'REQUEST_KEYFRAME'].includes(input))
    return input
  if (
    ['p', 'SET_NATIVE_CURSOR_RENDERING', '_gz'].includes(op) &&
    args.length === 1 &&
    ['0', '1'].includes(args[0])
  )
    return input
  if (/^(?:CLIENT_FRAME_ACK \d+ \d+|LOST_FRAME \d+)$/.test(input)) return input
  if (
    ['pong', '_f', '_l', '_arg_fps', '_stats_video'].includes(op) &&
    args.length <= 16 &&
    args.every(number)
  )
    return input
  return undefined
}
