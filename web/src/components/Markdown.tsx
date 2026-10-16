import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ComponentPropsWithoutRef } from 'react'
import { Check, Copy01 } from '@untitledui/icons'
import { copy } from '@/utils/clipboard'

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  return <div className="code-block">
    <div className="code-toolbar"><span>Código / comando</span><button type="button" onClick={async (e) => {
      const value = e.currentTarget.closest('.code-block')?.querySelector('pre')?.textContent ?? ''
      try { await copy(value); setCopied(true); setError(false); setTimeout(() => setCopied(false), 1500) } catch { setError(true) }
    }} aria-label="Copiar código">{copied ? <Check /> : <Copy01 />}{error ? 'Tentar copiar novamente' : copied ? 'Copiado' : 'Copiar'}</button></div>
    <pre {...props}>{children}</pre>
  </div>
}

export function Markdown({ text }: { text: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]}
    skipHtml components={{
      // Do not spread AST nodes into DOM attributes. Raw HTML is never executed.
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      // Avoid tracking pixels and arbitrary remote media in shared text.
      img: ({ alt }) => <span className="text-tertiary">[Imagem: {alt || 'sem descrição'}]</span>,
    }}>{text}</ReactMarkdown></div>
}
