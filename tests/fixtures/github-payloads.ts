export const mockIssueResponse = {
  number: 123,
  title: "Test issue title",
  state: "open" as const,
  user: { login: "testuser" },
  comments: 5,
  labels: [{ name: "bug" }, { name: "priority:high" }],
  html_url: "https://github.com/owner/repo/issues/123",
};

export const mockPullRequestResponse = {
  number: 456,
  title: "Test PR title",
  state: "open" as const,
  merged: false,
  user: { login: "testuser" },
  additions: 100,
  deletions: 50,
  comments: 3,
  html_url: "https://github.com/owner/repo/pull/456",
};

export const mockClosedIssueResponse = {
  ...mockIssueResponse,
  number: 124,
  title: "Closed issue",
  state: "closed" as const,
};

export const mockIssueWithoutLabelsResponse = {
  ...mockIssueResponse,
  number: 125,
  title: "Issue without labels",
  labels: [],
};

export const mockMergedPullRequestResponse = {
  ...mockPullRequestResponse,
  number: 457,
  state: "closed" as const,
  merged: true,
};

export const mockClosedPullRequestResponse = {
  ...mockPullRequestResponse,
  number: 458,
  state: "closed" as const,
  merged: false,
};

export const mockPullRequestListResponse = [
  {
    number: 100,
    title: "Add new feature X",
    state: "open" as const,
    merged: false,
    user: { login: "developer1" },
    html_url: "https://github.com/owner/repo/pull/100",
  },
  {
    number: 99,
    title: "Fix bug in component Y",
    state: "closed" as const,
    merged: true,
    user: { login: "developer2" },
    html_url: "https://github.com/owner/repo/pull/99",
  },
  {
    number: 98,
    title: "Update documentation",
    state: "closed" as const,
    merged: false,
    user: { login: "developer3" },
    html_url: "https://github.com/owner/repo/pull/98",
  },
];

export const mockIssueListResponse = [
  {
    number: 50,
    title: "Bug: App crashes on startup",
    state: "open" as const,
    user: { login: "user1" },
    html_url: "https://github.com/owner/repo/issues/50",
    labels: [{ name: "bug" }],
  },
  {
    number: 49,
    title: "Feature request: Add dark mode",
    state: "open" as const,
    user: { login: "user2" },
    html_url: "https://github.com/owner/repo/issues/49",
    labels: [{ name: "enhancement" }],
  },
  {
    number: 48,
    title: "Question about API usage",
    state: "closed" as const,
    user: { login: "user3" },
    html_url: "https://github.com/owner/repo/issues/48",
    labels: [{ name: "question" }],
  },
];

export const mockIssueListWithPullRequestsResponse = [
  {
    number: 52,
    title: "Real issue here",
    state: "open" as const,
    user: { login: "user1" },
    html_url: "https://github.com/owner/repo/issues/52",
    labels: [{ name: "bug" }],
  },
  {
    number: 51,
    title: "This is actually a PR",
    state: "open" as const,
    user: { login: "developer1" },
    html_url: "https://github.com/owner/repo/pull/51",
    pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/51" },
  },
];
