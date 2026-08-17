import type { ToolSummary } from '@/types'

export type ToolQuickFilter = 'all' | 'placed' | 'unassigned'

export function matchesToolQuickFilter(
  tool: ToolSummary,
  filter: ToolQuickFilter,
  placedToolIds: ReadonlySet<string>,
): boolean {
  if (filter === 'placed') {
    return tool.project_ids.length > 0 && placedToolIds.has(tool.id)
  }
  if (filter === 'unassigned') {
    return tool.project_ids.length === 0
  }
  return true
}

export function filterToolsByStatus(
  tools: ToolSummary[],
  filter: ToolQuickFilter,
  placedToolIds: ReadonlySet<string>,
): ToolSummary[] {
  if (filter === 'all') return tools
  return tools.filter(tool => matchesToolQuickFilter(tool, filter, placedToolIds))
}

export function getToolQuickFilterCounts(
  tools: ToolSummary[],
  placedToolIds: ReadonlySet<string>,
): Record<ToolQuickFilter, number> {
  return {
    all: tools.length,
    placed: tools.filter(tool => matchesToolQuickFilter(tool, 'placed', placedToolIds)).length,
    unassigned: tools.filter(tool => matchesToolQuickFilter(tool, 'unassigned', placedToolIds)).length,
  }
}
