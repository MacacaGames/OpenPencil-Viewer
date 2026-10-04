import type { Config } from './config.ts'

/** Selkies 2.0.0 text input protocol. Never forward commands/binary uploads. */
export function remoteInput(
  input: string,
  limits: NonNullable<Config['remote']>,
  editable = false
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
  // Readonly sessions use navigation keys; editing uses text and editor shortcuts.
  const keys = new Set([
    32, 43, 45, 48, 49, 50, 61, 65505, 65506, 65507, 65508, 65513, 65514, 65307,
    65360, 65361, 65362, 65363, 65364, 65365, 65366
  ])
  const keyAllowed = (key: number) =>
    Number.isInteger(key) &&
    (keys.has(key) ||
      (editable &&
        ((key >= 32 && key <= 126) ||
          (key >= 160 && key <= 255) ||
          [65288, 65289, 65293, 65379, 65535, 65511, 65512].includes(key) ||
          (key >= 0x01000100 &&
            key <= 0x0110ffff &&
            !(key >= 0x0100d800 && key <= 0x0100dfff)))))
  if (op === 'kd' || op === 'ku')
    return args.length === 1 && keyAllowed(Number(args[0])) ? input : undefined
  if (op === 'kh')
    return 'kh,' + args.filter((k) => keyAllowed(Number(k))).join(',')
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

/** One filter per socket. Editing keys must not unlock browser/desktop shortcuts. */
export function createRemoteInput(
  limits: NonNullable<Config['remote']>,
  editable: boolean
) {
  const held = new Set<number>()
  const control = [65507, 65508, 65511, 65512]
  const shift = [65505, 65506]
  const modifiers = new Set([...control, ...shift, 65513, 65514])
  const chordAllowed = (key: number, pressed: Set<number>) => {
    if (modifiers.has(key)) return true
    if (pressed.has(65513) || pressed.has(65514)) return false
    if (!control.some((modifier) => pressed.has(modifier))) return true
    // Selection, copy/cut/paste (server-local only), duplicate, undo/redo, zoom.
    const letter = String.fromCharCode(key).toLowerCase()
    if (letter === 'c' && shift.some((modifier) => pressed.has(modifier)))
      return false
    return (
      'acdvxyz+-=0123456789'.includes(letter) ||
      [65361, 65362, 65363, 65364, 65288, 65535].includes(key)
    )
  }
  return (input: string) => {
    const safe = remoteInput(input, limits, editable)
    if (!safe || !editable) return safe
    const [op, ...args] = safe.split(',')
    const key = Number(args[0])
    if (op === 'kd') {
      if (!chordAllowed(key, held)) return
      held.add(key)
    } else if (op === 'ku') {
      if (!held.delete(key)) return
    } else if (op === 'kh') {
      const pressed = new Set(args.filter(Boolean).map(Number))
      held.clear()
      for (const key of pressed) if (chordAllowed(key, pressed)) held.add(key)
      return 'kh,' + [...held].join(',')
    } else if (op === 'kr') held.clear()
    return safe
  }
}
