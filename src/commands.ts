import type { PlainMessage, SlashCommand } from "@towns-protocol/proto";

const commands = [
  {
    name: "help",
    description: "Get help with bot commands",
  },
  {
    name: "github",
    description: "Manage GitHub subscriptions (subscribe, unsubscribe, status)",
  },
  {
    name: "gh_pr",
    description:
      "Show GitHub pull request details (usage: /gh_pr owner/repo #123)",
  },
  {
    name: "gh_issue",
    description: "Show GitHub issue details (usage: /gh_issue owner/repo #123)",
  },
  {
    name: "gh_prs",
    description:
      "List recent pull requests (usage: /gh_prs owner/repo [count])",
  },
  {
    name: "gh_issues",
    description: "List recent issues (usage: /gh_issues owner/repo [count])",
  },
] as const satisfies PlainMessage<SlashCommand>[];

export default commands;
