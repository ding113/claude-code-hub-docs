import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'Claude Code Hub - 智能 AI API 代理平台'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          position: 'relative',
        }}
      >
        {/* 网格背景 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              'linear-gradient(rgba(99, 102, 241, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(99, 102, 241, 0.1) 1px, transparent 1px)',
            backgroundSize: '50px 50px',
          }}
        />

        {/* 光效装饰 */}
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            right: '-10%',
            width: '600px',
            height: '600px',
            background:
              'radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-30%',
            left: '-10%',
            width: '500px',
            height: '500px',
            background:
              'radial-gradient(circle, rgba(168, 85, 247, 0.2) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />

        {/* 主标题 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          {/* Logo 文字 */}
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              background: 'linear-gradient(90deg, #818cf8, #a78bfa, #c084fc)',
              backgroundClip: 'text',
              color: 'transparent',
              marginBottom: 24,
              letterSpacing: '-0.02em',
            }}
          >
            Claude Code Hub
          </div>

          {/* 副标题 */}
          <div
            style={{
              fontSize: 36,
              color: '#94a3b8',
              marginBottom: 48,
            }}
          >
            智能 AI API 代理平台
          </div>

          {/* 功能标签 */}
          <div
            style={{
              display: 'flex',
              gap: 16,
            }}
          >
            {['负载均衡', '熔断器', '限流', '监控'].map((tag) => (
              <div
                key={tag}
                style={{
                  padding: '12px 24px',
                  background: 'rgba(99, 102, 241, 0.2)',
                  borderRadius: 8,
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#a5b4fc',
                  fontSize: 20,
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
