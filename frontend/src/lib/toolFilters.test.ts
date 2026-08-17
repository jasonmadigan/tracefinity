import { describe, expect, it } from 'vitest'

import { filterToolsByStatus, getToolQuickFilterCounts } from './toolFilters'
import type { ToolSummary } from '@/types'

const tool = (id: string, projectIds: string[] = []): ToolSummary => ({
  id,
  name: id,
  created_at: null,
  point_count: 0,
  points: [],
  interior_rings: [],
  smoothed: false,
  smooth_level: 0,
  thumbnail_url: null,
  image_transform: null,
  image_context: null,
  category: null,
  drawer: null,
  tags: [],
  project_ids: projectIds,
  review_status: null,
  needs_cleanup: false,
})

describe('tool quick filters', () => {
  const tools = [
    tool('placed', ['project-1']),
    tool('needs-bin', ['project-1']),
    tool('unassigned'),
  ]
  const placedToolIds = new Set(['placed'])

  it('shows only project tools that have been placed in a project bin', () => {
    expect(filterToolsByStatus(tools, 'placed', placedToolIds).map(item => item.id))
      .toEqual(['placed'])
  })

  it('shows only tools that are not assigned to a project', () => {
    expect(filterToolsByStatus(tools, 'unassigned', placedToolIds).map(item => item.id))
      .toEqual(['unassigned'])
  })

  it('does not classify an outside-project tool as placed', () => {
    const outsideProjectTool = tool('outside-project')

    expect(filterToolsByStatus([outsideProjectTool], 'placed', new Set(['outside-project'])))
      .toEqual([])
  })

  it('returns counts for each quick filter', () => {
    expect(getToolQuickFilterCounts(tools, placedToolIds)).toEqual({
      all: 3,
      placed: 1,
      unassigned: 1,
    })
  })
})
