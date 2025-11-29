import { EventType } from "../constants";
import {
  formatCreate,
  formatDelete,
  formatFork,
  formatIssue,
  formatIssueComment,
  formatPullRequest,
  formatPullRequestReview,
  formatPush,
  formatRelease,
  formatWatch,
  formatWorkflowRun,
} from "../formatters/webhook-events";
import type {
  BranchFilter,
  SubscriptionService,
} from "../services/subscription-service";
import type { TownsBot } from "../types/bot";
import type {
  CreatePayload,
  DeletePayload,
  ForkPayload,
  IssueCommentPayload,
  IssuesPayload,
  PullRequestPayload,
  PullRequestReviewPayload,
  PushPayload,
  ReleasePayload,
  WatchPayload,
  WorkflowRunPayload,
} from "../types/webhooks";

/**
 * EventProcessor - Routes webhook events to formatters and sends to subscribed channels
 *
 * Maps webhook event types to subscription event types and filters by user preferences.
 */
export class EventProcessor {
  private bot: TownsBot;
  private subscriptionService: SubscriptionService;

  constructor(bot: TownsBot, subscriptionService: SubscriptionService) {
    this.bot = bot;
    this.subscriptionService = subscriptionService;
  }

  /**
   * Generic helper to process GitHub webhook events
   * Handles channel filtering, message formatting, and distribution
   *
   * @param event - The webhook event payload
   * @param eventType - The subscription event type for filtering
   * @param formatter - Function to format the event as a message
   * @param logContext - Optional context string for logging
   * @param branchContext - Optional branch context for branch-specific filtering
   */
  private async processEvent<
    T extends { repository: { full_name: string; default_branch: string } },
  >(
    event: T,
    eventType: EventType,
    formatter: (event: T) => string,
    logContext?: string,
    branchContext?: { branch: string }
  ) {
    if (logContext) {
      console.log(`Processing ${logContext}`);
    }

    // Get subscribed channels for this repo (webhook mode only)
    const channels = await this.subscriptionService.getRepoSubscribers(
      event.repository.full_name,
      "webhook"
    );

    // Filter by event preferences
    let interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes(eventType)
    );

    // Apply branch filtering for branch-specific events
    if (branchContext) {
      const { branch } = branchContext;
      const defaultBranch = event.repository.default_branch;

      interestedChannels = interestedChannels.filter(ch =>
        matchesBranchFilter(branch, ch.branchFilter, defaultBranch)
      );

      if (interestedChannels.length === 0) {
        console.log(
          `No interested channels for ${eventType} event on branch ${branch} (filtered by branch preferences)`
        );
        return;
      }
    }

    if (interestedChannels.length === 0) {
      console.log(`No interested channels for ${eventType} event`);
      return;
    }

