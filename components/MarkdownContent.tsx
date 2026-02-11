'use client'

import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

interface MarkdownContentProps {
  /** Markdown source (e.g. **bold**, *italic*, [link](url)) */
  content: string
  className?: string
  /** Use compact spacing (single paragraph, no extra margins) */
  compact?: boolean
}

/**
 * Renders markdown with theme-aware styles. Supports **bold**, *italic*,
 * [links](url), and other common markdown.
 */
export function MarkdownContent({ content, className, compact }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        'markdown-content text-inherit',
        compact && 'markdown-content-compact',
        className
      )}
    >
      <ReactMarkdown
        components={{
          p: ({ children, ...props }) => (
            <span className="block my-1 first:mt-0 last:mb-0" {...props}>
              {children}
            </span>
          ),
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-foreground" {...props}>
              {children}
            </strong>
          ),
          em: ({ children, ...props }) => (
            <em className="italic text-foreground" {...props}>
              {children}
            </em>
          ),
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-500 hover:text-green-400 underline break-all"
              {...props}
            >
              {children}
            </a>
          ),
          ul: ({ children, ...props }) => (
            <ul className="list-disc list-inside my-1 space-y-0.5" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal list-inside my-1 space-y-0.5" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="text-inherit" {...props}>
              {children}
            </li>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
