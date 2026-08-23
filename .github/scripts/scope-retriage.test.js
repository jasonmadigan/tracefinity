const assert = require('node:assert/strict');
const test = require('node:test');

const flagScopeRetriage = require('./scope-retriage');

function canonicalIssue(overrides = {}) {
  return {
    number: 72,
    state: 'closed',
    locked: false,
    labels: [{ name: 'scope:out-of-scope' }],
    ...overrides,
  };
}

async function runHandler(eventName, payload) {
  const calls = [];
  const github = {
    rest: {
      issues: {
        addLabels: async (input) => calls.push(input),
      },
    },
  };
  const context = {
    eventName,
    payload,
    repo: { owner: 'tracefinity', repo: 'tracefinity' },
  };

  await flagScopeRetriage({ github, context });
  return calls;
}

test('a new comment on a closed canonical scope request flags it for re-triage', async () => {
  const calls = await runHandler('issue_comment', {
    action: 'created',
    issue: canonicalIssue(),
    sender: { login: 'community-member', type: 'User' },
  });

  assert.deepEqual(calls, [
    {
      owner: 'tracefinity',
      repo: 'tracefinity',
      issue_number: 72,
      labels: ['status:needs-retriage'],
    },
  ]);
});

test('reopening a canonical scope request flags it for re-triage', async () => {
  const calls = await runHandler('issues', {
    action: 'reopened',
    issue: canonicalIssue({ state: 'open' }),
    sender: { login: 'community-member', type: 'User' },
  });

  assert.deepEqual(calls, [
    {
      owner: 'tracefinity',
      repo: 'tracefinity',
      issue_number: 72,
      labels: ['status:needs-retriage'],
    },
  ]);
});

test('bot-authored events are ignored', async () => {
  const calls = await runHandler('issue_comment', {
    action: 'created',
    issue: canonicalIssue(),
    sender: { login: 'github-actions[bot]', type: 'Bot' },
  });

  assert.deepEqual(calls, []);
});

test('pull request comments are ignored', async () => {
  const calls = await runHandler('issue_comment', {
    action: 'created',
    issue: canonicalIssue({ pull_request: { url: 'https://api.github.test/pulls/72' } }),
    sender: { login: 'community-member', type: 'User' },
  });

  assert.deepEqual(calls, []);
});

test('comments that are not on unlocked, closed canonical requests are ignored', async (t) => {
  const cases = [
    ['an open request', canonicalIssue({ state: 'open' })],
    ['a locked request', canonicalIssue({ locked: true })],
    ['an issue without a scope verdict', canonicalIssue({ labels: [{ name: 'enhancement' }] })],
  ];

  for (const [name, issue] of cases) {
    await t.test(name, async () => {
      const calls = await runHandler('issue_comment', {
        action: 'created',
        issue,
        sender: { login: 'community-member', type: 'User' },
      });

      assert.deepEqual(calls, []);
    });
  }
});

test('reopening an issue without a scope verdict is ignored', async () => {
  const calls = await runHandler('issues', {
    action: 'reopened',
    issue: canonicalIssue({
      state: 'open',
      labels: [{ name: 'enhancement' }],
    }),
    sender: { login: 'community-member', type: 'User' },
  });

  assert.deepEqual(calls, []);
});
