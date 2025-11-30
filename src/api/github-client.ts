import { Octokit } from "@octokit/rest";
import type { Endpoints } from "@octokit/types";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Export Octokit's native types using @octokit/types
export type GitHubIssue =
  Endpoints["GET /repos/{owner}/{repo}/issues/{issue_number}"]["response"]["data"];
export type GitHubPullRequest =
  Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];
export type GitHubIssueList =
  Endpoints["GET /repos/{owner}/{repo}/issues"]["response"]["data"];
export type GitHubPullRequestList =
  Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"];

/**
 * Error types for GitHub API calls
 */
export type GitHubApiErrorType =
  | "not_found"
  | "forbidden"
  | "rate_limited"
  | "unknown";

/**
 * Classify GitHub API error for better user messaging
 */
export function classifyApiError(error: unknown): GitHubApiErrorType {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const status = (error as any)?.status;
  if (status === 404) return "not_found";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return "unknown";
}

export function parseRepo(repoFullName: string): [owner: string, repo: string] {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(
      `Invalid repository format: "${repoFullName}". Expected "owner/repo".`
    );
  }
  return [owner, repo];
}

export async function validateRepo(
  repoFullName: string,
  userOctokit?: Octokit
): Promise<boolean> {
  try {
    const client = userOctokit || octokit;
    const [owner, repo] = parseRepo(repoFullName);
    await client.repos.get({ owner, repo });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get repository info including default branch
 * Used by polling service to cache default branch for branch filtering
 */
export async function getRepoInfo(
  repoFullName: string,
  userOctokit?: Octokit
): Promise<{ defaultBranch: string }> {
  const client = userOctokit || octokit;
  const [owner, repo] = parseRepo(repoFullName);
  const { data } = await client.repos.get({ owner, repo });
  return { defaultBranch: data.default_branch };
}

export async function getIssue(
  repoFullName: string,
  issueNumber: string,
  userOctokit?: Octokit
): Promise<GitHubIssue> {
  const client = userOctokit || octokit;
  const [owner, repo] = parseRepo(repoFullName);
  const { data } = await client.issues.get({
    owner,
    repo,
    issue_number: parseInt(issueNumber),
  });
  return data;
}

export async function getPullRequest(
  repoFullName: string,
  prNumber: string,
  userOctokit?: Octokit
): Promise<GitHubPullRequest> {
  const client = userOctokit || octokit;
  const [owner, repo] = parseRepo(repoFullName);
  const { data } = await client.pulls.get({
    owner,
    repo,
    pull_number: parseInt(prNumber),
  });
  return data;
}

export async function listPullRequests(
  repoFullName: string,
  count: number = 10,
  filters?: { state?: string; author?: string },
  userOctokit?: Octokit
): Promise<GitHubPullRequestList> {
  const client = userOctokit || octokit;
  const [owner, repo] = parseRepo(repoFullName);

  // Determine API state (merged PRs are fetched as closed)
  let apiState: "open" | "closed" | "all" = "all";
  if (filters?.state === "open" || filters?.state === "closed") {
    apiState = filters.state;
  } else if (filters?.state === "merged") {
    apiState = "closed";
  }

  const results: GitHubPullRequestList = [];
  let pageCount = 0;
  const maxPages = 10; // Limit pagination to avoid timeouts

  // Use Octokit's pagination iterator
  const iterator = client.paginate.iterator(client.pulls.list, {
    owner,
    repo,
    state: apiState,
    per_page: 100,
    sort: "created",
    direction: "desc",
  });

  for await (const { data: prs } of iterator) {
    pageCount++;

    // Stop if we've fetched too many pages
    if (pageCount > maxPages) break;

    // No more items available
    if (prs.length === 0) break;

    let filtered = prs;

    // Filter by merged state (API doesn't distinguish merged from closed)
    if (filters?.state === "merged") {
      filtered = filtered.filter(pr => pr.merged_at !== null);
    }

    // Filter by author
    if (filters?.author) {
      filtered = filtered.filter(
        pr => pr.user?.login.toLowerCase() === filters.author!.toLowerCase()
      );
    }

    results.push(...filtered);

    // Stop once we have enough results
    if (results.length >= count) break;
  }

  return results.slice(0, count);
}

export async function listIssues(
  repoFullName: string,
  count: number = 10,
  filters?: { state?: string; creator?: string },
  userOctokit?: Octokit
): Promise<GitHubIssueList> {
  const client = userOctokit || octokit;
  const [owner, repo] = parseRepo(repoFullName);

  // Build API query parameters
  const apiState = (filters?.state || "all") as "open" | "closed" | "all";
  const params: Parameters<typeof client.issues.listForRepo>[0] = {
    owner,
    repo,
    state: apiState,
    per_page: 100,
    sort: "created",
    direction: "desc",
  };

  if (filters?.creator) {
    params.creator = filters.creator;
  }

  const actualIssues: GitHubIssueList = [];
  let pageCount = 0;
  const maxPages = 10; // Limit pagination to avoid timeouts

  // Use Octokit's pagination iterator
  const iterator = client.paginate.iterator(client.issues.listForRepo, params);

  for await (const { data: items } of iterator) {
    pageCount++;

    // Stop if we've fetched too many pages
    if (pageCount > maxPages) break;

    // No more items available
    if (items.length === 0) break;

    // Filter out pull requests (issues endpoint returns both)
    const issues = items.filter(item => !item.pull_request);
    actualIssues.push(...issues);

    // Stop once we have enough results
    if (actualIssues.length >= count) break;
  }

  return actualIssues.slice(0, count);
}

/**
 * GitHub Event type from /repos/\{owner\}/\{repo\}/events API
 * Uses Octokit's official type for the base structure
 */
export type GitHubEventRaw =
  Endpoints["GET /repos/{owner}/{repo}/events"]["response"]["data"][number];

/**
 * Fetch recent events for a repository with ETag support
 * Returns `\{ events, etag \}` or `\{ notModified: true \}` if ETag matches
 */
export async function fetchRepoEvents(
  repoFullName: string,
  etag?: string
): Promise<
  | { events: GitHubEventRaw[]; etag: string; notModified?: false }
  | { notModified: true; etag?: never; events?: never }
> {
  const [owner, repo] = parseRepo(repoFullName);

  try {
    // Use Octokit's request method to support ETag headers
    const response = await octokit.request("GET /repos/{owner}/{repo}/events", {
      owner,
      repo,
      headers: etag ? { "If-None-Match": etag } : {},
    });

    const events = response.data;
    const newEtag = response.headers.etag || "";

    return { events, etag: newEtag };
  } catch (error: unknown) {
    // 304 Not Modified - no changes since last poll
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if ((error as any)?.status === 304) {
      return { notModified: true };
    }
    throw error;
  }
}

/**
 * Get owner ID from username or org name
 * Uses public GitHub APIs (/orgs or /users) - no special auth required
 */
export async function getOwnerIdFromUsername(
  owner: string
): Promise<number | undefined> {
  try {
    // Try as organization first (most private repos are in orgs)
    try {
      const { data } = await octokit.orgs.get({ org: owner });
      return data.id;
    } catch {
      // If not org, try as user
      const { data } = await octokit.users.getByUsername({ username: owner });
      return data.id;
    }
  } catch (error) {
    console.warn(`Could not fetch owner ID for ${owner}:`, error);
    return undefined;
  }
}
