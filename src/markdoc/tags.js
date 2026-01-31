import { Badge } from '@/components/Badge'
import { Callout } from '@/components/Callout'
import { QuickLink, QuickLinks } from '@/components/QuickLinks'
import { HomePageAd } from '@/components/SidebarAd'
import { Tabs, TabItem } from '@/components/Tabs'

const tags = {
  'sponsor-ad': {
    selfClosing: true,
    render: HomePageAd,
  },
  badge: {
    selfClosing: true,
    render: Badge,
    attributes: {
      version: { type: String },
      href: { type: String },
      label: { type: String },
    },
  },
  callout: {
    attributes: {
      title: { type: String },
      type: {
        type: String,
        default: 'note',
        matches: ['note', 'warning'],
        errorLevel: 'critical',
      },
    },
    render: Callout,
  },
  figure: {
    selfClosing: true,
    attributes: {
      src: { type: String },
      alt: { type: String },
      caption: { type: String },
    },
    render: ({ src, alt = '', caption }) => (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
        <figcaption>{caption}</figcaption>
      </figure>
    ),
  },
  'quick-links': {
    render: QuickLinks,
  },
  'quick-link': {
    selfClosing: true,
    render: QuickLink,
    attributes: {
      title: { type: String },
      description: { type: String },
      icon: { type: String },
      href: { type: String },
    },
  },
  tabs: {
    render: Tabs,
  },
  tab: {
    render: TabItem,
    attributes: {
      label: { type: String, required: true },
    },
  },
}

export default tags
