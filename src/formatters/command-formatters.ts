/**
 * Command response formatters
 * Format GitHub data for slash command responses (/gh_pr, /gh_issue)
 */

import type {
  GitHubIssue,
  GitHubIssueList,
  GitHubPullRequest,
  GitHubPullRequestList,
} from "../api/github-client";
import { truncateText } from "../utils/text";

/**
 * Get PR status label based on state, draft, and merge status
 */
function getPrStatus(pr: GitHubPullRequest | GitHubPullRequestList[0]): string {
  if (pr.draft) return "📝 Draft";
  if (pr.state === "open") return "🟢 Open";
  // GitHubPullRequest has 'merged', list items have 'merged_at'
  if ("merged" in pr ? pr.merged : pr.merged_at) return "✅ Merged";
  return "❌ Closed";
}

/**
 * Format pull request list for display
 */
export function formatPrList(prs: GitHubPullRequestList, repo: string): string {
  const prList = prs
    .map(pr => {
      const status = getPrStatus(pr);
      const prLink = `[#${pr.number}](${pr.html_url})`;
      return `• ${prLink} ${status} - **${pr.title}** by ${pr.user?.login || "Unknown"}`;
    })
    .join("\n\n");

  return (
    `**Recent Pull Requests - ${repo}**\n` +
    `Showing ${prs.length} most recent PRs:\n\n` +
    prList
  );
}

/**
 * Format detailed pull request information
 */
export function formatPrDetail(
  pr: GitHubPullRequest,
  repo: string,
  hasFullFlag: boolean
): string {
  const description = hasFullFlag ? pr.body : truncateText(pr.body, 100);

  return (
    `**Pull Request #${pr.number}**\n` +
    `**${repo}**\n\n` +
    `**${pr.title}**\n\n` +
    (description ? `${description}\n\n` : "") +
    `📊 Status: ${getPrStatus(pr)}\n` +
    `👤 Author: ${pr.user?.login || "Unknown"}\n` +
    `📝 Changes: +${pr.additions ?? 0} -${pr.deletions ?? 0}\n` +
    `💬 Comments: ${pr.comments ?? 0}\n` +
    `🔗 ${pr.html_url}`
  );
}

/**
 * Format issue list for display
 */
export function formatIssueList(issues: GitHubIssueList, repo: string): string {
  const issueList = issues
    .map(issue => {
      const status = issue.state === "open" ? "🟢 Open" : "✅ Closed";
      const issueLink = `[#${issue.number}](${issue.html_url})`;
      return `• ${issueLink} ${status} - **${issue.title}** by ${issue.user?.login || "Unknown"}`;
    })
    .join("\n\n");

  return (
    `**Recent Issues - ${repo}**\n` +
    `Showing ${issues.length} most recent issues:\n\n` +
    issueList
  );
}

/**
 * Format detailed issue information
 */
export function formatIssueDetail(
  issue: GitHubIssue,
  repo: string,
  hasFullFlag: boolean
): string {
  const labels = issue.labels
    .map(l => (typeof l === "string" ? l : l.name))
    .join(", ");

  const description = hasFullFlag ? issue.body : truncateText(issue.body, 100);

  return (
    `**Issue #${issue.number}**\n` +
    `**${repo}**\n\n` +
    `**${issue.title}**\n\n` +
    (description ? `${description}\n\n` : "") +
    `📊 Status: ${issue.state === "open" ? "🟢 Open" : "✅ Closed"}\n` +
    `👤 Author: ${issue.user?.login || "Unknown"}\n` +
    `💬 Comments: ${issue.comments ?? 0}\n` +
    (labels ? `🏷️ Labels: ${labels}\n` : "") +
    `🔗 ${issue.html_url}`
  );
}
