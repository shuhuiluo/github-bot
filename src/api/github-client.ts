import type { GitHubIssue, GitHubPullRequest } from "./github-types";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = "https://api.github.com";

export async function githubFetch(path: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }

  const response = await fetch(`${GITHUB_API}${path}`, { headers });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

export async function validateRepo(repo: string): Promise<boolean> {
  try {
    await githubFetch(`/repos/${repo}`);
    return true;
  } catch {
    return false;
  }
}

export async function getIssue(
  repo: string,
  issueNumber: string
): Promise<GitHubIssue> {
  return githubFetch(`/repos/${repo}/issues/${issueNumber}`);
}

export async function getPullRequest(
  repo: string,
  prNumber: string
): Promise<GitHubPullRequest> {
  return githubFetch(`/repos/${repo}/pulls/${prNumber}`);
}

export async function listPullRequests(
  repo: string,
  count: number = 10
): Promise<GitHubPullRequest[]> {
  return githubFetch(
    `/repos/${repo}/pulls?state=all&per_page=${count}&sort=created&direction=desc`
  );
}

export async function listIssues(
  repo: string,
  count: number = 10
): Promise<GitHubIssue[]> {
  return githubFetch(
    `/repos/${repo}/issues?state=all&per_page=${count}&sort=created&direction=desc`
  );
}
