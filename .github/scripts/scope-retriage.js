const SCOPE_LABELS = new Set([
  'scope:in-scope',
  'scope:needs-decision',
  'scope:out-of-scope',
]);

function isCanonicalScopeRequest(issue) {
  return (
    !issue.pull_request &&
    issue.labels.some((label) => SCOPE_LABELS.has(label.name))
  );
}

module.exports = async function flagScopeRetriage({ github, context }) {
  const { payload } = context;
  const isClosedComment =
    context.eventName === 'issue_comment' &&
    payload.action === 'created' &&
    payload.issue.state === 'closed' &&
    !payload.issue.locked;
  const isReopening =
    context.eventName === 'issues' && payload.action === 'reopened';

  if (
    payload.sender.type === 'Bot' ||
    (!isClosedComment && !isReopening) ||
    !isCanonicalScopeRequest(payload.issue)
  ) {
    return;
  }

  await github.rest.issues.addLabels({
    ...context.repo,
    issue_number: payload.issue.number,
    labels: ['status:needs-retriage'],
  });
};