    // Format message
    const message = formatter(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    const results = await Promise.allSettled(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message)
      )
    );

    // Log failures
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Failed to send to ${interestedChannels[index].channelId}:`,
          result.reason
        );
      }
    });
  }

  /**
   * Process a pull request webhook event
   * Branch filter applies to base branch (merge target)
   */
  async onPullRequest(event: PullRequestPayload) {
    const { pull_request, repository } = event;
    const baseBranch = pull_request.base.ref;
    await this.processEvent(
      event,
      "pr",
      formatPullRequest,
      `PR event: ${event.action} - ${repository.full_name}#${pull_request.number}`,
      { branch: baseBranch }
    );
  }

  /**
   * Process a push webhook event (commits)
   * Branch filter applies to the branch being pushed to
   */
  async onPush(event: PushPayload) {
    const { repository, ref, commits } = event;
    // Extract branch name from ref (e.g., "refs/heads/main" -> "main")
    const branch = ref.replace(/^refs\/heads\//, "");
    await this.processEvent(
      event,
      "commits",
      formatPush,
      `push event: ${repository.full_name} - ${ref} (${commits?.length || 0} commits)`,
      { branch }
    );
  }

  /**
   * Process an issues webhook event
   */
  async onIssues(event: IssuesPayload) {
    const { issue, repository } = event;
    await this.processEvent(
      event,
      "issues",
      formatIssue,
      `issue event: ${event.action} - ${repository.full_name}#${issue.number}`
    );
  }

  /**
   * Process a release webhook event
   */
  async onRelease(event: ReleasePayload) {
    const { release, repository } = event;
    await this.processEvent(
      event,
      "releases",
      formatRelease,
      `release event: ${event.action} - ${repository.full_name} ${release.tag_name}`
    );
  }

  /**
   * Process a workflow run webhook event (CI)
   * Branch filter applies to the branch that triggered the workflow
   */
  async onWorkflowRun(event: WorkflowRunPayload) {
    const { workflow_run, repository } = event;
    // head_branch can be null for workflows triggered by tags or other non-branch refs
    const branch = workflow_run.head_branch ?? repository.default_branch;
    await this.processEvent(
      event,
      "ci",
      formatWorkflowRun,
      `workflow run event: ${event.action} - ${repository.full_name} ${workflow_run.name}`,
      { branch }
    );
  }

  /**
   * Process an issue comment webhook event
   */
  async onIssueComment(event: IssueCommentPayload) {
    const { issue, repository } = event;
    await this.processEvent(
      event,
      "comments",
      formatIssueComment,
      `issue comment event: ${event.action} - ${repository.full_name}#${issue.number}`
    );
  }

  /**
   * Process a pull request review webhook event
   * Branch filter applies to the PR's base branch (merge target)
   */
  async onPullRequestReview(event: PullRequestReviewPayload) {
    const { pull_request, repository } = event;
    const baseBranch = pull_request.base.ref;
    await this.processEvent(
      event,
      "reviews",
      formatPullRequestReview,
      `PR review event: ${event.action} - ${repository.full_name}#${pull_request.number}`,
      { branch: baseBranch }
    );
  }

  /**
   * Process branch create/delete events
   * Branch filter applies to the branch being created/deleted
   */
  async onBranchEvent(
    event: CreatePayload | DeletePayload,
    eventType: "create" | "delete"
  ) {
    const formatter = (e: CreatePayload | DeletePayload) =>
      eventType === "create"
        ? formatCreate(e as CreatePayload)
        : formatDelete(e as DeletePayload);

    // ref is the branch/tag name being created or deleted
    const branch = event.ref;
    await this.processEvent(
      event,
      "branches",
      formatter,
      `${eventType} event: ${event.repository.full_name}`,
      { branch }
    );
  }

  /**
   * Process fork webhook event
   */
  async onFork(event: ForkPayload) {
    await this.processEvent(
      event,
      "forks",
      formatFork,
      `fork event: ${event.repository.full_name}`
    );
  }

  /**
   * Process watch webhook event (star)
   */
  async onWatch(event: WatchPayload) {
    await this.processEvent(
      event,
      "stars",
      formatWatch,
      `watch event: ${event.repository.full_name}`
    );
  }
}

/**
 * Check if a branch matches a branch filter pattern
 *
 * @param branch - The actual branch name (e.g., "main", "feature/foo")
 * @param filter - Branch filter value from subscription
 * @param defaultBranch - Repository's default branch for null filter
 * @returns true if the branch should be included
 */
function matchesBranchFilter(
  branch: string,
  filter: BranchFilter,
  defaultBranch: string
): boolean {
  // null = default branch only
  if (filter === null) {
    return branch === defaultBranch;
  }

  // "all" = all branches
  if (filter === "all") {
    return true;
  }

  // Specific patterns (comma-separated, glob support)
  const patterns = filter.split(",").map(p => p.trim());
  return patterns.some(pattern => matchGlob(branch, pattern));
}

/**
 * Simple glob matching for branch patterns
 * Supports * wildcard at end (e.g., "release/*" matches "release/v1.0")
 */
function matchGlob(branch: string, pattern: string): boolean {
  // Exact match
  if (!pattern.includes("*")) {
    return branch === pattern;
  }

  // Wildcard at end: "release/*" matches "release/anything"
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "release/"
    return branch.startsWith(prefix);
  }

  // General wildcard: "feature-*" matches "feature-foo"
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return branch.startsWith(prefix);
  }

  // Unsupported pattern, fall back to exact match
  return branch === pattern;
}
