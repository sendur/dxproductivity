import type { RoleRule } from './types'

/** Checked in order; the first pattern that starts a word in the job title wins. */
export const DEFAULT_ROLE_RULES: RoleRule[] = [
  { pattern: 'full stack', roleType: 'Full Stack' },
  { pattern: 'fullstack', roleType: 'Full Stack' },
  { pattern: 'front', roleType: 'Frontend' },
  { pattern: 'ui', roleType: 'Frontend' },
  { pattern: 'web', roleType: 'Frontend' },
  { pattern: 'back', roleType: 'Backend' },
  { pattern: 'api', roleType: 'Backend' },
  { pattern: 'server', roleType: 'Backend' },
  { pattern: 'ios', roleType: 'Mobile' },
  { pattern: 'android', roleType: 'Mobile' },
  { pattern: 'mobile', roleType: 'Mobile' },
  { pattern: 'machine learning', roleType: 'Data / ML' },
  { pattern: 'ml', roleType: 'Data / ML' },
  { pattern: 'data', roleType: 'Data / ML' },
  { pattern: 'security', roleType: 'Security' },
  { pattern: 'sre', roleType: 'Infrastructure' },
  { pattern: 'reliability', roleType: 'Infrastructure' },
  { pattern: 'devops', roleType: 'Infrastructure' },
  { pattern: 'infra', roleType: 'Infrastructure' },
  { pattern: 'platform', roleType: 'Infrastructure' },
  { pattern: 'cloud', roleType: 'Infrastructure' },
  { pattern: 'qa', roleType: 'QA' },
  { pattern: 'test', roleType: 'QA' },
  { pattern: 'quality', roleType: 'QA' },
  { pattern: 'manager', roleType: 'Management' },
  { pattern: 'director', roleType: 'Management' },
  { pattern: 'head of', roleType: 'Management' }
]
