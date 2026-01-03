'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Brain,
  Code,
  Database,
  Eye,
  FileText,
  Globe,
  Image,
  Link as LinkIcon,
  Mic,
  Monitor,
  MoveHorizontal,
  Sparkles,
  Volume2,
  Video,
  Wrench,
} from 'lucide-react'
import clsx from 'clsx'

type AbilityDef = {
  key: string
  label: string
  Icon: LucideIcon
}

export const ABILITY_DEFS: AbilityDef[] = [
  { key: 'supports_function_calling', label: '函数调用', Icon: Wrench },
  { key: 'supports_parallel_function_calling', label: '并行函数调用', Icon: MoveHorizontal },
  { key: 'supports_tool_choice', label: '工具选择', Icon: Sparkles },
  { key: 'supports_vision', label: '视觉', Icon: Eye },
  { key: 'supports_image_input', label: '图像输入', Icon: Image },
  { key: 'supports_pdf_input', label: 'PDF 输入', Icon: FileText },
  { key: 'supports_video_input', label: '视频输入', Icon: Video },
  { key: 'supports_audio_input', label: '音频输入', Icon: Mic },
  { key: 'supports_audio_output', label: '音频输出', Icon: Volume2 },
  { key: 'supports_reasoning', label: '推理', Icon: Brain },
  { key: 'supports_prompt_caching', label: '提示缓存', Icon: Database },
  { key: 'supports_response_schema', label: '结构化输出', Icon: Code },
  { key: 'supports_web_search', label: '联网搜索', Icon: Globe },
  { key: 'supports_url_context', label: 'URL 上下文', Icon: LinkIcon },
  { key: 'supports_computer_use', label: '电脑使用', Icon: Monitor },
]

const ABILITY_MAP = new Map<string, AbilityDef>(
  ABILITY_DEFS.map((d) => [d.key, d]),
)

export function AbilityIcons({
  abilities,
  size = 16,
  className,
  max = 10,
}: {
  abilities: string[]
  size?: number
  className?: string
  max?: number
}) {
  const known = abilities
    .map((a) => ABILITY_MAP.get(a))
    .filter(Boolean) as AbilityDef[]
  const unknown = abilities.filter((a) => !ABILITY_MAP.has(a))

  const visible = known.slice(0, max)
  const rest = known.length - visible.length
  const unknownCount = unknown.length

  return (
    <div className={clsx('flex items-center gap-1', className)}>
      {visible.map(({ key, label, Icon }) => (
        <span
          key={key}
          title={label}
          className="inline-flex items-center justify-center rounded-md bg-[var(--claude-cloud)] px-1.5 py-1 text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]"
        >
          <Icon size={size} aria-label={label} />
        </span>
      ))}
      {rest > 0 && (
        <span className="ml-1 text-xs text-[var(--claude-walnut)]/70">
          +{rest}
        </span>
      )}
      {unknownCount > 0 && (
        <span
          title={unknown.slice(0, 10).join('\n')}
          className="inline-flex items-center justify-center rounded-md bg-[var(--claude-cloud)] px-1.5 py-1 text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]"
        >
          <Sparkles size={size} aria-label={`其他能力 ${unknownCount} 个`} />
        </span>
      )}
    </div>
  )
}
