/**
 * GitHub webhook event formatters
 * Converts GitHub webhook payloads into human-readable messages for Towns channels
 */

import type {
  PullRequestPayload,
  IssuesPayload,
  PushPayload,
  ReleasePayload,
  WorkflowRunPayload,
  IssueCommentPayload,
  PullRequestReviewPayload,
  ForkPayload,
  WatchPayload,
} from "../types/webhooks";
import { buildMessage, getPrEventEmoji, getPrEventHeader } from "./shared";

export function formatPullRequest(payload: PullRequestPayload): string {
  const { action, pull_request, repository } = payload;

  const emoji = getPrEventEmoji(action, pull_request.merged ?? false);
  const header = getPrEventHeader(action, pull_request.merged ?? false);

  if (!emoji || !header) return "";

  const metadata =
    action === "opened"
      ? [`📊 +${pull_request.additions || 0} -${pull_request.deletions || 0}`]
      : undefined;

  return buildMessage({
    emoji,
    header,
    repository: repository.full_name,
    number: pull_request.number,
    title: pull_request.title,
    user: pull_request.user?.login || "unknown",
    metadata,
    url: pull_request.html_url,
  });
}

export function formatIssue(payload: IssuesPayload): string {
  const { action, issue, repository } = payload;

  let emoji: string;
  let header: string;

  if (action === "opened") {
    emoji = "🐛";
    header = "Issue Opened";
  } else if (action === "closed") {
    emoji = "✅";
    header = "Issue Closed";
  } else {
    return "";
  }

  return buildMessage({
    emoji,
    header,
    repository: repository.full_name,
    number: issue.number,
    title: issue.title,
    user: issue.user?.login || "unknown",
    url: issue.html_url,
  });
}

export function formatPush(payload: PushPayload): string {
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
    const firstLine = commit.message.split("\n")[0];
    const shortMessage =
      firstLine.length > 60 ? firstLine.substring(0, 60) + "..." : firstLine;
    message += `\`${shortSha}\` ${shortMessage}\n`;
  }

  if (commitCount > 3) {
    message += `\n_... and ${commitCount - 3} more commit${commitCount - 3 > 1 ? "s" : ""}_\n`;
  }

  message += `\n🔗 ${compare}`;

  return message;
}

export function formatRelease(payload: ReleasePayload): string {
  const { action, release, repository } = payload;

  if (action === "published") {
    return buildMessage({
      emoji: "🚀",
      header: "Release Published",
      repository: repository.full_name,
      title: release.name || release.tag_name,
      user: release.author?.login || "unknown",
      metadata: [`📦 ${release.tag_name}`],
      url: release.html_url,
    });
  }

  return "";
}

export function formatWorkflowRun(payload: WorkflowRunPayload): string {
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

export function formatIssueComment(payload: IssueCommentPayload): string {
  const { action, issue, comment, repository } = payload;

  if (action === "created") {
    const shortComment = comment.body.split("\n")[0].substring(0, 100);

    return (
      `💬 **New Comment on Issue #${issue.number}**\n` +
      `**${repository.full_name}**\n\n` +
      `"${shortComment}${comment.body.length > 100 ? "..." : ""}"\n` +
      `👤 ${comment.user?.login || "unknown"}\n` +
      `🔗 ${comment.html_url}`
    );
  }

  return "";
}

export function formatPullRequestReview(
  payload: PullRequestReviewPayload
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
      `👤 ${review.user?.login || "unknown"}\n` +
      `🔗 ${review.html_url}`
    );
  }

  return "";
}

export function formatFork(payload: ForkPayload): string {
  const { forkee, repository, sender } = payload;

  return (
    `🍴 **Repository Forked**\n` +
    `**${repository.full_name}** → **${forkee.full_name}**\n` +
    `👤 ${sender.login}\n` +
    `🔗 ${forkee.html_url}`
  );
}

export function formatWatch(payload: WatchPayload): string {
  const { action, repository, sender } = payload;

  if (action === "started") {
    return (
      `⭐ **Repository Starred**\n` +
      `**${repository.full_name}**\n` +
      `👤 ${sender.login}\n` +
      `🔗 ${repository.html_url}`
    );
  }

  return "";
}
