import React, { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type MarkdownBlock =
  | {
      type: 'markdown';
      content: string;
    }
  | {
      type: 'table';
      header: string[];
      rows: string[][];
      alignments: Array<'left' | 'center' | 'right'>;
    };

function isTableSeparatorLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) {
    return false;
  }

  const normalized = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = normalized.split('|').map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseAlignment(cell: string): 'left' | 'center' | 'right' {
  const trimmed = cell.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
    return 'center';
  }
  if (trimmed.endsWith(':')) {
    return 'right';
  }
  return 'left';
}

function splitTableCells(line: string) {
  const normalized = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '\\' && next === '|') {
      current += '|';
      index += 1;
      continue;
    }

    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseMarkdownBlocks(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let markdownBuffer: string[] = [];

  const flushMarkdown = () => {
    const markdown = markdownBuffer.join('\n').trim();
    markdownBuffer = [];
    if (!markdown) {
      return;
    }

    blocks.push({ type: 'markdown', content: markdown });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (line.includes('|') && nextLine && isTableSeparatorLine(nextLine)) {
      flushMarkdown();

      const header = splitTableCells(line);
      const alignments = splitTableCells(nextLine).map(parseAlignment);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableCells(lines[index]));
        index += 1;
      }

      index -= 1;
      blocks.push({ type: 'table', header, rows, alignments });
      continue;
    }

    markdownBuffer.push(line);
  }

  flushMarkdown();
  return blocks;
}

function InlineMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: Fragment,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function MarkdownContent({
  content,
  proseClassName,
  tableVariant = 'default',
}: {
  content: string;
  proseClassName: string;
  tableVariant?: 'default' | 'inverse' | 'error';
}) {
  const blocks = parseMarkdownBlocks(content);

  const tableClasses =
    tableVariant === 'inverse'
      ? {
          wrapper: 'border-white/15 bg-white/5',
          table: 'text-white',
          head: 'bg-white/8 text-white/80',
          cell: 'border-white/10',
        }
      : tableVariant === 'error'
        ? {
            wrapper: 'border-red-200 bg-red-50',
            table: 'text-red-700',
            head: 'bg-red-100 text-red-700',
            cell: 'border-red-200',
          }
        : {
            wrapper: 'border-slate-200 bg-white',
            table: 'text-slate-700',
            head: 'bg-slate-50 text-slate-600',
            cell: 'border-slate-200',
          };

  return (
    <div className="space-y-4">
      {blocks.map((block, blockIndex) => {
        if (block.type === 'markdown') {
          return (
            <div key={`markdown-${blockIndex}`} className={proseClassName}>
              <ReactMarkdown>{block.content}</ReactMarkdown>
            </div>
          );
        }

        return (
          <div
            key={`table-${blockIndex}`}
            className={cn(
              'overflow-x-auto rounded-2xl border shadow-sm',
              tableClasses.wrapper,
            )}
          >
            <table className={cn('min-w-full text-sm border-collapse', tableClasses.table)}>
              <thead>
                <tr className={tableClasses.head}>
                  {block.header.map((cell, cellIndex) => (
                    <th
                      key={`header-${cellIndex}`}
                      className={cn(
                        'px-4 py-3 text-left font-semibold border-b whitespace-nowrap',
                        tableClasses.cell,
                        block.alignments[cellIndex] === 'center' && 'text-center',
                        block.alignments[cellIndex] === 'right' && 'text-right',
                      )}
                    >
                      <InlineMarkdown content={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="align-top">
                    {block.header.map((_, cellIndex) => (
                      <td
                        key={`cell-${rowIndex}-${cellIndex}`}
                        className={cn(
                          'px-4 py-3 border-b last:border-b-0',
                          tableClasses.cell,
                          block.alignments[cellIndex] === 'center' && 'text-center',
                          block.alignments[cellIndex] === 'right' && 'text-right',
                        )}
                      >
                        <InlineMarkdown content={row[cellIndex] || ''} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
