/**
 * GitHub webhook event formatters
 * Converts GitHub webhook payloads into human-readable messages for Towns channels
 */

import type {
  PullRequestEvent,
  IssuesEvent,
  PushEvent,
  ReleaseEvent,
  WorkflowRunEvent,
  IssueCommentEvent,
  PullRequestReviewEvent,
} from "@octokit/webhooks-types";

export function formatPullRequest(payload: PullRequestEvent): string {
  const { action, pull_request, repository } = payload;

  if (action === "opened") {
    return (
      `🔔 **Pull Request Opened**\n` +
      `**${repository.full_name}** #${pull_request.number}\n\n` +
      `**${pull_request.title}**\n` +
      `👤 ${pull_request.user.login}\n` +
      `📊 +${pull_request.additions || 0} -${pull_request.deletions || 0}\n` +
      `🔗 ${pull_request.html_url}`
    );
  }

  if (action === "closed" && pull_request.merged) {
    return (
      `✅ **Pull Request Merged**\n` +
      `**${repository.full_name}** #${pull_request.number}\n\n` +
      `**${pull_request.title}**\n` +
      `👤 ${pull_request.user.login}\n` +
      `🔗 ${pull_request.html_url}`
    );
  }

  if (action === "closed" && !pull_request.merged) {
    return (
      `❌ **Pull Request Closed**\n` +
      `**${repository.full_name}** #${pull_request.number}\n\n` +
      `**${pull_request.title}**\n` +
      `👤 ${pull_request.user.login}\n` +
      `🔗 ${pull_request.html_url}`
    );
  }

  return "";
}

export function formatIssue(payload: IssuesEvent): string {
  const { action, issue, repository } = payload;

  if (action === "opened") {
    return (
      `🐛 **Issue Opened**\n` +
      `**${repository.full_name}** #${issue.number}\n\n` +
      `**${issue.title}**\n` +
      `👤 ${issue.user.login}\n` +
      `🔗 ${issue.html_url}`
    );
  }

  if (action === "closed") {
    return (
      `✅ **Issue Closed**\n` +
      `**${repository.full_name}** #${issue.number}\n\n` +
      `**${issue.title}**\n` +
      `👤 ${issue.user.login}\n` +
      `🔗 ${issue.html_url}`
    );
  }

  return "";
}

export function formatPush(payload: PushEvent): string {
  const { ref, commits, pusher, repository, compare } = payload;
  const branch = ref.replace("refs/heads/", "");
  const commitCount = commits?.length || 0;

  if (commitCount === 0) return "";

  let message =
    `📦 **Push to ${repository.full_name}**\n` +
    `🌿 Branch: \`${branch}\`\n` +
    `👤 ${pusher.name}\n` +
    `📝 ${commitCount} commit${commitCount > 1 ? "s" : ""}\n\n`;

  // Show first 3 commits
  const displayCommits = commits.slice(0, 3);
  for (const commit of displayCommits) {
    const shortSha = commit.id.substring(0, 7);
    const shortMessage = commit.message.split("\n")[0].substring(0, 60);
    message += `\`${shortSha}\` ${shortMessage}\n`;
  }

  if (commitCount > 3) {
    message += `\n_... and ${commitCount - 3} more commit${commitCount - 3 > 1 ? "s" : ""}_\n`;
  }

  message += `\n🔗 ${compare}`;

  return message;
}

export function formatRelease(payload: ReleaseEvent): string {
  const { action, release, repository } = payload;

  if (action === "published") {
    return (
      `🚀 **Release Published**\n` +
      `**${repository.full_name}** ${release.tag_name}\n\n` +
      `**${release.name || release.tag_name}**\n` +
      `👤 ${release.author.login}\n` +
      `🔗 ${release.html_url}`
    );
  }

  return "";
}

export function formatWorkflowRun(payload: WorkflowRunEvent): string {
  const { action, workflow_run, repository } = payload;

  if (action === "completed") {
    const emoji = workflow_run.conclusion === "success" ? "✅" : "❌";
    const status = workflow_run.conclusion === "success" ? "Passed" : "Failed";

    return (
      `${emoji} **CI ${status}**\n` +
      `**${repository.full_name}**\n` +
      `🔧 ${workflow_run.name}\n` +
      `🌿 ${workflow_run.head_branch}\n` +
      `🔗 ${workflow_run.html_url}`
    );
  }

  return "";
}

export function formatIssueComment(payload: IssueCommentEvent): string {
  const { action, issue, comment, repository } = payload;

  if (action === "created") {
    const shortComment = comment.body.split("\n")[0].substring(0, 100);

    return (
      `💬 **New Comment on Issue #${issue.number}**\n` +
      `**${repository.full_name}**\n\n` +
      `"${shortComment}${comment.body.length > 100 ? "..." : ""}"\n` +
      `👤 ${comment.user.login}\n` +
      `🔗 ${comment.html_url}`
    );
  }

  return "";
}

export function formatPullRequestReview(
  payload: PullRequestReviewEvent
): string {
  const { action, review, pull_request, repository } = payload;

  if (action === "submitted") {
    let emoji = "👀";
    if (review.state === "approved") emoji = "✅";
    if (review.state === "changes_requested") emoji = "🔄";

    return (
      `${emoji} **PR Review: ${review.state.replace("_", " ")}**\n` +
      `**${repository.full_name}** #${pull_request.number}\n\n` +
      `**${pull_request.title}**\n` +
      `👤 ${review.user.login}\n` +
      `🔗 ${review.html_url}`
    );
  }

  return "";
}
