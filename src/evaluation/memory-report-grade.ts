/** Strict synthetic-fixture checks, not a general semantic answer grader. */
export function gradeMemoryReport(answer: string, observedPanels: string[]) {
  const normalized = answer.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  const overview = observedPanels.indexOf('overview')
  const billing = observedPanels.indexOf('billing')
  const notifications = observedPanels.indexOf('notifications')
  const checks = {
    observedInOrder: overview >= 0 && billing > overview && notifications > billing,
    members: /\b(?:5|five)\s+members\b|\bmember\s+count\s*(?:is|:)?\s*(?:5|five)\b/iu.test(normalized),
    amount: /(?:\$\s*96(?:\.00)?(?!\d|\.\d)\b|\b(?:USD\s+96(?:\.00)?(?!\d|\.\d)|96(?:\.00)?\s+(?:USD|dollars))\b)/iu.test(normalized),
    date: /\b(?:February|Feb\.?)\s+1(?:st)?[,]?\s+2027\b|\b2027-02-01\b/iu.test(normalized),
    notifications: /\bemail\s+notifications\s*(?:are|:)?\s+(?:on|enabled)\b/iu.test(normalized)
      && !/\b(?:off|disabled|not\s+(?:on|enabled))\b/iu.test(normalized),
    oneParagraph: Boolean(answer.trim()) && !/\n\s*\n/u.test(answer.trim()),
  }
  return { passed: Object.values(checks).every(Boolean), checks, observedPanels }
}
